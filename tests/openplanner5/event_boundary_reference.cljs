;; Test-only composed /v1 app with loopback HTTP and disposable MongoDB.
;; Run: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/openplanner5/event_boundary_reference.cljs
(ns boundary-reference (:require [lossless-json :as lj] [clojure.string] ["node:crypto" :as crypto]))

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
(defn large-request [base size]
  (let [prefix "{\"events\":[],\"pad\":\"" suffix "\"}" body (str prefix (.repeat "x" (- size (count prefix) (count suffix))) suffix)]
    (check! (str "request byte size " size) size (.-length body))
    (-> (js/fetch (str base "/v1/events") #js {:method "POST" :headers #js {"content-type" "application/json" "authorization" "Bearer isolated-test-key"} :body body})
        (.then (fn [r] (-> (.json r) (.then (fn [body] {:status (.-status r) :body (js->clj body :keywordize-keys true)}))))))))
(defn wait-count [collection query expected remaining]
  (-> (.countDocuments collection query) (.then (fn [n] (if (or (>= n expected) (zero? remaining)) n (-> (js/Promise. #(js/setTimeout %1 50)) (.then #(wait-count collection query expected (dec remaining)))))))))
(defn canonical [value]
  (cond (map? value) (into (sorted-map) (map (fn [[k v]] [k (canonical v)]) value))
        (sequential? value) (mapv canonical value)
        :else value))
(defn stable-document [doc]
  (let [data (js->clj doc) migration (get data "migration_state")]
    (canonical (cond-> (dissoc data "createdAt" "updatedAt" "migration_state")
                 migration (assoc "migration_state" (dissoc migration "verified_at"))))))
(defn snapshot-digest [docs]
  (-> (crypto/createHash "sha256") (.update (js/JSON.stringify (lj/encode (mapv stable-document (vec docs))))) (.digest "hex")))

(defn run-cases [base db]
  (let [post #(request base {:events %} true "/v1/events") c (.collection db "events") edges (.collection db "graph_edges") embeddings (.collection db "graph_node_embeddings")
        html (str "<html><body>" (apply str (map #(str "<p>Café 東京 insight number " % " carries several clear words 🌍.</p>") (range 130))) "</body></html>")]
    (-> (large-request base (* 50 1024 1024))
        (.then (fn [r] (check! "50 MiB body accepted" [200 0] [(:status r) (get-in r [:body :count])]) (large-request base (inc (* 50 1024 1024)))))
        (.then (fn [r] (println "OVERSIZE" (pr-str r)) (check! "50 MiB plus one rejected" [413 "FST_ERR_CTP_BODY_TOO_LARGE" "Request body is too large"] [(:status r) (get-in r [:body :code]) (get-in r [:body :message])])
                 (post [{:schema "openplanner.event.v1" :id "node-large" :ts "2026-01-01T00:00:00Z" :source "discord" :kind "discord.message" :text "Many topic nodes." :extra {:topics (mapv #(str "success-node-" %) (range 1001))}}])))
        (.then (fn [r] (check! "large derived-node success response" [200 1001 1 1002] [(:status r) (get-in r [:body :projectedGraphEdges]) (get-in r [:body :queuedEventVectors]) (get-in r [:body :queuedGraphNodeEmbeddings])])
                 (check! "large derived-node bulk sizes" [1000 2] (get @bulk-calls "node-large"))
                 (js/Promise.all #js [(.countDocuments c #js {:id "node-large"}) (.countDocuments c #js {:id "graph.node:derive:node-large"}) (.countDocuments c #js {:id #js {:$regex "^graph.node:topic:success-node-"}}) (.countDocuments edges #js {:source_node_id "node-large"})])))
        (.then (fn [n] (check! "large derived nodes and edges persisted" [1 1 1001 1001] (js->clj n)) (wait-count embeddings #js {:node_id #js {:$regex "^topic:success-node-"}} 1001 400)))
        (.then (fn [n] (check! "large derived node embeddings persisted" 1001 n)
                 (post [{:schema "openplanner.event.v1" :id "html-event" :ts "2026-01-01T00:01:00Z" :source "synthetic" :kind "graph.node" :text html :source_ref {:project "html-lake"} :extra {:node_id "node:html" :label "Résumé 東京"}}])))
        (.then (fn [r] (println "HTML-RESPONSE" (pr-str r)) (check! "HTML graph.node response counters" [200 133 0 133] [(:status r) (get-in r [:body :projectedGraphEdges]) (get-in r [:body :queuedEventVectors]) (get-in r [:body :queuedGraphNodeEmbeddings])])
                 (js/Promise.all #js [(-> (.find c #js {:$or #js [#js {:extra.parent_node_id "node:html"} #js {:extra.derived_from_node_id "node:html"}]}) (.sort #js {:id 1}) (.toArray))
                                      (-> (.find edges #js {:source_node_id "node:html" :edge_kind "contains_chunk"}) (.sort #js {:_id 1}) (.toArray)) (-> (.find edges #js {:source_node_id "node:html" :edge_kind "contains_sentence"}) (.sort #js {:_id 1}) (.toArray))])))
        (.then (fn [xs] (let [docs (aget xs 0) chunks (filter #(= "doc_chunk" (.. % -extra -node_kind)) (vec docs)) sentences (filter #(= "sentence" (.. % -extra -node_kind)) (vec docs))]
                          (println "HTML-SNAPSHOT" (pr-str {:total (.-length docs) :chunks (count chunks) :sentences (count sentences) :chunk-edges (.-length (aget xs 1)) :sentence-edges (.-length (aget xs 2)) :node-digest (snapshot-digest docs) :edge-digest (snapshot-digest (concat (vec (aget xs 1)) (vec (aget xs 2))))}))
                          (check! "HTML has multiple chunks and sentences" true (and (> (count chunks) 1) (pos? (count sentences))))
                          (check! "HTML node counts match edge counts" [(count chunks) (count sentences)] [(.-length (aget xs 1)) (.-length (aget xs 2))])
                          (check! "HTML node project and representative Unicode retained" true (boolean (and (every? #(= "html-lake" (.-project %)) (vec docs)) (some #(.includes (.. % -extra -preview) "Café 東京") (vec docs)))))
                          (check! "HTML stored document counts" [133 2 131 2 131] [(.-length docs) (count chunks) (count sentences) (.-length (aget xs 1)) (.-length (aget xs 2))])
                          (check! "HTML complete node and edge field digests" ["61f0e86bfc980d010f54dbf648a461f5b459139ea76f000586069d072803ac56" "4b7c189eda0ca78b92974b767d22ffad931c9d5e16f4f6b9ef758aebe9422c8f"] [(snapshot-digest docs) (snapshot-digest (concat (vec (aget xs 1)) (vec (aget xs 2))))]))
                 (post [{:schema "openplanner.event.v1" :id "html-fault" :ts "2026-01-01T00:02:00Z" :source "synthetic" :kind "graph.node" :text html :source_ref {:project "html-lake"} :extra {:node_id "node:html-fault" :label "Résumé 東京"}}])))
        (.then (fn [r] (check! "HTML derived-write failure response" [500 "injected HTML bulk failure"] [(:status r) (get-in r [:body :message])])
                 (js/Promise.all #js [(.countDocuments c #js {:id "html-fault"}) (.countDocuments c #js {:$or #js [#js {:extra.parent_node_id "node:html-fault"} #js {:extra.derived_from_node_id "node:html-fault"}]}) (.countDocuments edges #js {:source_node_id "node:html-fault"})])))
        (.then (fn [n] (check! "HTML write failure keeps base only" [1 0 0] (js->clj n))))
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
                                                target (case id "node-large" (.-events mongo) "html-fault" (.-events mongo) nil)
                                                kafka (when target (.-kafkaEvents (.-server req)))
                                                old-kafka (when kafka (.-publishRawEvents kafka))
                                                old (when target (.-bulkWrite target)) app (.-server req) runtime? (= id "runtime-missing") old-runtime (when runtime? (.-embeddingRuntime app)) lookup? (= id "lookup-throws") old-find (when lookup? (.. app -mongo -events -findOne))]
                                            (when runtime? (set! (.-embeddingRuntime app) nil))
                                            (when lookup? (set! (.. app -mongo -events -findOne) (fn [& _] (throw (js/Error. "injected synchronous lookup failure")))))
                                            (when kafka (set! (.-publishRawEvents kafka) (fn [& args] (swap! kafka-calls inc) (.apply old-kafka kafka (to-array args)))))
                                            (when target (set! (.-bulkWrite target) (fn [ops options] (swap! bulk-calls update id (fnil conj []) (.-length ops)) (if (= id "html-fault") (js/Promise.reject (js/Error. "injected HTML bulk failure")) (.call old target ops options)))))
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
