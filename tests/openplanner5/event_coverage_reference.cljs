;; Test-only composed /v1 app with loopback HTTP and disposable MongoDB.
;; Run: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/openplanner5/event_coverage_reference.cljs
(ns coverage-reference (:require [lossless-json :as lj] [clojure.string]))

(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_app_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(def bulk-calls (atom {}))
(def kafka-calls (atom 0))
(defn metrics-line [base]
  (-> (js/fetch (str base "/v1/metrics"))
      (.then (fn [r] (-> (.text r) (.then (fn [s] (let [line (first (filter #(.startsWith % "openplanner_events_ingested_total{") (clojure.string/split-lines s)))]
                                                     {:status (.-status r) :value (when line (js/Number (last (clojure.string/split line #"\s+"))))}))))))))

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
(defn check! [label expected actual]
  (if (= expected actual) (println "PASS" label)
      (do (swap! failures inc) (println "FAIL" label "expected" (pr-str expected) "got" (pr-str actual)))))
(defn request [base body auth? path]
  (-> (js/fetch (str base path) (clj->js {:method "POST" :headers (cond-> {"content-type" "application/json"} auth? (assoc "authorization" "Bearer isolated-test-key")) :body (js/JSON.stringify (lj/encode body))}))
      (.then (fn [response] (-> (.json response) (.then (fn [body] {:status (.-status response) :body (js->clj body :keywordize-keys true)})))))))

(defn event [id ts extra text]
  (cond-> {:schema "openplanner.event.v1" :id id :ts ts :source "discord" :kind "discord.message" :extra extra}
    (some? text) (assoc :text text)))
(defn run-cases [base db]
  (let [post #(request base {:events %} true "/v1/events") c (.collection db "events") labels (.collection db "graph_label_nodes") edges (.collection db "graph_edges") before (atom nil)
        event (fn [id ts] {:schema "openplanner.event.v1" :id id :ts ts :source "discord" :kind "discord.message" :text (str "Message " id) :extra {:guild_id "time-g" :channel_id "time-c"}})]
    (-> (post [(event "time-late" "2026-01-01T00:03:00Z") (event "time-early" "2026-01-01T00:01:00Z") (event "time-mid" "2026-01-01T00:02:00Z") (event "time-equal" "2026-01-01T00:02:00Z")])
        (.then (fn [r] (check! "out-of-order batch response" [200 4 14 4 6] [(:status r) (get-in r [:body :count]) (get-in r [:body :projectedGraphEdges]) (get-in r [:body :queuedEventVectors]) (get-in r [:body :queuedGraphNodeEmbeddings])])
                 (js/Promise.all #js [(.countDocuments edges #js {:source_node_id "time-late" :edge_kind "preceded_by"}) (.countDocuments edges #js {:source_node_id "time-early" :edge_kind "preceded_by"}) (.findOne edges #js {:source_node_id "time-mid" :edge_kind "preceded_by"}) (.findOne edges #js {:source_node_id "time-equal" :edge_kind "preceded_by"})])))
        (.then (fn [xs] (check! "strict earlier predecessor and no retroactive backfill" [0 0 "discord:time-g:time-c:time-early" "discord:time-g:time-c:time-early"] [(aget xs 0) (aget xs 1) (.-target_node_id (aget xs 2)) (.-target_node_id (aget xs 3))])
                 (post [{:schema "openplanner.event.v1" :id "unicode-label" :ts "2026-01-01T00:04:00Z" :source "synthetic" :kind "note" :extra {:openplanner_labels {:labels ["東京" "😀" "東京"]}}}])))
        (.then (fn [r] (check! "Unicode colliding-label response" [200 2] [(:status r) (get-in r [:body :projectedGraphEdges])])
                 (js/Promise.all #js [(.findOne labels #js {:label_id "label:default:label"}) (.findOne edges #js {:source_node_id "unicode-label" :edge_kind "has_label"}) (.countDocuments edges #js {:source_node_id "unicode-label" :edge_kind "has_label"})])))
        (.then (fn [xs] (check! "Unicode slug collision keeps first node last edge" ["東京" "😀" 1] [(.-label (aget xs 0)) (.. (aget xs 1) -data -label) (aget xs 2)]) (metrics-line base)))
        (.then (fn [line] (check! "successful bulk metric baseline valid" [200 true] [(:status line) (and (number? (:value line)) (js/Number.isFinite (:value line)))]) (println "SUCCESS-COUNTER-BEFORE" (pr-str line)) (reset! before line)
                 (post [{:schema "openplanner.event.v1" :id "success-large" :ts "2026-01-01T00:05:00Z" :source "synthetic" :kind "note" :extra {:openplanner_labels {:labels (mapv #(str "success-label-" %) (range 1001))}}}])))
        (.then (fn [r] (check! "successful >1000 label response" [200 1 1001 0 0 "skipped"] [(:status r) (get-in r [:body :count]) (get-in r [:body :projectedGraphEdges]) (get-in r [:body :queuedEventVectors]) (get-in r [:body :queuedGraphNodeEmbeddings]) (get-in r [:body :indexing])])
                 (check! "successful label batch sizes" [1000 1] (get @bulk-calls "success-large"))
                 (js/Promise.all #js [(.countDocuments c #js {:id "success-large"}) (.countDocuments labels #js {:label_id #js {:$regex "^label:default:success-label-"}}) (.countDocuments edges #js {:source_node_id "success-large"})])))
        (.then (fn [n] (check! "successful >1000 persists base labels edges" [1 1001 1001] (js->clj n)) (check! "Kafka spy sees one successful publish" 1 @kafka-calls) (metrics-line base)))
        (.then (fn [line] (println "SUCCESS-COUNTER-AFTER" (pr-str line)) (check! "successful bulk increments numeric counter once" [200 (inc (:value @before))] [(:status line) (:value line)])))
        (.then (fn [] (js/Promise. #(js/setTimeout %1 5000)))))))

(defn compose-app [modules cfg]
  (let [fastify (.-default (aget modules 3)) app (fastify #js {:logger #js {:stream #js {:write capture-log!}} :bodyLimit (* 50 1024 1024) :pluginTimeout 120000})
        targets (atom #{})]
    (aset app "openplannerConfig" cfg)
    (aset app "embeddingRuntime" #js {:hot #js {:getModel (fn [scope] (swap! model-scopes conj (js->clj scope :keywordize-keys true)) (let [p (.-project scope)] (if (and (string? p) (.startsWith p "order-")) p "synthetic-model")))
      :getBackgroundEmbeddingFunctionForModel (fn [model] #js {:generate (fn [texts] (swap! model-generation-order conj model) (synthetic-embedding texts))})
      :getBackgroundEmbeddingFunction (fn [_] #js {:generate (fn [texts] (js/Promise.resolve (clj->js (mapv (fn [_] [0.25 0.75]) (vec texts)))))})}})
    (.addHook app "onRoute" (fn [route]
                              (when (and (= "POST" (.-method route))
                                         (contains? #{"/v1/graph/connections" "/v1/events"} (.-url route)))
                                (swap! targets conj (.-url route))
                                (let [original (.-handler route) url (.-url route)]
                                  (set! (.-handler route)
                                        (fn [req reply]
                                          (swap! wrapped-calls conj url)
                                          (let [id (some-> req .-body .-events (aget 0) .-id)
                                                mongo (.-mongo (.-server req))
                                                target (case id "success-large" (.-graphLabelNodes mongo) nil)
                                                kafka (when target (.-kafkaEvents (.-server req)))
                                                old-kafka (when kafka (.-publishRawEvents kafka))
                                                old (when target (.-bulkWrite target)) app (.-server req) runtime? (= id "runtime-missing") old-runtime (when runtime? (.-embeddingRuntime app)) lookup? (= id "lookup-throws") old-find (when lookup? (.. app -mongo -events -findOne))]
                                            (when runtime? (set! (.-embeddingRuntime app) nil))
                                            (when lookup? (set! (.. app -mongo -events -findOne) (fn [& _] (throw (js/Error. "injected synchronous lookup failure")))))
                                            (when kafka (set! (.-publishRawEvents kafka) (fn [& args] (swap! kafka-calls inc) (.apply old-kafka kafka (to-array args)))))
                                            (when target (set! (.-bulkWrite target) (fn [ops options] (swap! bulk-calls update id (fnil conj []) (.-length ops)) (.call old target ops options))))
                                            (-> (js/Promise.resolve (.call original (.-server req) req reply))
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
                              (js/import "../../src/routes/v1/index.ts")])
        (.then run-app)
        (.then (fn [] (when (pos? @failures) (set! (.-exitCode js/process) 1))))
        (.catch (fn [err] (js/console.error err) (set! (.-exitCode js/process) 2))))))
