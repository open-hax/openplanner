(ns knoxx.backend.contracts-routes
  (:require [clojure.string :as str]
            [cljs.reader :as reader]
            [knoxx.backend.redis-client :as redis]
            [knoxx.backend.runtime-config :as runtime-config]
            [knoxx.backend.event-agents :as event-agents]))

(def ^:private contracts-index-key "contracts:index")

(defn- contract-key
  [contract-id]
  (str "contract:edn:" contract-id))

(defn- now-iso []
  (.toISOString (js/Date.)))

(defn- validate-contract-edn
  [edn-text]
  (let [trimmed (str/trim (str edn-text))]
    (if (str/blank? trimmed)
      {:ok false
       :contract nil
       :errors [{:path [] :message "EDN text is empty"}]
       :warnings []}
      (try
        (let [contract (reader/read-string trimmed)
              id (:contract/id contract)
              kind (:contract/kind contract)
              errors (cond-> []
                       (not (string? id))
                       (conj {:path ["contract/id"] :message ":contract/id must be a string"})
                       (not (keyword? kind))
                       (conj {:path ["contract/kind"] :message ":contract/kind must be a keyword"}))]
          {:ok (empty? errors)
           :contract contract
           :errors errors
           :warnings []})
        (catch :default err
          {:ok false
           :contract nil
           :errors [{:path [] :message (str "EDN parse error: " (.-message err))}]
           :warnings []})))))

(defn- compile-contract->sql
  [contract]
  (let [id (:contract/id contract)
        version (or (:contract/version contract) 1)
        enabled (boolean (get contract :enabled true))
        uses (vec (or (:contract/uses contract) []))
        events (:events contract)
        always (vec (or (:always events) []))
        maybe (vec (or (:maybe events) []))
        tools (or (get-in contract [:data :tools])
                  (get-in contract [:data/tools])
                  [])]
    {:contract {:id id
                :version version
                :kind (name (:contract/kind contract))
                :enabled enabled
                :edn_text (pr-str contract)
                :edn_hash (hash (pr-str contract))
                :compiled_at (now-iso)}
     :event-kinds (vec (concat
                        (map (fn [k] {:contract_id id :event_kind (name k) :mode "always"}) always)
                        (map (fn [k] {:contract_id id :event_kind (name k) :mode "maybe"}) maybe)))
     :bindings (vec (map-indexed (fn [i dep]
                                  {:contract_id id
                                   :dep_id (if (keyword? dep) (name dep) (str dep))
                                   :load_order i})
                                uses))
     :tools (vec (map (fn [t]
                        {:contract_id id
                         :tool_name (cond
                                      (keyword? t) (name t)
                                      (string? t) t
                                      (map? t) (or (:toolId t) (:tool/id t) (str t))
                                      :else (str t))})
                      tools))}))

;; ---------------------------------------------------------------------------
;; Route handler helpers (extracted for paren balance + closure capture safety)
;; ---------------------------------------------------------------------------

