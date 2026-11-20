;; Real buildApp /v1 registration and loopback HTTP; disposable loopback MongoDB only.
;; Run: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb tests/graph_connections_app_characterization.cljs
(ns graph-connections-graph-candidate)

(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_app_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(def wrapped-calls (atom []))
(def active-app (atom nil))
(def original-graph (atom nil))
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
      (.then (fn [body] (check! "unrelated root handler" "openplanner" (.-name body))
               (.insertOne (.collection db "events") (clj->js {:id "discord:g:c:m" :ts (js/Date. "2026-01-01T00:00:00Z") :extra {:guild_id "g" :channel_id "c"}}))))
      (.then (fn [] (.insertMany (.collection db "graph_edges") (clj->js [{:source_node_id "discord:g:c:m" :target_node_id "discord:user:42" :edge_kind "authored_by" :data {:guild_id "g" :channel_id "c"}}
                                                                           {:source_node_id "discord:g:c:m" :target_node_id "bluesky:user:alice.example" :edge_kind "mentions_bluesky_user" :data {:handle "alice.example"}}]))))
      (.then (fn [] (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42"] :max_nodes 3} true "/v1/graph/connections")))
      (.then (fn [r] (check! "traversal result retains original edge order and dedup" (:edges @original-graph) (get-in r [:body :edges]))))
      (.then (fn [] (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 3} true "/v1/graph/connections")))
      (.then (fn [r] (check! "candidate full-cap edges" 2 (count (get-in r [:body :edges])))
               (check! "candidate full-cap stats" 2 (get-in r [:body :stats :totalEdges]))
               (check! "supplemented authored edge updates bridge statistics" [1 ["g"] ["c"]] (let [bridge (get-in r [:body :stats :peopleBridges 0])] [(:messageCount bridge) (:guilds bridge) (:channels bridge)]))
               (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 4} true "/v1/graph/connections")))
      (.then (fn [r] (check! "candidate authorship bridge" ["alice.example"] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))
               (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :target_node_id "discord:user:43" :edge_kind "authored_by"}))))
      (.then (fn [] (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "discord:user:43" "bluesky:user:alice.example"] :max_nodes 5} true "/v1/graph/connections")))
      (.then (fn [r] (check! "conflicting authors do not acquire a profile" [[] []] (mapv :blueskyProfiles (get-in r [:body :stats :peopleBridges])))
               (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 3} true "/v1/graph/connections")))
      (.then (fn [r] (check! "excluded conflicting author prevents attribution" [] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))
               (.deleteOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :target_node_id "discord:user:43" :edge_kind "authored_by"}))))
      (.then (fn [] (.updateOne (.collection db "events") (clj->js {:id "discord:g:c:m"}) (clj->js {:$set {:extra.username "display-name"}}))))
      (.then (fn [] (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 4} true "/v1/graph/connections")))
      (.then (fn [r] (check! "display username is not mistaken for author id" ["alice.example"] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))
               (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :target_node_id "discord:user:43" :edge_kind "authored_by"}))))
      (.then (fn [] (.updateOne (.collection db "events") (clj->js {:id "discord:g:c:m"}) (clj->js {:$set {:extra.user_id "42" :author "43"}}))))
      (.then (fn [] (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "discord:user:43" "bluesky:user:alice.example"] :max_nodes 5} true "/v1/graph/connections")))
      (.then (fn [r] (check! "hydrated user_id fallback retains reference precedence" ["alice.example"] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))
               (check! "hydrated author fallback response remains original" (:stats @original-graph) (get-in r [:body :stats]))
               (let [collection (.. @active-app -mongo -graphEdges) original (.-find collection)]
                 (set! (.-find collection) (fn [& _] (throw (js/Error. "synthetic supplemental failure"))))
                 (-> (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 3} true "/v1/graph/connections")
                     (.then (fn [result] (check! "supplement failure preserves original status" 200 (:status result))
                              (check! "supplement failure preserves original edges" 0 (count (get-in result [:body :edges])))))
                     (.finally #(set! (.-find collection) original))))))
      (.then (fn [] (.insertMany (.collection db "graph_edges") (clj->js [{:source_node_id "topic:a" :target_node_id "topic:b" :edge_kind "edge"}
                                                                             {:source_node_id "topic:a" :target_node_id "topic:c" :edge_kind "edge"}
                                                                             {:source_node_id "topic:b" :target_node_id "topic:c" :edge_kind "edge"}]))))
      (.then (fn [] (request base {:seed_node_ids ["topic:a"] :max_nodes 3} true "/v1/graph/connections")))
      (.then (fn [r] (check! "traversal-filled cap retains selected edges" 3 (count (get-in r [:body :edges])))))
      (.then (fn [] (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:rank" :target_node_id "discord:user:rank20" :edge_kind "authored_by" :data {:guild_id "g-rank"}}))))
      (.then (fn [] (let [users (mapv #(str "discord:user:rank" %) (range 21))]
                     (request base {:seed_node_ids (conj users "discord:g:c:rank") :max_nodes 22 :lakes ["discord"]} true "/v1/graph/connections"))))
      (.then (fn [r] (check! "supplement promotes previously omitted bridge" "rank20" (get-in r [:body :stats :peopleBridges 0 :userId]))))
      (.then (fn [] (.insertMany (.collection db "graph_edges")
                                (clj->js (conj (mapv (fn [i] {:source_node_id "topic:sat" :target_node_id (str "topic:outside-" i) :edge_kind "mentions_topic"}) (range 500))
                                               {:source_node_id "topic:sat" :target_node_id "topic:peer" :edge_kind "mentions_topic"})))))
      (.then (fn [] (request base {:seed_node_ids ["topic:sat"] :max_nodes 2} true "/v1/graph/connections")))
      (.then (fn [r] (check! "saturated traversal retains full original response" @original-graph (:body r))))
      (.then (fn [] (request base {:seed_node_ids ["topic:sat" "topic:peer"] :max_nodes 2} true "/v1/graph/connections")))
      (.then (fn [r] (check! "saturated scan retains selected edge" 1 (count (get-in r [:body :edges])))
               (check! "saturated scan has no dangling edges" true (every? #(contains? #{"topic:sat" "topic:peer"} (:target %)) (get-in r [:body :edges])))
               (let [ids (mapv #(str "topic:cap-" %) (range 23))
                     rows (vec (take 501 (for [a ids b ids] {:source_node_id a :target_node_id b :edge_kind "mentions_topic"})))]
                 (-> (.insertMany (.collection db "graph_edges") (clj->js rows))
                     (.then (fn [] (request base {:seed_node_ids ids :max_nodes 23} true "/v1/graph/connections")))
                     (.then (fn [response]
                              (check! "selected scan is bounded to 500" 500 (count (get-in response [:body :edges])))
                              (-> (.toArray (.limit (.find (.collection db "graph_edges") (clj->js {:source_node_id {:$in ids} :target_node_id {:$in ids}})) 500))
                                  (.then (fn [found] (let [expected (mapv #(select-keys % [:source_node_id :target_node_id]) (js->clj found :keywordize-keys true))
                                                          actual (mapv (fn [e] {:source_node_id (:source e) :target_node_id (:target e)}) (get-in response [:body :edges]))]
                                                      (check! "selected scan preserves cursor order" expected actual)))))))))))))

;; Experimental graph-only adapter. All request and Mongo values cross named boundaries.
(defn response->data [response] (js->clj response :keywordize-keys true))
(defn rows->data [rows] (js->clj rows :keywordize-keys true))
(defn edge-color [kind]
  (cond (= kind "mentions_topic") [1 0.75 0.2 0.7]
        (contains? #{"authored_by" "mentions_user"} kind) [0.35 0.65 1 0.7]
        (= kind "preceded_by") [0.6 0.6 0.7 0.4]
        (= kind "has_attachment") [0.95 0.35 0.55 0.7]
        (.includes kind "bluesky") [0.1 0.7 1 0.7]
        (or (.includes kind "window") (.includes kind "desktop")) [0.2 0.9 0.6 0.7]
        :else [0.4 0.45 0.5 0.5]))
(defn mongo-edge->response [row]
  (let [kind (or (:edge_kind row) "edge")]
    {:source (:source_node_id row) :target (:target_node_id row) :kind kind
     :color (edge-color kind) :data (merge {:kind kind :layer (:layer row)} (:data row))}))
(defn edge-key [edge] [(:source edge) (:target edge) (:kind edge)])
(defn add-bridge-edge [bridges edge]
  (if-not (contains? #{"in_guild" "authored_by" "mentions_user"} (:kind edge)) bridges
    (let [user-node (cond (.startsWith (:source edge) "discord:user:") (:source edge)
                          (.startsWith (:target edge) "discord:user:") (:target edge) :else nil)
          uid (when user-node (subs user-node 13))
          data (:data edge)]
      (mapv (fn [bridge]
              (if (= uid (str (:userId bridge)))
                (let [guilds (cond-> (vec (:guilds bridge)) (:guild_id data) (conj (str (:guild_id data))))
                      channels (cond-> (vec (:channels bridge)) (:channel_id data) (conj (str (:channel_id data))))
                      guilds (vec (distinct guilds)) channels (vec (distinct channels))]
                  (assoc bridge :guilds guilds :channels channels :isCrossGuild (> (count guilds) 1)
                         :messageCount (+ (:messageCount bridge) (if (= "authored_by" (:kind edge)) 1 0))))
                bridge)) bridges))))
(defn add-visible-edges [result rows]
  (let [ids (set (map :id (:nodes result)))
        present (set (map edge-key (:edges result)))
        extra (->> rows (map mongo-edge->response)
                   (filter #(and (ids (:source %)) (ids (:target %))))
                   (remove #(contains? present (edge-key %)))
                   (reduce (fn [acc edge] (if (some #(= (edge-key %) (edge-key edge)) acc) acc (conj acc edge))) []))
        edges (into (:edges result) extra)
        bridges (reduce add-bridge-edge (get-in result [:stats :peopleBridges]) extra)
        bridges (vec (sort-by (fn [b] [(- (count (:guilds b))) (- (:messageCount b))]) bridges))]
    (-> result (assoc :edges edges) (assoc-in [:stats :totalEdges] (count edges))
        (assoc-in [:stats :peopleBridges] bridges))))

(defn event-doc-map [rows]
  (reduce (fn [m doc] (cond-> m (:id doc) (assoc (str (:id doc)) doc)
                            (get-in doc [:extra :node_id]) (assoc (str (get-in doc [:extra :node_id])) doc))) {} rows))
(defn add-unambiguous-bridges [result authors-rows docs]
  (let [edges (:edges result)
        authors (reduce (fn [m e] (let [target (:target_node_id e)]
                                   (if (and (string? target) (.startsWith target "discord:user:"))
                                     (update m (:source_node_id e) (fnil conj #{}) (subs target 13)) m))) {} authors-rows)
        docs-by-id (event-doc-map docs)
        mentioned (reduce (fn [m e]
                            (if (contains? #{"mentions_bluesky_user" "mentions_bluesky_post"} (:kind e))
                              (let [source (:source e) ids (get authors source) doc (get docs-by-id source)
                                    fallback (or (get-in doc [:extra :user_id]) (:author doc))
                                    author (first ids) handle (or (get-in e [:data :handle]) (.replace (:target e) #"^bluesky:user:" ""))]
                                (if (and (= 1 (count ids)) (or (nil? fallback) (= (str fallback) author)) (seq handle))
                                  (update m author (fnil conj #{}) handle) m)) m)) {} edges)]
    (update-in result [:stats :peopleBridges]
               (fn [bridges] (mapv (fn [bridge] (let [profiles (into (vec (:blueskyProfiles bridge)) (remove (set (:blueskyProfiles bridge)) (sort (get mentioned (:userId bridge)))))]
                                                 (assoc bridge :blueskyProfiles profiles :isBlueskyConnected (boolean (seq profiles))))) bridges)))))
(defn supplement-edges [req result max-nodes ids]
  (if (and (seq ids) (= (count ids) max-nodes))
    (-> (.toArray (.limit (.find (.. req -server -mongo -graphEdges)
                                (clj->js {:source_node_id {:$in ids} :target_node_id {:$in ids}})) 500))
        (.then (fn [rows] (add-visible-edges result (rows->data rows)))))
    (js/Promise.resolve result)))
(defn fetch-author-batches [collection sources]
  ;; The unique (source,target,kind) index makes two matching user rows decisive.
  ;; Limit concurrency and refuse oversized work rather than truncate ambiguity.
  (letfn [(step [batches acc]
            (if (empty? batches) (js/Promise.resolve acc)
              (-> (js/Promise.all
                   (clj->js (mapv (fn [source]
                                    (.toArray (.maxTimeMS (.limit (.project (.find collection
                                      (clj->js {:source_node_id source :edge_kind "authored_by" :target_node_id #"^discord:user:"}))
                                      #js {:source_node_id 1 :target_node_id 1}) 2) 1000))) (first batches))))
                  (.then (fn [results] (step (rest batches) (into acc (mapcat identity (js->clj results :keywordize-keys true)))))))))]
    (step (partition-all 16 sources) [])))
(defn supplement-bridges [req result]
  (let [sources (->> (:edges result) (filter #(contains? #{"mentions_bluesky_user" "mentions_bluesky_post"} (:kind %))) (map :source) distinct vec)
        mongo (.. req -server -mongo)
        projection #js {:id 1 :extra.node_id 1 :extra.user_id 1 :author 1}]
    (cond (empty? sources) (js/Promise.resolve result)
          (> (count sources) 100) (js/Promise.reject (js/Error. "graph correction exceeds bounded source count"))
          :else
          (-> (js/Promise.all #js [(fetch-author-batches (.-graphEdges mongo) sources)
                                    (.toArray (.maxTimeMS (.limit (.project (.find (.-events mongo) (clj->js {:id {:$in sources}})) projection) 1001) 1000))
                                    (.toArray (.maxTimeMS (.limit (.project (.find (.-events mongo) (clj->js {:extra.node_id {:$in sources}})) projection) 1001) 1000))])
              (.then (fn [rows]
                       (let [by-id (rows->data (aget rows 1)) by-node (rows->data (aget rows 2))]
                         (if (or (> (count by-id) 1000) (> (count by-node) 1000))
                           (throw (js/Error. "graph correction exceeds bounded hydration count"))
                           (add-unambiguous-bridges result (aget rows 0) (into by-id by-node))))))))))

(defn augment-graph [req response]
  (let [result (response->data response) body (js->clj (.-body req) :keywordize-keys true)
        max-nodes (min 1000 (max 1 (js/Number (or (:max_nodes body) (:maxNodes body) 250))))
        ids (mapv :id (:nodes result))]
    (-> (js/Promise.resolve nil)
        (.then (fn [] (supplement-edges req result max-nodes ids)))
        (.then (fn [with-edges] (supplement-bridges req with-edges)))
        (.then clj->js)
        (.catch (fn [err] (.warn (.-log req) #js {:err err} "graph correction unavailable; returning reference result") response)))))

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
                                          (let [result (.call original (.-server req) req reply)]
                                            (if (= url "/v1/graph/connections")
                                              (.then result (fn [response] (reset! original-graph (response->data response)) (augment-graph req response)))
                                              result))))))))
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
        (.then (fn [app] (reset! app-ref app) (reset! active-app app) (.listen app #js {:host "127.0.0.1" :port 0})))
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
