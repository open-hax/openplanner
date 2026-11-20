;; Test-only composed /v1 app with real loopback HTTP and disposable MongoDB.
;; Run: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/openplanner5/event_bulk_reference.cljs
(ns bulk-reference (:require [lossless-json :as lj] [clojure.string]))

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
  (let [post #(request base {:events %} true "/v1/events") c (.collection db "events") labels (.collection db "graph_label_nodes") edges (.collection db "graph_edges") before (atom nil)]
    (-> (post [])
        (.then (fn [r] (check! "counter baseline request succeeds" 200 (:status r)) (metrics-line base)))
        (.then (fn [line] (check! "counter baseline is numeric and metrics HTTP succeeds" [200 true] [(:status line) (and (number? (:value line)) (js/Number.isFinite (:value line)))]) (println "COUNTER-BEFORE" (pr-str line)) (reset! before line)
                 (post [{:schema "openplanner.event.v1" :id "second-nodes" :ts "2026-01-01T03:00:00Z" :source "synthetic" :kind "discord.message" :text "Bulk node event." :extra {:topics (mapv #(str "bulk-node-" %) (range 1001)) :openplanner_labels {:labels ["NodeStageLabel"]}}}])))
        (.then (fn [r] (println "SECOND-NODE-BATCH" (pr-str r)) (check! "second derived-node batch failure" [500 "injected second batch failure"] [(:status r) (get-in r [:body :message])])
                 (js/Promise.all #js [(.countDocuments c #js {:id "second-nodes"}) (.countDocuments c #js {:id "graph.node:derive:second-nodes"}) (.countDocuments c #js {:id #js {:$regex "^graph.node:topic:bulk-node-"}}) (.countDocuments labels #js {:label_id "label:default:nodestagelabel"}) (.countDocuments edges #js {:source_node_id "second-nodes"})])))
        (.then (fn [n] (check! "node second-batch partial writes" [1 1 999 0 0] (js->clj n)) (check! "node bulk batch sizes" [1000 2] (get @bulk-calls "second-nodes"))
                 (wait-hot db "second-nodes" 200)))
        (.then (fn [n] (check! "node failure leaves detached vector work" 1 n)
                 (post [{:schema "openplanner.event.v1" :id "second-labels" :ts "2026-01-01T03:01:00Z" :source "synthetic" :kind "note" :text "Bulk label event." :extra {:openplanner_labels {:labels (mapv #(str "bulk-label-" %) (range 1001))}}}])))
        (.then (fn [r] (println "SECOND-LABEL-BATCH" (pr-str r)) (check! "second label batch failure" [500 "injected second batch failure"] [(:status r) (get-in r [:body :message])])
                 (js/Promise.all #js [(.countDocuments c #js {:id "second-labels"}) (.countDocuments c #js {:id "graph.node:derive:second-labels"}) (.countDocuments labels #js {:label_id #js {:$regex "^label:default:bulk-label-"}}) (.countDocuments edges #js {:source_node_id "second-labels"})])))
        (.then (fn [n] (check! "label second-batch partial writes" [1 1 1000 0] (js->clj n)) (check! "label bulk batch sizes" [1000 1] (get @bulk-calls "second-labels")) (wait-hot db "second-labels" 200)))
        (.then (fn [n] (check! "label failure leaves detached vector work" 1 n) (check! "Kafka not reached on either failure" 0 @kafka-calls) (metrics-line base)))
        (.then (fn [line] (println "COUNTER-AFTER" (pr-str line)) (check! "ingestion counter unchanged on failures" @before line)))
        (.then (fn [] (js/Promise. #(js/setTimeout %1 1000)))))))

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
                                                target (case id "second-nodes" (.-events mongo) "second-labels" (.-graphLabelNodes mongo) nil)
                                                kafka (when target (.-kafkaEvents (.-server req)))
                                                old-kafka (when kafka (.-publishRawEvents kafka))
                                                old (when target (.-bulkWrite target)) app (.-server req) runtime? (= id "runtime-missing") old-runtime (when runtime? (.-embeddingRuntime app)) lookup? (= id "lookup-throws") old-find (when lookup? (.. app -mongo -events -findOne))]
                                            (when runtime? (set! (.-embeddingRuntime app) nil))
                                            (when lookup? (set! (.. app -mongo -events -findOne) (fn [& _] (throw (js/Error. "injected synchronous lookup failure")))))
                                            (when kafka (set! (.-publishRawEvents kafka) (fn [& args] (swap! kafka-calls inc) (.apply old-kafka kafka (to-array args)))))
                                            (when target (set! (.-bulkWrite target) (fn [ops options] (let [sizes (get (swap! bulk-calls update id (fnil conj []) (.-length ops)) id)] (if (= 2 (count sizes)) (js/Promise.reject (js/Error. "injected second batch failure")) (.call old target ops options))))))
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