(defn- handle-list-contracts
  [do-json client]
  (-> (redis/smembers client contracts-index-key)
      (.then
       (fn [ids]
         (let [ids (sort (map str (js/Array.from (or ids #js []))))
               items (map (fn [id]
                            {:id id
                             :kind "agent"
                             :version 1
                             :enabled true
                             :ednHash 0
                             :compiledAt nil
                             :updatedAt (now-iso)})
                          ids)]
           (do-json 200 {:contracts items}))))
      (.catch (fn [err]
                (do-json 500 {:detail (str "Redis error: " (.-message err))})))))

(defn- handle-get-contract
  [do-json client contract-id]
  (-> (redis/get-json client (contract-key contract-id))
      (.then (fn [edn-text]
               (let [edn-text (or edn-text "")
                     validation (validate-contract-edn edn-text)]
                 (do-json 200 {:ednText edn-text
                               :contract (:contract validation)
                               :validation (dissoc validation :contract)}))))
      (.catch (fn [err]
                (do-json 500 {:detail (str "Redis error: " (.-message err))})))))

(defn- handle-save-contract
  [do-json client contract-id edn-text validation]
  (-> (redis/set-json client (contract-key contract-id) edn-text)
      (.then (fn [_]
               (redis/sadd client contracts-index-key contract-id)))
      (.then (fn [_]
               (do-json 200 {:ok true
                             :ednText edn-text
                             :contract (:contract validation)
                             :validation (dissoc validation :contract)})))
      (.catch (fn [err]
                (do-json 500 {:detail (str "Redis error: " (.-message err))})))))

(defn- handle-compile-contract
  [do-json client contract-id]
  (-> (redis/get-json client (contract-key contract-id))
      (.then (fn [edn-text]
               (let [validation (validate-contract-edn (or edn-text ""))]
                 (if-not (:ok validation)
                   (do-json 200 {:ok false
                                 :errors (:errors validation)
                                 :contract nil
                                 :sql nil})
                   (let [contract (:contract validation)]
                     (do-json 200 {:ok true
                                   :contract contract
                                   :sql (compile-contract->sql contract)}))))))
      (.catch (fn [err]
                (do-json 500 {:detail (str "Redis error: " (.-message err))})))))

(defn- handle-copy-contract
  [do-json client source-id new-id]
  (-> (redis/get-json client (contract-key source-id))
      (.then (fn [source-edn]
               (let [text (or source-edn "")
                     cloned (if (str/includes? text ":contract/id")
                              (str/replace text #":contract/id\s+\"[^\"]+\"" (str ":contract/id \"" new-id "\""))
                              (str ":contract/id \"" new-id "\"\n" text))
                     validation (validate-contract-edn cloned)]
                 (-> (redis/set-json client (contract-key new-id) cloned)
                     (.then (fn [_]
                              (redis/sadd client contracts-index-key new-id)))
                     (.then (fn [_]
                              (do-json 200 {:ok true
                                            :ednText cloned
                                            :contract (:contract validation)
                                            :validation (dissoc validation :contract)}))))))
      (.catch (fn [err]
                (do-json 500 {:detail (str "Redis error: " (.-message err))}))))))

;; ---------------------------------------------------------------------------
;; Route registration
;; ---------------------------------------------------------------------------

(defn register-contracts-routes!
  [app runtime helpers]
  (let [do-route (:route! helpers)
        do-json (:json-response! helpers)
        do-err (:error-response! helpers)
        do-ctx (:with-request-context! helpers)
        do-perm (:ensure-permission! helpers)]

    ;; List
    (do-route app "GET" "/api/admin/contracts"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (do-perm ctx "platform.org.create")
                      (if-let [client (redis/get-client)]
                        (handle-list-contracts (partial do-json reply) client)
                        (do-json reply 503 {:detail "Redis not connected"}))
                      (catch :default err
                        (do-err reply err)))))))

    ;; Get
    (do-route app "GET" "/api/admin/contracts/:contractId"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (do-perm ctx "platform.org.create")
                      (let [contract-id (str (or (aget request "params" "contractId") ""))]
                        (if (str/blank? contract-id)
                          (do-json reply 400 {:detail "contractId is required"})
                          (if-let [client (redis/get-client)]
                            (handle-get-contract (partial do-json reply) client contract-id)
                            (do-json reply 503 {:detail "Redis not connected"}))))
                      (catch :default err
                        (do-err reply err)))))))

    ;; Save
    (do-route app "PUT" "/api/admin/contracts/:contractId"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (do-perm ctx "platform.org.create")
                      (let [contract-id (str (or (aget request "params" "contractId") ""))
                            body (js->clj (or (aget request "body") #js {}) :keywordize-keys true)
                            edn-text (str (or (:ednText body) ""))
                            validation (validate-contract-edn edn-text)
                            client (redis/get-client)]
                        (cond
                          (str/blank? contract-id)
                          (do-json reply 400 {:detail "contractId is required"})

                          (not client)
                          (do-json reply 503 {:detail "Redis not connected"})

                          :else
                          (handle-save-contract (partial do-json reply) client contract-id edn-text validation)))
                      (catch :default err
                        (do-err reply err)))))))

    ;; Validate
    (do-route app "POST" "/api/admin/contracts/validate"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (do-perm ctx "platform.org.create")
                      (let [body (js->clj (or (aget request "body") #js {}) :keywordize-keys true)
                            edn-text (str (or (:ednText body) ""))
                            validation (validate-contract-edn edn-text)]
                        (do-json reply 200 validation))
                      (catch :default err
                        (do-err reply err)))))))

    ;; Compile
    (do-route app "POST" "/api/admin/contracts/:contractId/compile"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (do-perm ctx "platform.org.create")
                      (let [contract-id (str (or (aget request "params" "contractId") ""))]
                        (if (str/blank? contract-id)
                          (do-json reply 400 {:detail "contractId is required"})
                          (if-let [client (redis/get-client)]
                            (handle-compile-contract (partial do-json reply) client contract-id)
                            (do-json reply 503 {:detail "Redis not connected"}))))
                      (catch :default err
                        (do-err reply err)))))))

    ;; Copy
    (do-route app "POST" "/api/admin/contracts/:contractId/copy"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (do-perm ctx "platform.org.create")
                      (let [source-id (str (or (aget request "params" "contractId") ""))
                            body (js->clj (or (aget request "body") #js {}) :keywordize-keys true)
                            new-id (str (or (:newId body) ""))]
                        (if (or (str/blank? source-id) (str/blank? new-id))
                          (do-json reply 400 {:detail "source contractId and newId are required"})
                          (if-let [client (redis/get-client)]
                            (handle-copy-contract (partial do-json reply) client source-id new-id)
                            (do-json reply 503 {:detail "Redis not connected"}))))
                      (catch :default err
                        (do-err reply err)))))))

    ;; ── Contract Agent API (EDN-native) ─────────────────────────────────

    ;; Agent list contracts (returns raw EDN vector)
    (do-route app "GET" "/api/agent/contracts"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (when ctx (do-perm ctx "agent.chat.use"))
                      (if-let [client (redis/get-client)]
                        (handle-agent-list-contracts
                          (fn [status text]
                            (.end reply (.status reply status) text #js {"Content-Type" "text/plain; charset=utf-8"}))
                          client)
                        (.end reply (.status reply 503) ";; Redis not connected"))
                      (catch :default err
                        (do-err reply err)))))))

    ;; Agent get contract EDN (returns raw EDN text)
    (do-route app "GET" "/api/agent/contracts/:contractId"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (when ctx (do-perm ctx "agent.chat.use"))
                      (let [contract-id (str (or (aget request "params" "contractId") ""))]
                        (if (str/blank? contract-id)
                          (.end reply (.status reply 400) ";; contractId is required")
                          (if-let [client (redis/get-client)]
                            (handle-agent-get-contract-edn
                              (fn [status text]
                                (.end reply (.status reply status) text #js {"Content-Type" "text/plain; charset=utf-8"}))
                              client contract-id)
                            (.end reply (.status reply 503) ";; Redis not connected"))))
                      (catch :default err
                        (do-err reply err)))))))

    ;; Agent save contract EDN (accepts raw EDN text body)
    (do-route app "PUT" "/api/agent/contracts/:contractId"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (when ctx (do-perm ctx "agent.chat.use"))
                      (let [contract-id (str (or (aget request "params" "contractId") ""))
                            edn-text (str (or (aget request "body") ""))]
                        (if (str/blank? contract-id)
                          (.end reply (.status reply 400) ";; contractId is required")
                          (if-let [client (redis/get-client)]
                            (handle-agent-put-contract-edn
                              (fn [status text]
                                (.end reply (.status reply status) text #js {"Content-Type" "text/plain; charset=utf-8"}))
                              client contract-id edn-text)
                            (.end reply (.status reply 503) ";; Redis not connected"))))
                      (catch :default err
                        (do-err reply err)))))))

    ;; Seed contracts from event-agent jobs
    (do-route app "POST" "/api/admin/contracts/seed-from-event-agents"
              (fn [request reply]
                (do-ctx runtime request reply
                  (fn [ctx]
                    (try
                      (do-perm ctx "platform.org.create")
                      (if-let [client (redis/get-client)]
                        (handle-seed-from-event-agents
                          (fn [status text]
                            (.end reply (.status reply status) text #js {"Content-Type" "text/plain; charset=utf-8"}))
                          client)
                        (.end reply (.status reply 503) ";; Redis not connected"))
                      (catch :default err
                        (do-err reply err)))))))

    nil))

