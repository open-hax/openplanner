;; Run from repo root: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/shape_candidate.cljs
;; Real buildApp /v1 registration and loopback HTTP; disposable loopback MongoDB only.
(ns shape-candidate (:require [event-slice :as slice] [lossless-json :as lj]))

(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_app_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(declare check!)
(def detached-warnings (atom []))
(def io-errors (atom []))
(def io-observation (atom {:started 0 :succeeded 0 :failed 0 :active 0 :generation-started 0 :generation-settled 0}))
(def instrumented-collections (js/WeakSet.))
(defn observe-promise [promise success-key failure-key operation]
  (if (and promise (.-then promise))
    (do (swap! io-observation #(-> % (update :started inc) (update :active inc)))
        (.then promise (fn [_] (swap! io-observation #(-> % (update success-key inc) (update :active dec))) nil)
               (fn [error] (swap! io-observation #(-> % (update failure-key inc) (update :active dec))) (swap! io-errors conj (assoc operation :error (.-message error))) nil))
        promise)
    promise))
(defn instrument-collection! [collection]
  (when (and collection (.-bulkWrite collection) (not (.has instrumented-collections collection)))
    (.add instrumented-collections collection)
    (doseq [method ["bulkWrite" "deleteMany" "updateOne" "updateMany" "insertOne" "createIndex"]]
      (when-let [original (aget collection method)]
        (let [bound (.bind original collection)]
          (aset collection method (fn [& args] (observe-promise (.apply bound nil (to-array args)) :succeeded :failed {:method method :collection (.-collectionName collection)})))))))
  collection)
(defn instrument-mongo! [app]
  (let [mongo (.-mongo app) db (.-db mongo) original (.bind (.-collection db) db)]
    (doseq [key (vec (js/Object.keys mongo))] (instrument-collection! (aget mongo key)))
    (set! (.-collection db) (fn [& args] (instrument-collection! (.apply original nil (to-array args)))))))
(defn wait-io-quiescent [remaining previous stable]
  (let [state @io-observation ready? (and (zero? (:active state)) (= (:generation-started state) (:generation-settled state)))
        stable-next (if (and ready? (= state previous)) (inc stable) 0)]
    (if (or (>= stable-next 15) (zero? remaining))
      (do (check! "tracked Mongo writes and synthetic generations settled" true (and ready? (>= stable-next 15)))
          (check! "actual Mongo writes observed" true (pos? (:started state)))
          (check! "all expected synthetic generator calls observed" [39 39] [(:generation-started state) (:generation-settled state)])
          (let [terminal (filter #(or (and (= "event_chunks" (:collection %)) (.includes (or (:error %) "") "'_id' value cannot be of type array"))
                                     (and (= "graph_node_embeddings" (:collection %)) (.includes (or (:error %) "") "E11000 duplicate key"))) @io-errors)
                retryable (filter #(.includes (or (:error %) "") "Please retry your operation or multi-document transaction") @io-errors)]
            (check! "five terminal write failures observed" {["bulkWrite" "event_chunks"] 3 ["bulkWrite" "graph_node_embeddings"] 2} (frequencies (map (juxt :method :collection) terminal)))
            (check! "all other failed write attempts classified as retryable conflicts" (count @io-errors) (+ (count terminal) (count retryable)))
            (println "RETRYABLE-WRITE-ATTEMPTS" (count retryable) "subsequent retry outcome not inferred")
            (doseq [attempt retryable] (println "RETRYABLE-WRITE-FAILURE" (pr-str attempt))))
          (println "OBSERVED-WORK" (pr-str state)) (doseq [error @io-errors] (println "OBSERVED-WRITE-FAILURE" (pr-str error))) (js/Promise.resolve))
      (-> (js/Promise. #(js/setTimeout %1 20)) (.then #(wait-io-quiescent (dec remaining) state stable-next))))))

(defn capture-log! [line]
  (try (let [record (js->clj (js/JSON.parse line) :keywordize-keys true)
             msg (:msg record) error (get-in record [:err :message])]
         (when (contains? #{"Failed to index event into MongoDB vectors; preserving base event without embeddings" "Failed to materialize graph node embeddings during event ingest"} msg)
           (swap! detached-warnings conj {:message msg :event-id (:eventId record) :count (:count record) :error error})))
       (catch :default _ nil))
  (.write (.-stdout js/process) line))
(defn wait-warnings [remaining]
  (if (or (>= (count @detached-warnings) 5) (zero? remaining)) (js/Promise.resolve)
      (-> (js/Promise. #(js/setTimeout %1 20)) (.then #(wait-warnings (dec remaining))))))
(defn check-detached! []
  (let [vectors (filter #(= "Failed to index event into MongoDB vectors; preserving base event without embeddings" (:message %)) @detached-warnings)
        graphs (filter #(= "Failed to materialize graph node embeddings during event ingest" (:message %)) @detached-warnings)]
    (println "TERMINAL-ROUTE-FAILURES" (pr-str {:vector (count vectors) :graph (count graphs)}))
    (check! "exact detached warning count" 5 (count @detached-warnings))
    (check! "detached vector failure identities" #{["id" "arr"] ["reaction" "id"] ["message" "id"]} (set (map :event-id vectors)))
    (check! "three vector failures are Mongo array-id errors" true (and (= 3 (count vectors)) (every? #(and (:error %) (.includes (:error %) "'_id' value cannot be of type array")) vectors)))
    (check! "two graph failures report queue sizes and duplicate-key errors" true (and (= #{1 3} (set (map :count graphs))) (= 2 (count graphs)) (every? #(and (:error %) (.includes (:error %) "E11000 duplicate key")) graphs)))
    (doseq [item @detached-warnings] (println "DETACHED-FAILURE" (pr-str item)))))

(def background-tasks (atom []))
(def registration-closed (atom false))
(def late-registrations (atom 0))
(defn record-task! [task]
  (when @registration-closed (swap! late-registrations inc))
  (swap! background-tasks conj task))
(def wrapped-calls (atom []))
(def model-scopes (atom []))
(def model-generation-order (atom []))
(def slow-reject (atom nil))
(defn wait-slow [remaining]
  (if (or @slow-reject (zero? remaining)) (js/Promise.resolve (some? @slow-reject))
      (-> (js/Promise. #(js/setTimeout %1 20)) (.then #(wait-slow (dec remaining))))))
(defn synthetic-embedding [texts]
  (let [p (if (some #(= "Topic: Slow" %) (vec texts))
            (js/Promise. (fn [_ reject] (reset! slow-reject reject)))
            (js/Promise.resolve (clj->js (mapv (fn [_] [0.25 0.75]) (vec texts)))))]
    (swap! io-observation update :generation-started inc)
    (.then p (fn [_] (swap! io-observation update :generation-settled inc) nil)
           (fn [_] (swap! io-observation update :generation-settled inc) nil))
    p))
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
(defn run-cases [base db]
  (let [post #(request base {:events %} true "/v1/events") c (.collection db "events") edges (.collection db "graph_edges")
        kinds [42 true ["custom" "array"] {"nested/key" 1}] attachments ["abc" 42 true ["x" {"k/v" 1}] {}]]
    (-> (reduce (fn [promise [i kind]] (.then promise (fn [] (-> (post [{:schema "openplanner.event.v1" :id (str "kind-" i) :ts "2026-01-01T01:00:00Z" :source "synthetic" :kind kind :text "A simple event."}])
                                                                 (.then (fn [r] (println "KIND" i (pr-str r)) (check! (str "nonstring kind response " i) [200 0 1 1] [(:status r) (get-in r [:body :projectedGraphEdges]) (get-in r [:body :queuedEventVectors]) (get-in r [:body :queuedGraphNodeEmbeddings])]) (.findOne c #js {:id (str "graph.node:derive:kind-" i)})))
                                                                 (.then (fn [doc] (println "KIND-DERIVED" i (js/JSON.stringify doc)) (check! (str "nonstring kind retained " i) [kind kind] [(js->clj (.. doc -extra -node_kind)) (js->clj (.. doc -extra -source_kind))]))))))) (js/Promise.resolve) (map-indexed vector kinds))
        (.then (fn [] (reduce (fn [promise [i att]] (.then promise (fn [] (-> (post [{:schema "openplanner.event.v1" :id (str "discord:g:shapes:att-" i) :ts (str "2026-01-01T01:0" i ":00Z") :source "discord" :kind "discord.message" :text "Attachment event." :extra {:guild_id "g" :channel_id (str "shape-" i) :attachments [att]}}])
                                                                 (.then (fn [r] (println "ATTACHMENT" i (pr-str r)) (check! (str "primitive attachment response " i) [200 4 1 4] [(:status r) (get-in r [:body :projectedGraphEdges]) (get-in r [:body :queuedEventVectors]) (get-in r [:body :queuedGraphNodeEmbeddings])]) (-> (.find c #js {:kind "graph.node" :extra.node_kind "discord.attachment" :extra.message_id (str "discord:g:shapes:att-" i)}) (.toArray))))
                                                                 (.then (fn [docs] (println "ATTACHMENT-DERIVED" i (js/JSON.stringify docs))
                                                                                (let [doc (aget docs 0) extra (js->clj (.-extra doc)) spread (js->clj (lj/copy-enumerables (lj/encode att))) hashes ["6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25" "73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049" "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b" "ace35b8dafdb893cf4f4019604654f53955031411ed0579145d1d227094fb84a" "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"]]
                                                                                  (check! (str "primitive attachment hash and spread " i) [(str "discord:attachment:" (nth hashes i)) spread] [(get extra "node_id") (select-keys extra (keys spread))])))))))) (js/Promise.resolve) (map-indexed vector attachments))))
        (.then (fn [] (post [{:schema "openplanner.event.v1" :id "shape-mixed-first" :ts "2026-01-01T02:00:00Z" :source "discord" :kind "discord.message" :text "First event." :extra {:attachments ["abc"]}} {:id "invalid"}])))
        (.then (fn [r] (println "SHAPE-MIXED" (pr-str r)) (js/Promise.all #js [(.countDocuments c #js {:id "shape-mixed-first"}) (.countDocuments c #js {:id "graph.node:derive:shape-mixed-first"}) (.countDocuments edges #js {:source_node_id "shape-mixed-first"})])))
        (.then (fn [n] (check! "mixed retains base and skips derived" [1 0 0] (js->clj n))))
        (.then (fn [] (-> (js/fetch (str base "/v1/events") #js {:method "POST" :headers #js {"content-type" "application/json" "authorization" "Bearer isolated-test-key"} :body "{\"events\":[{\"schema\":\"openplanner.event.v1\",\"id\":\"shape-ordered-json\",\"ts\":\"2026-01-01T02:03:00Z\",\"source\":\"discord\",\"kind\":\"discord.message\",\"text\":\"Attachment event.\",\"extra\":{\"attachments\":[{\"k0\":0,\"k1\":1,\"k2\":2,\"k3\":3,\"k4\":4,\"k5\":5,\"k6\":6,\"k7\":7,\"k8\":8,\"k9\":9,\"k10\":10,\"k11\":11}]}}]}"})
                           (.then (fn [r] (check! "ordered attachment raw JSON accepted" 200 (.-status r)) (.countDocuments c #js {:id "graph.node:discord:attachment:cf4a99338caa8b1594ba46ce94f96b8b666f86f0872f09303a1de689d8183e33"}))))))
        (.then (fn [n] (check! "ordered attachment JSON hash retained" 1 n)))
        (.then (fn [] (reduce (fn [promise [i id expected]] (.then promise (fn [] (-> (post [{:schema "openplanner.event.v1" :id id :ts "2026-01-01T02:05:00Z" :source "synthetic" :kind "custom.record" :text "A simple record."}])
                                                                  (.then (fn [r] (println "NONSTRING-ID" i (pr-str r)) (check! (str "nonstring id response " i) 200 (:status r)) (.findOne c #js {:id (str "graph.node:derive:" expected)})))
                                                                  (.then (fn [doc] (println "NONSTRING-ID-NODE" i (js/JSON.stringify doc)) (check! (str "nonstring id retained " i) [id id] [(js->clj (.. doc -extra -node_id)) (js->clj (.. doc -extra -source_event_id))])))))))
                              (js/Promise.resolve) [[0 42 "42"] [1 true "true"] [2 ["id" "arr"] "id,arr"] [3 {"nested/key" 1} "[object Object]"]])))
        (.then (fn [] (post [{:schema "openplanner.event.v1" :id ["reaction" "id"] :ts "2026-01-01T02:06:00Z" :source "discord" :kind "discord.reaction" :text "react" :extra {:user_id "u" :message_id "m"}}])))
        (.then (fn [r] (println "REACTION-NONSTRING-ID" (pr-str r)) (check! "array reaction id accepted" 200 (:status r)) (.countDocuments c #js {:id "graph.node:discord:reaction:reaction,id"})))
        (.then (fn [n] (check! "array reaction generated id JS-coerced" 1 n)))
        (.then (fn [] (post [{:schema "openplanner.event.v1" :id ["message" "id"] :ts "2026-01-01T02:06:30Z" :source "discord" :kind "discord.message" :text "hello" :extra {:guild_id "g" :channel_id "id-test" :previous_message_id "old"}}])))
        (.then (fn [r] (check! "array Discord message id accepted" 200 (:status r)) (js/Promise.all #js [(.countDocuments c #js {:id "graph.node:derive:message,id"}) (.countDocuments edges #js {:source_node_id #js ["message" "id"] :edge_kind "preceded_by"})])))
        (.then (fn [n] (check! "array Discord id derived and edge values" [1 1] (js->clj n))))
        (.then (fn [] (post [{:schema "openplanner.event.v1" :id ["edge" "id"] :ts "2026-01-01T02:07:00Z" :source "synthetic" :kind "graph.edge" :extra {:source_node_id ["left" "right"] :target_node_id {"x/y" 1} :edge_kind "links"}}])))
        (.then (fn [r] (check! "array graph-edge id accepted" 200 (:status r)) (.countDocuments edges #js {:_id "left,right||[object Object]||links"})))
        (.then (fn [n] (check! "graph edge endpoint id JS-coerced" 1 n)))
        (.then (fn [] (-> (js/fetch (str base "/v1/events") #js {:method "POST" :headers #js {"content-type" "application/json" "authorization" "Bearer isolated-test-key"} :body "{\"events\":[{\"schema\":\"openplanner.event.v1\",\"id\":\"shape-ordered-json-reverse\",\"ts\":\"2026-01-01T02:03:30Z\",\"source\":\"discord\",\"kind\":\"discord.message\",\"text\":\"Attachment event.\",\"extra\":{\"attachments\":[{\"k11\":11,\"k10\":10,\"k9\":9,\"k8\":8,\"k7\":7,\"k6\":6,\"k5\":5,\"k4\":4,\"k3\":3,\"k2\":2,\"k1\":1,\"k0\":0}]}}]}"})
                           (.then (fn [r] (check! "reverse ordered attachment accepted" 200 (.-status r)) (.countDocuments c #js {:id "graph.node:discord:attachment:310da3acbf81b51a1be1bdd2e69faecdbd296d5e1d8cb4b641834bc25ce94e42"}))))))
        (.then (fn [n] (check! "reverse ordered JSON yields distinct hash" 1 n)))
        (.then (fn [] (post [{:schema "openplanner.event.v1" :id {"same/key" 1} :ts "2026-01-01T02:08:00Z" :source "synthetic" :kind "note" :text "First object id."}
                              {:schema "openplanner.event.v1" :id {"same/key" 1} :ts "2026-01-01T02:09:00Z" :source "synthetic" :kind "note" :text "Second object id."}])))
        (.then (fn [r] (check! "equal JSON object IDs retain separate Map identities" [200 2 2] [(:status r) (get-in r [:body :queuedEventVectors]) (get-in r [:body :queuedGraphNodeEmbeddings])])))
        (.then (fn [] (post [{:schema "openplanner.event.v1" :id "shape-kind-mixed" :ts "2026-01-01T02:01:00Z" :source "synthetic" :kind {"x/y" 1} :text "First generic event."} {:id "invalid"}])))
        (.then (fn [r] (check! "mixed nonstring kind fails at invalid event" [500 "event.schema must be openplanner.event.v1"] [(:status r) (get-in r [:body :message])]) (js/Promise.all #js [(.countDocuments c #js {:id "shape-kind-mixed"}) (.countDocuments c #js {:id "graph.node:derive:shape-kind-mixed"})])))
        (.then (fn [n] (check! "mixed nonstring kind keeps base without derived node" [1 0] (js->clj n))))
        (.then (fn [] (post [{:schema "openplanner.event.v1" :id "shape-textless-primitive" :ts "2026-01-01T02:02:00Z" :source "discord" :kind "discord.message" :extra {:attachments ["abc"]}}])))
        (.then (fn [r] (check! "textless primitive attachment baseline or repair" [200 1 1] [(:status r) (get-in r [:body :projectedGraphEdges]) (get-in r [:body :queuedGraphNodeEmbeddings])])))
        (.then (fn [] (js/Promise. #(js/setTimeout %1 5000)))))))

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
                                                target (case id "fail-node" (.. app -mongo -events) "fail-edge" (.. app -mongo -graphEdges) "fail-label" (.. app -mongo -graphLabelNodes) nil)
                                                old (when target (.-bulkWrite target)) kafka (when (= id "fail-kafka") (.-kafkaEvents app)) old-kafka (when kafka (.-publishRawEvents kafka))]
                                            (when target (set! (.-bulkWrite target) (fn [& _] (js/Promise.reject (js/Error. "injected bulk failure")))))
                                            (when kafka (set! (.-publishRawEvents kafka) (fn [& _] (js/Promise.reject (js/Error. "injected kafka failure")))))
                                            (-> (js/Promise.resolve (slice/handler app (.-eventAdmission ((.-createProtocols (aget modules 12)) app)) (.-counterInc (aget modules 13)) (.-indexTextInMongoVectors (aget modules 14)) (.-prepareIndexDocument (aget modules 15)) (.-splitSentences (aget modules 16)) record-task! req reply))
                                                (.finally (fn [] (when target (set! (.-bulkWrite target) old)) (when kafka (set! (.-publishRawEvents kafka) old-kafka))))))))))))

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
        (.then (fn [app] (reset! app-ref app) (instrument-mongo! app) (.listen app #js {:host "127.0.0.1" :port 0})))
        (.then (fn [base] (run-cases base db)))
        (.then (fn [] (reset! registration-closed true) (-> (js/Promise.allSettled (to-array @background-tasks)) (.then (fn [results] (check! "all tracked background tasks settled before cleanup" (count @background-tasks) (.-length results)))))))
        (.then (fn [] (wait-warnings 500)))
        (.then (fn [] (wait-io-quiescent 500 nil 0)))
        (.then (fn [] (check! "no task registration after response barrier" 0 @late-registrations) (check-detached!)))
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
