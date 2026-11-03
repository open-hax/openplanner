;; Run from repo root: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/duplicate_reference.cljs
;; Real buildApp /v1 registration and loopback HTTP; disposable loopback MongoDB only.
(ns duplicate-reference (:require [lossless-json :as lj]))

(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_app_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(def captured-ops (atom []))
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
(defn discord-event [id ts guild guild-name channel channel-name user user-name]
  {:schema "openplanner.event.v1" :id id :ts ts :source "discord" :kind "discord.message" :text (str "Message " id)
   :meta {:author_id user :author_global_name user-name}
   :extra {:guild_id guild :guild_name guild-name :channel_id channel :channel_name channel-name}})
(defn run-cases [base db]
  (let [post #(request base {:events %} true "/v1/events") c (.collection db "events") edges (.collection db "graph_edges")
        normal [(discord-event "dup-first" "2026-01-01T01:00:00Z" "dup-g" "First Guild" "dup-c" "first-channel" "dup-u" "First User")
                (discord-event "dup-second" "2026-01-01T01:01:00Z" "dup-g" "Second Guild" "dup-c" "second-channel" "dup-u" "Second User")]
        faulty [(discord-event "dup-fault-first" "2026-01-01T02:00:00Z" "fault-g" "First Fault Guild" "fault-c" "first-fault" "fault-u" "First Fault User")
                (discord-event "dup-fault-second" "2026-01-01T02:01:00Z" "fault-g" "Second Fault Guild" "fault-c" "second-fault" "fault-u" "Second Fault User")]]
    (-> (post normal)
        (.then (fn [r] (check! "duplicate batch response" [200 9 2 5] [(:status r) (get-in r [:body :projectedGraphEdges]) (get-in r [:body :queuedEventVectors]) (get-in r [:body :queuedGraphNodeEmbeddings])])
                 (let [ops (first @captured-ops) ids (mapv #(get-in % [:updateOne :filter :_id]) ops)]
                   (println "DERIVED-OPERATIONS" (pr-str ops))
                   (check! "one operation per repeated guild channel author" [5 1 1 1] [(count ids) (count (filter #{"graph.node:discord:guild:dup-g"} ids)) (count (filter #{"graph.node:discord:channel:dup-c"} ids)) (count (filter #{"graph.node:discord:user:dup-u"} ids))]))
                 (js/Promise.all #js [(.findOne c #js {:id "graph.node:discord:guild:dup-g"}) (.findOne c #js {:id "graph.node:discord:channel:dup-c"}) (.findOne c #js {:id "graph.node:discord:user:dup-u"})])))
        (.then (fn [xs] (check! "repeated nodes preserve first values" ["First Guild" "#first-channel" "First User"] [(.-message (aget xs 0)) (.-message (aget xs 1)) (.-message (aget xs 2))]) (post faulty)))
        (.then (fn [r] (println "PER-OP-FAULT" (pr-str r)) (check! "injected guild operation causes 500" 500 (:status r))
                 (let [ops (second @captured-ops) ids (mapv #(get-in % [:updateOne :filter :_id]) ops)]
                   (check! "fault batch still submits each derived ID once" [5 1] [(count ids) (count (filter #{"graph.node:discord:guild:fault-g"} ids))]))
                 (js/Promise.all #js [(.countDocuments c #js {:id #js {:$in #js ["dup-fault-first" "dup-fault-second"]}}) (.countDocuments c #js {:id "graph.node:discord:guild:fault-g"}) (.countDocuments c #js {:id "graph.node:discord:channel:fault-c"}) (.countDocuments c #js {:id "graph.node:discord:user:fault-u"}) (.countDocuments c #js {:id #js {:$in #js ["graph.node:derive:dup-fault-first" "graph.node:derive:dup-fault-second"]}}) (.countDocuments edges #js {:source_node_id #js {:$in #js ["dup-fault-first" "dup-fault-second"]}})])))
        (.then (fn [n] (println "PER-OP-PERSISTED" (pr-str (js->clj n))) (check! "unordered fault keeps other node writes but skips edges" [2 0 1 1 2 0] (js->clj n))))
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
                                                target (case id "dup-first" (.-events mongo) "dup-fault-first" (.-events mongo) "fail-label" (.-graphLabelNodes mongo) nil)
                                                kafka (when (= id "fail-kafka") (.-kafkaEvents (.-server req)))
                                                old-kafka (when kafka (.-publishRawEvents kafka))
                                                old (when target (.-bulkWrite target)) app (.-server req) runtime? (= id "runtime-missing") old-runtime (when runtime? (.-embeddingRuntime app)) lookup? (= id "lookup-throws") old-find (when lookup? (.. app -mongo -events -findOne))]
                                            (when runtime? (set! (.-embeddingRuntime app) nil))
                                            (when lookup? (set! (.. app -mongo -events -findOne) (fn [& _] (throw (js/Error. "injected synchronous lookup failure")))))
                                            (when kafka (set! (.-publishRawEvents kafka) (fn [& _] (js/Promise.reject (js/Error. "injected kafka failure")))))
                                            (when target
                                              (set! (.-bulkWrite target)
                                                    (fn [ops options]
                                                      (swap! captured-ops conj (js->clj ops :keywordize-keys true))
                                                      (when (= id "dup-fault-first")
                                                        (doseq [op (vec ops)]
                                                          (when (= "graph.node:discord:guild:fault-g" (.. op -updateOne -filter -_id))
                                                            (aset (aget (.. op -updateOne -update) "$set") "_id" "injected-conflicting-id"))))
                                                      (.call old target ops options))))
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