;; ===========================================================================
;; Contract Agent API: EDN-native endpoints
;; ===========================================================================
;; These endpoints serve and accept raw EDN text, designed for the contract
;; agent to read/write contracts without JSON wrapping. The contract agent
;; uses these instead of the admin CRUD routes.

(defn- handle-agent-list-contracts
  "Return a vector of contract IDs as EDN text."
  [do-text client]
  (-> (redis/smembers client contracts-index-key)
      (.then
       (fn [ids]
         (let [ids (sort (map str (js/Array.from (or ids #js []))))]
           (do-text 200 (pr-str ids)))))
      (.catch (fn [err]
                (do-text 500 (str ";; Redis error: " (.-message err)))))))

(defn- handle-agent-get-contract-edn
  "Return raw EDN text for a contract. Returns the EDN as-is from Redis."
  [do-text client contract-id]
  (-> (redis/get-json client (contract-key contract-id))
      (.then (fn [edn-text]
               (if (str/blank? (str edn-text))
                 (do-text 404 (str ";; Contract not found: " contract-id))
                 (do-text 200 (str edn-text)))))
      (.catch (fn [err]
                (do-text 500 (str ";; Redis error: " (.-message err)))))))

(defn- handle-agent-put-contract-edn
  "Accept raw EDN text and store it. Validates before saving.
   Returns validation result as EDN."
  [do-text client contract-id edn-text]
  (let [validation (validate-contract-edn edn-text)]
    (if-not (:ok validation)
      (do-text 422 (pr-str {:ok false
                            :errors (:errors validation)}))
      (-> (redis/set-json client (contract-key contract-id) edn-text)
          (.then (fn [_] (redis/sadd client contracts-index-key contract-id)))
          (.then (fn [_]
                   (do-text 200 (pr-str {:ok true
                                         :contract/id contract-id
                                         :contract (:contract validation)})))))
      (.catch (fn [err]
                (do-text 500 (str ";; Redis error: " (.-message err))))))))

;; ===========================================================================
;; Seed: Bootstrap EDN contracts from event-agent control config
;; ===========================================================================

(defn- event-agent-job->contract-edn
  "Convert an event-agent job map from runtime-config into a contract EDN string."
  [job]
  (let [id (:id job)
        trigger (:trigger job)
        source (:source job)
        filters (:filters job)
        agent-spec (:agentSpec job)
        events-always (or (get-in trigger [:eventKinds]) [])
        events-maybe []
        role (or (:role agent-spec) "knowledge_worker")
        model (or (:model agent-spec) "glm-5")
        thinking (or (:thinkingLevel agent-spec) "off")
        system-prompt (or (:systemPrompt agent-spec) "")
        task-prompt (or (:taskPrompt agent-spec) "")
        channels (or (get-in filters [:channels]) [])
        keywords (or (get-in filters [:keywords]) [])
        cadence (or (get-in trigger [:cadenceMinutes]) 5)]
    (str "{::contract/id \"" id "\"\n"
         " ::contract/kind :agent\n"
         " :contract/version 1\n"
         " :enabled " (if (:enabled job) "true" "false") "\n"
         " :trigger-kind " (pr-str (keyword (or (:kind trigger) "event"))) "\n"
         " :source-kind " (pr-str (keyword (or (:kind source) "discord"))) "\n"
         " :source-mode " (pr-str (keyword (or (:mode source) "patrol"))) "\n"
         " :cadence-min " cadence "\n"
         "\n"
         " :agent\n"
         " {:role " (pr-str (keyword role)) "\n"
         "  :model \"" model "\"\n"
         "  :thinking " (pr-str (keyword thinking)) "}\n"
         "\n"
         " :prompts\n"
         " {:system " (pr-str system-prompt) "\n"
         "  :task   " (pr-str task-prompt) "}\n"
         "\n"
         " :events\n"
         " {:always " (pr-str (mapv keyword events-always)) "\n"
         "  :maybe  " (pr-str (mapv keyword events-maybe)) "}\n"
         "\n"
         " :data\n"
         " {:source  {:max-messages 25}\n"
         "  :filters {:channels " (pr-str (vec channels)) "\n"
         "            :keywords " (pr-str (vec keywords)) "}\n"
         "  :tools   []}\n"
         "\n"
         " :hooks\n"
         " {:before {}\n"
         "  :after  {}}}\n")))

(defn- handle-seed-from-event-agents
  "Create EDN contracts for all event-agent jobs that don't already have one.
   Returns summary of seeded contracts as EDN."
  [do-text client]
  (let [config (runtime-config/cfg)
        control (runtime-config/event-agent-control-config config)
        jobs (or (:jobs control) [])]
    (-> (redis/smembers client contracts-index-key)
        (.then (fn [existing-ids]
                 (let [existing-set (set (map str (js/Array.from (or existing-ids #js []))))
                       unseeded (remove (fn [job] (contains? existing-set (:id job))) jobs)]
                   (if (empty? unseeded)
                     (do-text 200 (pr-str {:seeded []
                                           :skipped (count jobs)
                                           :message "All event-agent jobs already have contracts"}))
                     (-> (js/Promise.all
                          (clj->js
                           (for [job unseeded]
                             (let [edn-text (event-agent-job->contract-edn job)
                                   id (:id job)]
                               (-> (redis/set-json client (contract-key id) edn-text)
                                   (.then (fn [_] (redis/sadd client contracts-index-key id))))))))
                         (.then (fn [_]
                                  (do-text 200 (pr-str {:seeded (mapv :id unseeded)
                                                        :skipped (count jobs)
                                                        :message (str "Seeded " (count unseeded) " contracts from event-agent jobs")})))))))))
        (.catch (fn [err]
                  (do-text 500 (str ";; Redis error: " (.-message err))))))))
