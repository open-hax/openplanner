;; Test-only CLJS graph + partial event composition; no production registration.
;; Run from repo root: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/graph_event_combined_probe.cljs
(ns graph-event-combined-probe
  (:require [openplanner.routes.graph-connections :as graph] [event-slice :as event]))
(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_combined_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(def background (atom []))
(defn check! [label expected actual]
  (if (= expected actual) (println "PASS" label)
      (do (swap! failures inc) (println "FAIL" label "expected" (pr-str expected) "got" (pr-str actual)))))
(defn post [base path payload reference? auth?]
  (-> (js/fetch (str base path) (clj->js {:method "POST" :headers (cond-> {"content-type" "application/json"}
                                                                            auth? (assoc "authorization" "Bearer isolated-test-key")
                                                                            reference? (assoc "x-reference" "1"))
                                           :body (js/JSON.stringify (clj->js payload))}))
      (.then (fn [response] (-> (.json response) (.then (fn [body] {:status (.-status response) :body (js->clj body :keywordize-keys true)})))))))
(defn graph-fixture [suffix uid]
  (let [message (str "discord:g:c:" suffix) user (str "discord:user:" uid) profile (str "bluesky:user:" suffix ".example")]
    {:message message :user user :profile profile :handle (str suffix ".example")}))
(def reference-fixture (graph-fixture "reference" "42"))
(def port-fixture (graph-fixture "candidate" "43"))
(defn seed-fixture [base db {:keys [message user profile handle]} reference?]
  (-> (.insertOne (.collection db "events") (clj->js {:id message :ts (js/Date. "2026-01-01T00:00:00Z") :extra {:guild_id "g" :channel_id "c"}}))
      (.then (fn [] (post base "/v1/events" {:events [{:schema "openplanner.event.v1" :id (str "auth:" message) :ts "2026-01-01T00:00:01Z" :source "synthetic" :kind "graph.edge" :extra {:source_node_id message :target_node_id user :edge_kind "authored_by"}}
                                                        {:schema "openplanner.event.v1" :id (str "mention:" message) :ts "2026-01-01T00:00:02Z" :source "synthetic" :kind "graph.edge" :extra {:source_node_id message :target_node_id profile :edge_kind "mentions_bluesky_user" :handle handle}}]} reference? true)))
      (.then (fn [r] (check! (str (if reference? "reference" "candidate") " ingests authorship graph edges") 200 (:status r))))))

(defn graph-body [{:keys [message user profile]} n] {:seed_node_ids [message user profile] :max_nodes n})
(defn textless [id] {:events [{:schema "openplanner.event.v1" :id id :ts "2026-01-01T00:01:00Z" :source "discord" :kind "discord.message"
                             :extra {:guild_id "g" :channel_id "c" :previous_message_id "old" :topics ["Orbit"] :attachments [{:id "attachment" :filename "a.png"}]}}]})
(defn run-cases [base db]
  (-> (post base "/v1/graph/connections" {} false false)
      (.then (fn [r] (check! "graph auth retained" 401 (:status r)) (post base "/v1/events" {} false false)))
      (.then (fn [r] (check! "event auth retained" 401 (:status r)) (post base "/v1/events" {} false true)))
      (.then (fn [r] (check! "candidate invalid event status" 400 (:status r)) (post base "/v1/events" {} true true)))
      (.then (fn [r] (check! "reference invalid event status" 400 (:status r)) (seed-fixture base db reference-fixture true)))
      (.then (fn [] (seed-fixture base db port-fixture false)))
      (.then (fn [] (post base "/v1/graph/connections" (graph-body reference-fixture 3) true true)))
      (.then (fn [r] (check! "reference full-cap graph status" 200 (:status r)) (check! "reference full-cap graph loses edges" 0 (count (get-in r [:body :edges])))
               (post base "/v1/graph/connections" (graph-body port-fixture 3) false true)))
      (.then (fn [r] (check! "candidate full-cap graph status" 200 (:status r)) (check! "candidate retains both full-cap edges" #{[(:message port-fixture) (:user port-fixture) "authored_by"] [(:message port-fixture) (:profile port-fixture) "mentions_bluesky_user"]} (set (map (juxt :source :target :kind) (get-in r [:body :edges]))))
               (post base "/v1/graph/connections" (graph-body reference-fixture 4) true true)))
      (.then (fn [r] (check! "reference author-linked profile absent" [] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))
               (post base "/v1/graph/connections" (graph-body port-fixture 4) false true)))
      (.then (fn [r] (check! "candidate author-linked profile present" ["43" [(:handle port-fixture)] true] (let [bridge (get-in r [:body :stats :peopleBridges 0])] [(:userId bridge) (:blueskyProfiles bridge) (:isBlueskyConnected bridge)]))
               (post base "/v1/events" (textless "discord:g:c:reference-textless") true true)))
      (.then (fn [r] (check! "reference textless ingest status" 200 (:status r))
               (.toArray (.find (.collection db "graph_edges") #js {:source_node_id "discord:g:c:reference-textless"}))))
      (.then (fn [rows] (let [kinds (set (map :edge_kind (js->clj rows :keywordize-keys true)))]
                          (doseq [kind ["preceded_by" "mentions_topic" "has_attachment"]] (check! (str "reference lacks " kind) false (contains? kinds kind))))
               (post base "/v1/events" (textless "discord:g:c:candidate-textless") false true)))
      (.then (fn [r] (check! "candidate textless ingest status" 200 (:status r))
               (.toArray (.find (.collection db "graph_edges") #js {:source_node_id "discord:g:c:candidate-textless"}))))
      (.then (fn [rows] (let [kinds (set (map :edge_kind (js->clj rows :keywordize-keys true)))]
                          (doseq [kind ["preceded_by" "mentions_topic" "has_attachment"]] (check! (str "candidate projects " kind) true (contains? kinds kind)))
                          (let [triples (set (map (juxt :source_node_id :target_node_id :edge_kind) (js->clj rows :keywordize-keys true))) source "discord:g:c:candidate-textless"]
                            (check! "candidate projected exact endpoint triples" true (every? triples [[source "discord:g:c:old" "preceded_by"] [source "topic:orbit" "mentions_topic"] [source "discord:attachment:attachment" "has_attachment"]]))))))
      (.then (fn [] (post base "/v1/graph/connections" {:seed_node_ids ["discord:g:c:candidate-textless" "topic:orbit" "discord:attachment:attachment"] :max_nodes 3} false true)))
      (.then (fn [r] (check! "candidate graph reads candidate-ingested edges" #{"mentions_topic" "has_attachment"} (set (map :kind (get-in r [:body :edges]))))
               (post base "/v1/graph/connections" {:seed_node_ids ["discord:g:c:candidate-textless" "topic:orbit" "discord:attachment:attachment"] :max_nodes 3} true true)))
      (.then (fn [r] (check! "reference graph still loses same cap-bound edges" 0 (count (get-in r [:body :edges])))))
      (.then (fn [] (-> (js/fetch (str base "/")) (.then #(.json %)))))
      (.then (fn [body] (check! "unrelated root retained" "openplanner" (.-name body))))))
(defn compose-app [modules cfg]
  (let [app ((.-default (aget modules 3)) #js {:logger true :bodyLimit (* 50 1024 1024) :pluginTimeout 120000})]
    (aset app "openplannerConfig" cfg)
    ;; Explicit synthetic embedding provider; Kafka is disabled by the isolated environment.
    (aset app "embeddingRuntime" #js {:hot #js {:getModel (fn [_] "synthetic-model")
      :getBackgroundEmbeddingFunction (fn [_] #js {:generate (fn [texts] (js/Promise.resolve (clj->js (mapv (fn [_] [0.25 0.75]) (vec texts)))) )})
      :getBackgroundEmbeddingFunctionForModel (fn [_] #js {:generate (fn [texts] (js/Promise.resolve (clj->js (mapv (fn [_] [0.25 0.75]) (vec texts)))) )})}})
    (.addHook app "onRoute" (fn [route]
      (when (and (= "POST" (.-method route)) (contains? #{"/v1/graph/connections" "/v1/events"} (.-url route)))
        (let [original (.-handler route) url (.-url route)]
          (set! (.-handler route) (fn [req reply]
            (if (= "1" (aget (.-headers req) "x-reference")) (.call original (.-server req) req reply)
              (if (= url "/v1/graph/connections") (graph/handler req reply)
                (event/handler (.-server req) (.-eventAdmission ((.-createProtocols (aget modules 12)) (.-server req)))
                  (.-counterInc (aget modules 13)) (.-indexTextInMongoVectors (aget modules 14))
                  (.-prepareIndexDocument (aget modules 15)) (.-splitSentences (aget modules 16))
                  (fn [task] (swap! background conj task)) req reply)))))))))
    (-> (.register app (.-default (aget modules 5)))
        (.then #(.register app (.-default (aget modules 6)) #js {:limits #js {:fileSize (* 200 1024 1024)}}))
        (.then #(.register app (.-authPlugin (aget modules 7)) cfg))
        (.then #(.register app (.-mongodbPlugin (aget modules 8)) cfg))
        (.then #(.register app (.-tenantPlugin (aget modules 9)) #js {:strict false}))
        (.then #(.register app (.-kafkaEventsPlugin (aget modules 10))))
        (.then #(.register app (.-v1Routes (aget modules 11)) #js {:prefix "/v1"}))
        (.then (fn [] (.get app "/" (fn [_ _] #js {:ok true :name "openplanner" :version "0.3.0" :storageBackend "mongodb"})) app)))))
(defn run-app [modules]
  (let [client (new (.-MongoClient (aget modules 2)) (str uri "/?directConnection=true")) db (.db client db-name) app-ref (atom nil)]
    (-> (.connect client)
        (.then (fn [] (compose-app modules ((.-loadConfig (aget modules 1))))))
        (.then (fn [app] (reset! app-ref app) (.listen app #js {:host "127.0.0.1" :port 0})))
        (.then (fn [base] (run-cases base db)))
        (.finally (fn [] (-> (js/Promise.allSettled (clj->js @background))
                             (.then (fn [results] (let [statuses (mapv #(.-status %) (vec results))] (println "Tracked background task statuses:" (pr-str statuses)) (check! "tracked background tasks fulfilled" true (every? #{"fulfilled"} statuses)))))
                             (.then (fn [] (if @app-ref (.close @app-ref) (js/Promise.resolve))))
                             (.then #(.dropDatabase db))
                             (.then (fn [dropped] (println "Database dropped:" db-name dropped) (.close client)))))))))
(if-not (and uri (re-matches #"mongodb://127\.0\.0\.1:[0-9]+/?" uri))
  (do (js/console.error "OPENPLANNER_E2E_MONGO_URI must name disposable loopback MongoDB") (set! (.-exitCode js/process) 2))
  (do
    (set! (.-MONGODB_URI js/process.env) (str uri "/?directConnection=true")) (set! (.-MONGODB_DB js/process.env) db-name)
    (set! (.-OPENPLANNER_API_KEY js/process.env) "isolated-test-key") (set! (.-OPENPLANNER_KAFKA_ENABLED js/process.env) "false")
    (set! (.-OPENPLANNER_DATA_DIR js/process.env) (str "/tmp/" db-name)) (set! (.-EMBED_PROVIDER_BASE_URL js/process.env) "http://127.0.0.1:1")
    (-> (js/Promise.all #js [(js/import "../src/app.ts") (js/import "../src/lib/config.ts") (js/import "mongodb")
                              (js/import "fastify") (js/import "../src/lib/embedding-runtime.ts") (js/import "@fastify/sensible") (js/import "@fastify/multipart")
                              (js/import "../src/plugins/auth.ts") (js/import "../src/plugins/mongodb.ts") (js/import "../src/plugins/tenant.ts") (js/import "../src/plugins/kafka-events.ts")
                              (js/import "../src/routes/v1/index.ts") (js/import "../src/lib/protocol-adapters.ts") (js/import "../src/lib/metrics.ts")
                              (js/import "../src/lib/mongo-vectors.ts") (js/import "../src/lib/indexing.ts") (js/import "../src/lib/sentence-split.ts")])
        (.then run-app)
        (.then (fn [] (when (pos? @failures) (set! (.-exitCode js/process) 1))))
        (.catch (fn [err] (js/console.error err) (set! (.-exitCode js/process) 2))))))
