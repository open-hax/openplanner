;; Real buildApp /v1 registration and loopback HTTP; disposable loopback MongoDB only.
;; Run: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb tests/graph_connections_app_characterization.cljs
(ns graph-connections-composed-entry-probe)

(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_app_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(def wrapped-calls (atom []))
(defn check! [label expected actual]
  (if (= expected actual) (println "PASS" label)
      (do (swap! failures inc) (println "FAIL" label "expected" (pr-str expected) "got" (pr-str actual)))))
(defn request [base body auth? path]
  (-> (js/fetch (str base path) (clj->js {:method "POST" :headers (cond-> {"content-type" "application/json"} auth? (assoc "authorization" "Bearer isolated-test-key")) :body (js/JSON.stringify (clj->js body))}))
      (.then (fn [response] (-> (.json response) (.then (fn [body] {:status (.-status response) :body (js->clj body :keywordize-keys true)})))))))

(defn run-cases [base db]
  (-> (request base {} false "/v1/graph/connections")
      (.then (fn [r] (check! "unauthorized graph status" 401 (:status r)) (request base {} false "/v1/events")))
      (.then (fn [r] (check! "unauthorized events status" 401 (:status r)) (request base {} true "/v1/events")))
      (.then (fn [r] (check! "invalid events status" 400 (:status r)) (check! "invalid events error" "expected { events: [...] }" (get-in r [:body :error])) (request base {:seed_node_ids ["topic:one"] :max_nodes 1} true "/v1/graph/connections")))
      (.then (fn [r] (check! "snake aliases status" 200 (:status r)) (check! "snake aliases selected" ["topic:one"] (mapv :id (get-in r [:body :nodes]))) (request base {:seedNodeIds ["topic:one"] :maxNodes 1} true "/v1/graph/connections")))
      (.then (fn [r] (check! "camel aliases status" 200 (:status r)) (check! "camel aliases selected" ["topic:one"] (mapv :id (get-in r [:body :nodes]))) (request base {:events [{:schema "openplanner.event.v1" :id "discord:g:c:textless" :ts "2026-01-01T00:01:00Z" :source "discord" :kind "discord.message" :extra {:guild_id "g" :channel_id "c" :previous_message_id "prior" :topics ["Orbit"] :attachments [{:id "a" :filename "a.png"}]}}]} true "/v1/events")))
      (.then (fn [r] (check! "textless event status" 200 (:status r)) (js/Promise.all #js [(.countDocuments (.collection db "events") #js {:id "discord:g:c:textless"}) (.countDocuments (.collection db "graph_edges") #js {:source_node_id "discord:g:c:textless"})])))
      (.then (fn [counts] (check! "textless event persisted" 1 (aget counts 0)) (check! "baseline textless structural edges" 0 (aget counts 1))
               (check! "only authorized requests reached wrappers" ["/v1/events" "/v1/graph/connections" "/v1/graph/connections" "/v1/events"] @wrapped-calls)
               (-> (js/fetch (str base "/")) (.then #(.json %)))))
      (.then (fn [body] (check! "unrelated root handler" "openplanner" (.-name body))))))

(defn compose-app [modules cfg]
  (let [fastify (.-default (aget modules 3)) app (fastify #js {:logger true :bodyLimit (* 50 1024 1024) :pluginTimeout 120000})
        targets (atom #{})]
    (aset app "openplannerConfig" cfg)
    (aset app "embeddingRuntime" ((.-createEmbeddingRuntime (aget modules 4)) cfg))
    (.addHook app "onRoute" (fn [route]
                              (when (and (= "POST" (.-method route))
                                         (contains? #{"/v1/graph/connections" "/v1/events"} (.-url route)))
                                (swap! targets conj (.-url route))
                                (let [original (.-handler route) url (.-url route)]
                                  (set! (.-handler route)
                                        (fn [req reply]
                                          (swap! wrapped-calls conj url)
                                          (.call original (.-server req) req reply)))))))
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
  (let [client (new (.-MongoClient (aget modules 2)) uri)
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
    (set! (.-MONGODB_URI js/process.env) uri)
    (set! (.-MONGODB_DB js/process.env) db-name)
    (set! (.-OPENPLANNER_API_KEY js/process.env) "isolated-test-key")
    (set! (.-OPENPLANNER_KAFKA_ENABLED js/process.env) "false")
    (set! (.-OPENPLANNER_DATA_DIR js/process.env) (str "/tmp/" db-name))
    (set! (.-EMBED_PROVIDER_BASE_URL js/process.env) "http://127.0.0.1:1")
    (-> (js/Promise.all #js [(js/import "../src/app.ts") (js/import "../src/lib/config.ts") (js/import "mongodb")
                              (js/import "fastify") (js/import "../src/lib/embedding-runtime.ts")
                              (js/import "@fastify/sensible") (js/import "@fastify/multipart")
                              (js/import "../src/plugins/auth.ts") (js/import "../src/plugins/mongodb.ts")
                              (js/import "../src/plugins/tenant.ts") (js/import "../src/plugins/kafka-events.ts")
                              (js/import "../src/routes/v1/index.ts")])
        (.then run-app)
        (.then (fn [] (when (pos? @failures) (set! (.-exitCode js/process) 1))))
        (.catch (fn [err] (js/console.error err) (set! (.-exitCode js/process) 2))))))
