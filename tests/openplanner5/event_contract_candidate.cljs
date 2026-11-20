;; Test-only composed /v1 app with real loopback HTTP and disposable MongoDB.
;; Run: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/openplanner5/event_contract_candidate.cljs
(ns contract-candidate (:require [event-slice :as slice] [lossless-json :as lj] [clojure.string]))

(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_app_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(def bulk-calls (atom {}))
(def kafka-calls (atom 0))
(defn metrics-line [base]
  (-> (js/fetch (str base "/v1/metrics")) (.then #(.text %)) (.then (fn [s] (first (filter #(.startsWith % "openplanner_events_ingested_total{") (clojure.string/split-lines s)))))))
(defn wait-hot [db id remaining]
  (-> (.countDocuments (.collection db "event_chunks") #js {:parent_id id})
      (.then (fn [n] (if (or (pos? n) (zero? remaining)) n (-> (js/Promise. #(js/setTimeout %1 50)) (.then #(wait-hot db id (dec remaining)))))))))
(declare check!)
(def detached-warnings (atom []))
(defn capture-log! [line]
  (try (let [record (js->clj (js/JSON.parse line) :keywordize-keys true)
             msg (:msg record) error (get-in record [:err :message])]
         (when (contains? #{"Failed to index event into MongoDB vectors; preserving base event without embeddings" "Failed to materialize graph node embeddings during event ingest"} msg)
           (swap! detached-warnings conj {:message msg :event-id (:eventId record) :count (:count record) :error error})))
       (catch :default _ nil))
  (.write (.-stdout js/process) line))
(defn wait-warnings [remaining]
  (if (or (>= (count @detached-warnings) 2) (zero? remaining)) (js/Promise.resolve)
      (-> (js/Promise. #(js/setTimeout %1 20)) (.then #(wait-warnings (dec remaining))))))
(defn check-detached! []
  (let [vectors (filter #(= "Failed to index event into MongoDB vectors; preserving base event without embeddings" (:message %)) @detached-warnings)
        graphs (filter #(= "Failed to materialize graph node embeddings during event ingest" (:message %)) @detached-warnings)]
    (check! "runtime fault logs vector and graph failures" [1 1] [(count vectors) (count graphs)])
    (doseq [item @detached-warnings] (println "FAULT-WARNING" (pr-str item)))))

(def background-tasks (atom []))
(def wrapped-calls (atom []))
(def model-scopes (atom []))
(def model-generation-order (atom []))
(def slow-reject (atom nil))
(defn wait-slow [remaining]
  (if (or @slow-reject (zero? remaining)) (js/Promise.resolve (some? @slow-reject))
      (-> (js/Promise. #(js/setTimeout %1 20)) (.then #(wait-slow (dec remaining))))))
(defn synthetic-embedding [texts]
  (if (some #(= "Topic: Slow" %) (vec texts))
    (js/Promise. (fn [_ reject] (reset! slow-reject reject)))
    (js/Promise.resolve (clj->js (mapv (fn [_] [0.25 0.75]) (vec texts))))))
(def embedding-calls (atom []))
(defn wait-embeddings [collection n]
  (letfn [(poll [remaining] (-> (.countDocuments collection #js {})
                                (.then (fn [count] (if (or (>= count n) (zero? remaining)) count
                                                     (-> (js/Promise. #(js/setTimeout %1 20)) (.then #(poll (dec remaining)))))))))]
    (poll 100)))
(defn check! [label expected actual]
  (if (= expected actual) (println "PASS" label)
      (do (swap! failures inc) (println "FAIL" label "expected" (pr-str expected) "got" (pr-str actual)))))
(defn request [base body auth? path]
  (-> (js/fetch (str base path) (clj->js {:method "POST" :headers (cond-> {"content-type" "application/json"} auth? (assoc "authorization" "Bearer isolated-test-key")) :body (js/JSON.stringify (lj/encode body))}))
      (.then (fn [response] (-> (.json response) (.then (fn [body] {:status (.-status response) :body (js->clj body :keywordize-keys true)})))))))

(defn event [id ts extra text]
  (cond-> {:schema "openplanner.event.v1" :id id :ts ts :source "discord" :kind "discord.message" :extra extra}
    (some? text) (assoc :text text)))
(defn request-with [base body headers]
  (-> (js/fetch (str base "/v1/events") (clj->js {:method "POST" :headers (merge {"content-type" "application/json"} headers) :body (js/JSON.stringify (lj/encode body))}))
      (.then (fn [r] (-> (.json r) (.then (fn [body] {:status (.-status r) :body (js->clj body :keywordize-keys true)})))))))
(defn check-invalid! [base auth cases]
  (reduce (fn [p [ev message]]
            (.then p (fn []
                       (-> (request-with base {:events [ev]} auth)
                           (.then (fn [r] (check! (str "validation " message) [500 message] [(:status r) (get-in r [:body :message])])))))))
          (js/Promise.resolve) cases))
(defn run-cases [base db]
  (let [c (.collection db "events") tenants (.collection db "tenants") auth {"authorization" "Bearer isolated-test-key"}
        good {:schema "openplanner.event.v1" :id "ordinary" :ts "2026-01-01T00:00:00Z" :source "synthetic" :kind "note"}
        empty-response {:ok true :count 0 :ids [] :projectedGraphEdges 0 :ftsEnabled true :storageBackend "mongodb" :indexed true :indexing "skipped" :queuedEventVectors 0 :queuedGraphNodeEmbeddings 0}
        invalids [[{} "event.schema must be openplanner.event.v1"] [(dissoc good :id) "event.id required"] [(dissoc good :ts) "event.ts required (ISO)"] [(dissoc good :source) "event.source required"] [(dissoc good :kind) "event.kind required"]]]
    (-> (.insertMany tenants #js [#js {:tenant_id "active-fixture" :status "active"} #js {:tenant_id "suspended-fixture" :status "suspended"}])
        (.then (fn [] (request-with base {} {})))
        (.then (fn [r] (check! "unauthenticated request rejected before body validation" 401 (:status r)) (request-with base {} {"authorization" "Bearer wrong"})))
        (.then (fn [r] (check! "wrong key rejected" 401 (:status r)) (request-with base {} auth)))
        (.then (fn [r] (check! "malformed body response" [400 "expected { events: [...] }"] [(:status r) (get-in r [:body :error])]) (request-with base {:events []} auth)))
        (.then (fn [r] (check! "empty batch exact JSON response" [200 empty-response] [(:status r) (:body r)])
                 (check-invalid! base auth invalids)))
        (.then (fn [] (request-with base {:events [good]} (assoc auth "x-tenant-id" "suspended-fixture"))))
        (.then (fn [r] (check! "suspended tenant rejected" [403 "Tenant is suspended"] [(:status r) (get-in r [:body :message])]) (.countDocuments c #js {:id "ordinary"})))
        (.then (fn [n] (check! "suspended tenant has no event write" 0 n) (request-with base {:events []} (assoc auth "x-tenant-id" "active-fixture"))))
        (.then (fn [r] (check! "active tenant accepted" 200 (:status r)) (request-with base {:events []} (assoc auth "x-tenant-id" "missing-fixture"))))
        (.then (fn [r] (check! "unknown tenant allowed in non-strict mode" 200 (:status r))
                 (request-with base {:events [(assoc good :id "ordinary-fields" :source_ref {:project 42 :session false :message 0} :meta {:role false :author 0 :model {:a 1} :tags false} :schema_version 7 :migration_state {"custom/key" true} :attachments [] :extra {"feature/key" {"nested/key" 1}})]} {"authorization" "bEaReR isolated-test-key"})))
        (.then (fn [r] (check! "mixed-case bearer accepted" 200 (:status r)) (.findOne c #js {:id "ordinary-fields"})))
        (.then (fn [doc] (check! "base source/meta normalization and raw optional fields" ["42" "false" "0" "false" "0" "[object Object]" false 7 {"custom/key" true} [] {"feature/key" {"nested/key" 1}}]
                                [(.-project doc) (.-session doc) (.-message doc) (.-role doc) (.-author doc) (.-model doc) (.-tags doc) (.-schema_version doc) (js->clj (.-migration_state doc)) (js->clj (.-attachments doc)) (js->clj (.-extra doc))])
                 (request-with base {:events [(assoc good :id "invalid-date" :ts "not-a-date")]} auth)))
        (.then (fn [r] (check! "invalid date without label accepted" 200 (:status r)) (.findOne c #js {:id "invalid-date"})))
        (.then (fn [doc] (check! "invalid date stored as BSON epoch" "1970-01-01T00:00:00.000Z" (.toISOString (.-ts doc)))
                 (request-with base {:events [(assoc good :id "invalid-date-label" :ts "not-a-date" :extra {:openplanner_labels {:labels ["BadDate"]}})]} auth)))
        (.then (fn [r] (check! "invalid labeled date fails after admission" [500 "Invalid time value"] [(:status r) (get-in r [:body :message])])
                 (js/Promise.all #js [(.countDocuments c #js {:id "invalid-date-label"}) (.countDocuments (.collection db "graph_label_nodes") #js {:label_id "label:default:baddate"}) (.countDocuments (.collection db "graph_edges") #js {:source_node_id "invalid-date-label"})])))
        (.then (fn [n] (check! "invalid labeled date preserves base only" [1 0 0] (js->clj n))))
        (.then (fn [] (-> (js/fetch (str base "/v1/events") #js {:method "OPTIONS"}) (.then (fn [r] (check! "preflight succeeds without auth" 204 (.-status r)))))))
        (.then (fn [] (js/Promise. #(js/setTimeout %1 500)))))))

(defn compose-app [modules cfg]
  (let [fastify (.-default (aget modules 3)) app (fastify #js {:logger #js {:stream #js {:write capture-log!}} :bodyLimit (* 50 1024 1024) :pluginTimeout 120000})
        targets (atom #{})]
    (aset app "openplannerConfig" cfg)
    (aset app "embeddingRuntime" #js {:hot #js {:getModel (fn [scope] (swap! model-scopes conj (js->clj scope :keywordize-keys true)) (let [p (.-project scope)] (if (and (string? p) (.startsWith p "order-")) p "synthetic-model")))
                                                  :getBackgroundEmbeddingFunction (fn [_] #js {:generate (fn [texts] (synthetic-embedding texts))})
                                                  :getBackgroundEmbeddingFunctionForModel (fn [model] #js {:generate (fn [texts] (swap! model-generation-order conj model) (swap! embedding-calls conj (js->clj texts)) (if (some #(= "Topic: Reject" %) (vec texts)) (js/Promise.reject (js/Error. "synthetic embedding failure")) (synthetic-embedding texts)))})}})
    (.addHook app "onRoute" (fn [route]
                              (when (and (= "POST" (.-method route))
                                         (contains? #{"/v1/graph/connections" "/v1/events"} (.-url route)))
                                (swap! targets conj (.-url route))
                                (when (= "/v1/events" (.-url route))
                                  (set! (.-handler route)
                                        (fn [req reply]
                                          (let [app (.-server req) id (some-> req .-body .-events (aget 0) .-id)
                                                target (case id "second-nodes" (.. app -mongo -events) "second-labels" (.. app -mongo -graphLabelNodes) nil)
                                                old (when target (.-bulkWrite target)) runtime? (= id "runtime-missing") old-runtime (when runtime? (.-embeddingRuntime app)) lookup? (= id "lookup-throws") old-find (when lookup? (.. app -mongo -events -findOne)) kafka (when target (.-kafkaEvents app)) old-kafka (when kafka (.-publishRawEvents kafka))]
                                            (when runtime? (set! (.-embeddingRuntime app) nil))
                                            (when lookup? (set! (.. app -mongo -events -findOne) (fn [& _] (throw (js/Error. "injected synchronous lookup failure")))))
                                            (when target (set! (.-bulkWrite target) (fn [ops options] (let [sizes (get (swap! bulk-calls update id (fnil conj []) (.-length ops)) id)] (if (= 2 (count sizes)) (js/Promise.reject (js/Error. "injected second batch failure")) (.call old target ops options))))))
                                            (when kafka (set! (.-publishRawEvents kafka) (fn [& args] (swap! kafka-calls inc) (.apply old-kafka kafka (to-array args)))))
                                            (-> (js/Promise.resolve (slice/handler app (.-eventAdmission ((.-createProtocols (aget modules 12)) app)) (.-counterInc (aget modules 13)) (.-indexTextInMongoVectors (aget modules 14)) (.-prepareIndexDocument (aget modules 15)) (.-splitSentences (aget modules 16)) (fn [task] (swap! background-tasks conj task)) req reply))
                                                (.finally (fn [] (when runtime? (set! (.-embeddingRuntime app) old-runtime)) (when lookup? (set! (.. app -mongo -events -findOne) old-find)) (when target (set! (.-bulkWrite target) old)) (when kafka (set! (.-publishRawEvents kafka) old-kafka))))))))))))

    (-> (.register app (.-default (aget modules 5)))
        (.then #(.register app (.-default (aget modules 6)) #js {:limits #js {:fileSize (* 200 1024 1024)}}))
        (.then #(.register app (.-authPlugin (aget modules 7)) cfg))
        (.then #(.register app (.-mongodbPlugin (aget modules 8)) cfg))
        (.then #(.register app (.-tenantPlugin (aget modules 9)) #js {:strict false}))
        (.then #(.register app (.-kafkaEventsPlugin (aget modules 10))))
        (.then #(.register app (.-v1Routes (aget modules 11)) #js {:prefix "/v1"}))
        (.then (fn []
                 (.get app "/" (fn [_req _reply] #js {:ok true :name "openplanner" :version "0.3.0" :storageBackend "mongodb"}))
                 (check! "onRoute saw target registrations" #{"/v1/graph/connections" "/v1/events"} @targets)
                 app)))))

(defn run-app [modules]
  (let [client (new (.-MongoClient (aget modules 2)) (str uri "/?directConnection=true"))
        db (.db client db-name)
        app-ref (atom nil)]
    (-> (.connect client)
        (.then (fn [] (compose-app modules ((.-loadConfig (aget modules 1))))) )
        (.then (fn [app] (reset! app-ref app) (.listen app #js {:host "127.0.0.1" :port 0})))
        (.then (fn [base] (run-cases base db)))
        (.then (fn [] (-> (js/Promise.allSettled (to-array @background-tasks)) (.then (fn [results] (check! "all tracked background tasks settled before cleanup" (count @background-tasks) (.-length results)))))))
        (.finally (fn [] (-> (if @app-ref (.close @app-ref) (js/Promise.resolve))
                             (.then #(.dropDatabase db))
                             (.then (fn [dropped] (println "Database dropped:" db-name dropped) (.close client)))))))))

(if-not (and uri (re-matches #"mongodb://127\.0\.0\.1:[0-9]+/?" uri))
  (do (js/console.error "OPENPLANNER_E2E_MONGO_URI must name disposable loopback MongoDB") (set! (.-exitCode js/process) 2))
  (do
    (set! (.-MONGODB_URI js/process.env) (str uri "/?directConnection=true"))
    (set! (.-MONGODB_DB js/process.env) db-name)
    (set! (.-OPENPLANNER_API_KEY js/process.env) "isolated-test-key")
    (set! (.-OPENPLANNER_KAFKA_ENABLED js/process.env) "false")
    (set! (.-OPENPLANNER_KAFKA_PUBLISH_MODE js/process.env) "await")
    (set! (.-OPENPLANNER_DATA_DIR js/process.env) (str "/tmp/" db-name))
    (set! (.-EMBED_PROVIDER_BASE_URL js/process.env) "http://127.0.0.1:1")
    (-> (js/Promise.all #js [(js/import "../../src/app.ts") (js/import "../../src/lib/config.ts") (js/import "mongodb")
                              (js/import "fastify") (js/import "../../src/lib/embedding-runtime.ts")
                              (js/import "@fastify/sensible") (js/import "@fastify/multipart")
                              (js/import "../../src/plugins/auth.ts") (js/import "../../src/plugins/mongodb.ts")
                              (js/import "../../src/plugins/tenant.ts") (js/import "../../src/plugins/kafka-events.ts")
                              (js/import "../../src/routes/v1/index.ts") (js/import "../../src/lib/protocol-adapters.ts") (js/import "../../src/lib/metrics.ts") (js/import "../../src/lib/mongo-vectors.ts") (js/import "../../src/lib/indexing.ts") (js/import "../../src/lib/sentence-split.ts")])
        (.then run-app)
        (.then (fn [] (when (pos? @failures) (set! (.-exitCode js/process) 1))))
        (.catch (fn [err] (js/console.error err) (set! (.-exitCode js/process) 2))))))
