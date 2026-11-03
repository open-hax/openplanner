;; Test-composed /v1 registration over loopback HTTP; disposable MongoDB only.
;; Run from repo root: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/graph_connections_full_port_probe.cljs
(ns graph-connections-full-port-probe
  (:require [openplanner.routes.graph-connections :as graph-port] [openplanner.graph.connections :as graph-domain]))

(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_app_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(def wrapped-calls (atom []))
(def reference-mode (atom false))
(def active-app (atom nil))
(def mongo-module (atom nil))
(defn check! [label expected actual]
  (if (= expected actual) (println "PASS" label)
      (do (swap! failures inc) (println "FAIL" label "expected" (pr-str expected) "got" (pr-str actual)))))
(defn request [base body auth? path]
  (-> (js/fetch (str base path) (clj->js {:method "POST" :headers (cond-> {"content-type" "application/json"} auth? (assoc "authorization" "Bearer isolated-test-key") @reference-mode (assoc "x-reference" "1")) :body (js/JSON.stringify (clj->js body))}))
      (.then (fn [response] (-> (.json response) (.then (fn [body] {:status (.-status response) :body (js->clj body :keywordize-keys true)})))))))

(defn compare-case [base body label]
  (reset! reference-mode true)
  (-> (request base body true "/v1/graph/connections")
      (.then (fn [reference]
               (reset! reference-mode false)
               (-> (request base body true "/v1/graph/connections")
                   (.then #(check! label reference %)))))))

(defn test-dedup-workload []
  (let [batches (partition-all 500 (map (fn [i] {:source_node_id (str "topic:bench-" i) :target_node_id "topic:dest" :edge_kind "edge"}) (range 1500)))
        start (js/Date.now) result (reduce graph-domain/merge-edges [] batches)]
    (check! "three 500-row merges preserve all unique edges" 1500 (count result))
    (println "SYNTHETIC DEDUP 1500 unique edges, port-ms" (- (js/Date.now) start))))

(defn stalled-request [base server sockets client-ref collection]
  (let [uri (str "mongodb://127.0.0.1:" (.-port (.address server)) "/?directConnection=true")
        client (new (.-MongoClient @mongo-module) uri #js {:serverSelectionTimeoutMS 10000 :connectTimeoutMS 10000 :socketTimeoutMS 10000})
        remote (.collection (.db client "isolated") "edges") start (js/Date.now)]
    (reset! client-ref client)
    (set! (.-find collection) (fn [& args] (.apply (.-find remote) remote (clj->js args))))
    (-> (request base {:seed_node_ids ["topic:stalled"] :max_nodes 1} true "/v1/graph/connections")
        (.then (fn [r] (let [elapsed (- (js/Date.now) start)]
                         (println "STALLED SUPPLEMENT elapsed-ms" elapsed "status" (:status r))
                         (check! "stalled supplement preserves reference status" 200 (:status r))
                         (check! "stalled supplement response bounded" true (< elapsed 3000))
                         (check! "stalled supplement reached isolated server" true (pos? (count @sockets)))))))))
(defn run-stalled-supplement [base net]
  (let [sockets (atom []) server (.createServer net (fn [socket] (swap! sockets conj socket)))
        client-ref (atom nil) collection (.. @active-app -mongo -graphEdges) original (.-find collection)]
    (-> (js/Promise. (fn [resolve reject] (.once server "error" reject) (.listen server #js {:host "127.0.0.1" :port 0} resolve)))
        (.then (fn [] (stalled-request base server sockets client-ref collection)))
        (.finally (fn [] (set! (.-find collection) original) (doseq [socket @sockets] (.destroy socket))
                    (-> (if @client-ref (.close @client-ref) (js/Promise.resolve))
                        (.then (fn [] (js/Promise. (fn [resolve] (.close server resolve)))))
                        (.then (fn [] (println "STALLED SUPPLEMENT fixture closed")))))))))
(defn test-stalled-supplement [base]
  (-> (js/import "node:net") (.then #(run-stalled-supplement base %))))

(defn run-cases [base db]
  (test-dedup-workload)
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
      (.then (fn [] (.insertMany (.collection db "graph_edges") (clj->js [{:source_node_id "discord:g:c:m" :target_node_id "discord:user:42" :edge_kind "authored_by" :data {:guild_id "g" :channel_id "c"}} {:source_node_id "discord:g:c:m" :target_node_id "bluesky:user:alice.example" :edge_kind "mentions_bluesky_user" :data {:handle "alice.example"}}]))))
      (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                      (-> (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :target_node_id "DISCORD:USER:42" :edge_kind "authored_by"}))
                          (.then (fn [] (check! "case-folding unique index rejects author alias" :duplicate :inserted)))
                          (.catch (fn [e] (check! "case-folding unique index rejects author alias" 11000 (.-code e)))))
                      (js/Promise.resolve nil))))
      (.then (fn [] (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 3} true "/v1/graph/connections")))
      (.then (fn [r] (check! "port induced edge count" 2 (count (get-in r [:body :edges])))
               (check! "port bridge profile" ["alice.example"] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))
               (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection) calls (atom 0)]
                 (set! (.-aggregate collection) (fn [& args]
                   (if (= 1 (swap! calls inc))
                     #js {:toArray (fn [] (let [e (js/Error. "synthetic transient read")] (set! (.-name e) "MongoNetworkError") (js/Promise.reject e)))}
                     (.apply original collection (clj->js args)))))
                 (-> (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 4} true "/v1/graph/connections")
                     (.then (fn [response] (check! "transient author read retries once" 2 @calls)
                              (check! "transient author read recovers profile" ["alice.example"] (get-in response [:body :stats :peopleBridges 0 :blueskyProfiles]))))
                     (.finally #(set! (.-aggregate collection) original))))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection) calls (atom 0)]
                 (set! (.-aggregate collection) (fn [& _] (swap! calls inc)
                   #js {:toArray (fn [] (let [e (js/Error. "synthetic persistent network failure")] (set! (.-name e) "MongoNetworkError") (js/Promise.reject e)))}))
                 (-> (compare-case base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 4} "persistent transient failure retains reference response")
                     (.then (fn [] (check! "persistent transient failure attempts at most twice" 2 @calls)))
                     (.finally #(set! (.-aggregate collection) original))))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection) calls (atom 0)]
                 (set! (.-aggregate collection) (fn [& _] (swap! calls inc)
                   #js {:toArray (fn [] (let [e (js/Error. "synthetic server timeout")] (set! (.-code e) 50) (js/Promise.reject e)))}))
                 (-> (compare-case base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 4} "server timeout retains reference response")
                     (.then (fn [] (check! "server timeout is not retried" 1 @calls)))
                     (.finally #(set! (.-aggregate collection) original))))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection)]
                 (set! (.-aggregate collection) (fn [& args] (let [cursor (.apply original collection (clj->js args)) to-array (.-toArray cursor)]
                   (set! (.-toArray cursor) (fn [] (-> (.call to-array cursor)
                     (.then (fn [rows] (-> (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :target_node_id "discord:user:43" :edge_kind "authored_by"}))
                                           (.then (fn [] rows)))))))) cursor)))
                 (-> (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 4} true "/v1/graph/connections")
                     (.then (fn [response]
                              (-> (.countDocuments (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :edge_kind "authored_by"}))
                                  (.then (fn [n] (check! "race: second author exists before response" 2 n)
                                           (check! "race: prior author result is emitted" ["alice.example"] (get-in response [:body :stats :peopleBridges 0 :blueskyProfiles])))))))
                     (.finally #(set! (.-aggregate collection) original))))))
      (.then (fn [] (.deleteOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :target_node_id "discord:user:43" :edge_kind "authored_by"}))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection)]
                      (set! (.-aggregate collection) (fn [& args] (let [cursor (.apply original collection (clj->js args)) to-array (.-toArray cursor)]
                        (set! (.-toArray cursor) (fn [] (-> (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :target_node_id "discord:user:43" :edge_kind "authored_by"}))
                          (.then (fn [] (.call to-array cursor)))))) cursor)))
                      (-> (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "discord:user:43" "bluesky:user:alice.example"] :max_nodes 5} true "/v1/graph/connections")
                          (.then (fn [r] (check! "race: traversal retains one author edge" 1 (count (filter #(= "authored_by" (:kind %)) (get-in r [:body :edges]))))
                                   (check! "race: later author observation blocks attribution" [[] []] (mapv :blueskyProfiles (get-in r [:body :stats :peopleBridges])))))
                          (.finally #(set! (.-aggregate collection) original))))))
      (.then (fn [] (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 3} true "/v1/graph/connections")))
      (.then (fn [r] (check! "hidden second author blocks new attribution" [] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))
               (.updateOne (.collection db "events") (clj->js {:id "discord:g:c:m"}) (clj->js {:$set {:extra.user_id "42" :author "43"}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "discord:user:43" "bluesky:user:alice.example"] :max_nodes 5} "conflicting authors retain reference hydrated fallback")))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection) calls (atom 0)]
                      (set! (.-aggregate collection) (fn [& _] (swap! calls inc) (throw (js/Error. "unnecessary author lookup"))))
                      (-> (compare-case base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "discord:user:43" "bluesky:user:alice.example"] :max_nodes 5} "hydrated fallback preserves response without author lookup")
                          (.then (fn [] (check! "hydrated fallback avoids supplemental author lookup" 0 @calls)))
                          (.finally #(set! (.-aggregate collection) original))))))
      (.then (fn [] (.deleteOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:m" :target_node_id "discord:user:43" :edge_kind "authored_by"}))))
      (.then (fn [] (.updateOne (.collection db "events") (clj->js {:id "discord:g:c:m"}) (clj->js {:$unset {:extra.user_id "" :author ""}}))))
      (.then (fn [] (reset! reference-mode true)
               (request base {:seed_node_ids ["topic:one"] :max_nodes 2} true "/v1/graph/connections")))
      (.then (fn [reference] (reset! reference-mode false)
               (-> (request base {:seed_node_ids ["topic:one"] :max_nodes 2} true "/v1/graph/connections")
                   (.then (fn [candidate] (check! "port reference full response parity" reference candidate))))))
      (.then (fn [] (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "discord:g:c:rank" :target_node_id "discord:user:rank20" :edge_kind "authored_by" :data {:guild_id "g-rank"}}))))
      (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                      (.insertMany (.collection db "graph_edges") (clj->js [{:source_node_id "discord:g:c:Case" :target_node_id "discord:user:case42" :edge_kind "authored_by"}
                        {:source_node_id "discord:g:c:Case" :target_node_id "bluesky:user:alice" :edge_kind "mentions_bluesky_user"}
                        {:source_node_id "discord:g:c:case" :target_node_id "discord:user:case43" :edge_kind "authored_by"}
                        {:source_node_id "discord:g:c:case" :target_node_id "bluesky:user:bob" :edge_kind "mentions_bluesky_user"}]))
                      (js/Promise.resolve nil))))
      (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                      (-> (request base {:seed_node_ids ["discord:g:c:Case" "discord:g:c:case" "discord:user:case42" "discord:user:case43" "bluesky:user:alice" "bluesky:user:bob"] :max_nodes 7} true "/v1/graph/connections")
                          (.then (fn [r] (check! "collation keeps author sources distinct" {"case42" ["alice"] "case43" ["bob"]}
                            (into {} (map (juxt :userId :blueskyProfiles) (get-in r [:body :stats :peopleBridges])))))))
                      (js/Promise.resolve nil))))
      (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                      (let [body {:seed_node_ids ["discord:g:c:Case" "discord:g:c:case" "discord:user:case42" "discord:user:case43" "bluesky:user:alice" "bluesky:user:bob"] :max_nodes 7}]
                        (reset! reference-mode true)
                        (-> (request base body true "/v1/graph/connections")
                            (.then (fn [reference] (reset! reference-mode false)
                              (-> (request base body true "/v1/graph/connections")
                                  (.then (fn [candidate]
                                    (let [strip (fn [r] (update-in r [:body :stats :peopleBridges]
                                      #(mapv (fn [bridge] (assoc bridge :blueskyProfiles [] :isBlueskyConnected false)) %)))]
                                      (check! "collation reference parity outside intended profiles" (strip reference) (strip candidate))))))))))
                      (js/Promise.resolve nil))))
      (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                      (.insertMany (.collection db "events") (clj->js [{:id "discord:g:c:Case" :extra {:user_id "case42"}}
                                                                         {:id "discord:g:c:case" :extra {:user_id "case43"}}]))
                      (js/Promise.resolve nil))))
      (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                      (compare-case base {:seed_node_ids ["discord:g:c:Case" "discord:g:c:case" "discord:user:case42" "discord:user:case43" "bluesky:user:alice" "bluesky:user:bob"] :max_nodes 7} "collation hydrated fallback matches reference")
                      (js/Promise.resolve nil))))
      (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                      (-> (.explain (.aggregate (.collection db "graph_edges")
                            (clj->js [{:$match {:source_node_id {:$in ["discord:g:c:Case" "discord:g:c:case"]} :edge_kind "authored_by" :target_node_id #"^discord:user:"}}
                                      {:$sort {:source_node_id 1 :target_node_id 1}}
                                      {:$group {:_id "$source_node_id" :first {:$first "$target_node_id"} :last {:$last "$target_node_id"}}}])
                            #js {:collation #js {:locale "simple"}}) "executionStats")
                          (.then (fn [plan] (println "COLLATION PLAN collection-scan" (.includes (js/JSON.stringify plan) "COLLSCAN") "index-scan" (.includes (js/JSON.stringify plan) "IXSCAN") "detail" (js/JSON.stringify plan)))))
                      (js/Promise.resolve nil))))
      (.then (fn [] (let [users (mapv #(str "discord:user:rank" %) (range 21))]
                     (request base {:seed_node_ids (conj users "discord:g:c:rank") :max_nodes 22 :lakes ["discord"]} true "/v1/graph/connections"))))
      (.then (fn [r] (check! "port promotes formerly 21st bridge" "rank20" (get-in r [:body :stats :peopleBridges 0 :userId]))
               (compare-case base {:seed_node_ids (mapv #(str "discord:user:tie" %) (range 25)) :max_nodes 26} "25 tied bridges match reference order")))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:one"] :max_nodes 0} "zero cap matches reference")))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:fraction-a" "topic:fraction-b"] :max_nodes 1.5} "fractional cap matches reference")))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:arr-a" "topic:arr-b"] :max_nodes [2]} "single-array cap matches reference")))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:arr-a" "topic:arr-b"] :max_nodes []} "empty-array cap matches reference")))
      (.then (fn [] (compare-case base {:query "absent-value"} "empty search matches reference")))
      (.then (fn [] (compare-case base {:query "literal["} "literal regex search matches reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "devel:regex" :kind "discord.message" :text "a[b[c"}))))
      (.then (fn [] (compare-case base {:query "a[b[c" :lakes ["devel"]} "multiple regex metacharacters match reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "devel:search" :kind "discord.message" :ts (js/Date. "2030-01-01T00:00:00Z") :text "DistinctivePhrase"}))))
      (.then (fn [] (compare-case base {:query "DistinctivePhrase" :lakes ["devel"]} "successful event search fallback matches reference")))
      (.then (fn [] (compare-case base {:lakes ["devel"]} "recent-event fallback matches reference")))
      (.then (fn [] (.createIndex (.collection db "graph_node_embeddings") #js {:text "text"})))
      (.then (fn [] (.insertMany (.collection db "graph_node_embeddings") (clj->js [{:node_id 0 :embedding_model "synthetic" :embedding_dimensions 1 :text "SpecialToken"}
                                                                                     {:node_id "topic:text-hit" :embedding_model "synthetic" :embedding_dimensions 1 :text "SpecialToken"}]))))
      (.then (fn [] (compare-case base {:query "SpecialToken" :lakes ["topic"]} "text index ignores falsy node ids and matches reference")))
      (.then (fn [] (let [events (.. @active-app -mongo -events) original (.-find events) fallback-calls (atom 0)]
                      (set! (.-find events) (fn [& args]
                        (when (aget (first args) "$or") (swap! fallback-calls inc))
                        (.apply original events (clj->js args))))
                      (-> (compare-case base {:query "SpecialToken" :lakes ["topic"] :max_nodes "NaN"} "NaN text-hit response matches reference")
                          (.then (fn [] (check! "NaN text hit avoids regex fallback in both routes" 0 @fallback-calls)))
                          (.finally #(set! (.-find events) original))))))
      (.then (fn [] (compare-case base {:seed_node_ids [42]} "invalid numeric seed matches reference error")))
      (.then (fn [] (compare-case base {:seed_node_ids [nil]} "null seed matches reference error")))
      (.then (fn [] (compare-case base {:seed_node_ids [false]} "false seed matches reference error")))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:one" 42] :max_nodes 1} "invalid seed after cap is ignored")))
      (.then (fn [] (compare-case base {:seed_node_ids ["devel:"] :lakes ["devel"]} "trailing empty node kind matches reference")))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:one"] :max_nodes "not-a-number"} "invalid numeric cap matches reference")))
      (.then (fn [] (compare-case base {:seedNodeIds ["desktop:window:w" "topic:one"] :includeDesktop false} "desktop filter matches reference")))
      (.then (fn [] (.insertMany (.collection db "events") (clj->js [{:id "topic:alias-a" :extra {:node_id "topic:alias-b" :label "first"}}
                                                                       {:id "topic:alias-b" :extra {:node_id "topic:alias-a" :label "second"}}]))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:alias-a" "topic:alias-b"] :max_nodes 3} "hydration aliases match reference")))
      (.then (fn [] (.insertMany (.collection db "events") (clj->js [{:id "discord:g:c:time-a" :ts (js/Date. "2026-01-01T00:00:00Z") :extra {:guild_id "g" :channel_id "c"}}
                                                                       {:id "discord:g:c:time-b" :ts (js/Date. "2026-01-01T00:00:00Z") :extra {:guild_id "g" :channel_id "c"}}]))))
      (.then (fn [] (compare-case base {:seed_node_ids ["discord:g:c:time-a" "discord:g:c:time-b"] :max_nodes 3} "equal timestamp timeframe matches reference")))
      (.then (fn [] (.insertMany (.collection db "graph_edges") (clj->js [{:source_node_id "topic:a||topic:b" :target_node_id "topic:c" :edge_kind "edge"}
                                                                             {:source_node_id "topic:a" :target_node_id "topic:b||topic:c" :edge_kind "edge"}]))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:a||topic:b" "topic:c" "topic:a" "topic:b||topic:c"] :max_nodes 5} "delimiter-colliding edge keys match reference")))
      (.then (fn [] (.insertMany (.collection db "events") (clj->js [{:id "discord:user:object-a" :extra {:user_id {:x 1}}}
                                                                       {:id "discord:user:object-b" :extra {:user_id {:x 1}}}]))))
      (.then (fn [] (compare-case base {:seed_node_ids ["discord:user:object-a" "discord:user:object-b"] :max_nodes 3} "object user identity matches JS Map reference")))
      (.then (fn [] (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "topic:spread-a" :target_node_id "topic:spread-b" :edge_kind "edge" :data "ab"}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:spread-a" "topic:spread-b"] :max_nodes 3} "string edge data matches JS spread")))
      (.then (fn [] (.insertMany (.collection db "graph_edges") (clj->js [{:source_node_id "topic:array-a" :target_node_id "topic:array-b" :edge_kind "edge" :data ["a" "b"]}
                                                                             {:source_node_id "topic:date-a" :target_node_id "topic:date-b" :edge_kind "edge" :data (js/Date. "2020-01-01T00:00:00Z")}]))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:array-a" "topic:array-b"] :max_nodes 3} "array edge data matches JS spread")))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:date-a" "topic:date-b"] :max_nodes 3} "date edge data matches JS spread")))
      (.then (fn [] (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "topic:oid-a" :target_node_id "topic:oid-b" :edge_kind "edge" :data (new (.-ObjectId @mongo-module) "507f1f77bcf86cd799439011")}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:oid-a" "topic:oid-b"] :max_nodes 3} "BSON ObjectId edge spread matches reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "discord:g:c:oid" :extra {:guild_id (new (.-ObjectId @mongo-module) "507f1f77bcf86cd799439011") :channel_id "c"}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["discord:g:c:oid"] :max_nodes 2} "BSON ObjectId permalink matches reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "topic:oid-array" :extra {:label [(new (.-ObjectId @mongo-module) "507f1f77bcf86cd799439011")]}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:oid-array"] :max_nodes 2} "nested BSON array label matches reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "topic:oid-label" :extra {:label (new (.-ObjectId @mongo-module) "507f1f77bcf86cd799439011")}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:oid-label"] :max_nodes 2} "BSON ObjectId label string matches reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "topic:oid" :extra {:id (new (.-ObjectId @mongo-module) "507f1f77bcf86cd799439011")}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:oid"] :max_nodes 2} "nested BSON ObjectId matches reference JSON")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "topic:false-extra" :extra false}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:false-extra"] :max_nodes 2} "false event extra matches reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "topic:slash" :extra {"a/b" 1 "b" 2 "nested" {"x/y" 3 "y" 4}}}))))
      (.then (fn [] (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "topic:slash" :target_node_id "topic:slash-target" :edge_kind "edge" :data {"a/b" 1 "b" 2}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:slash" "topic:slash-target"] :max_nodes 3} "arbitrary slash keys and collisions match reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "discord:g:c:" :extra {:guild_id "g" :channel_id "c"}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["discord:g:c:"] :max_nodes 2} "trailing colon permalink matches reference")))
      (.then (fn [] (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "topic:decimal-a" :target_node_id "topic:decimal-b" :edge_kind "edge" :data (.fromString (.-Decimal128 @mongo-module) "12.34")}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:decimal-a" "topic:decimal-b"] :max_nodes 3} "BSON Decimal128 edge spread matches reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "topic:decimal" :extra {:value (.fromString (.-Decimal128 @mongo-module) "12.34")}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:decimal"] :max_nodes 2} "nested BSON Decimal128 matches reference JSON")))
      (.then (fn [] (.insertMany (.collection db "graph_edges") (clj->js [{:source_node_id "topic:long-a" :target_node_id "topic:long-b" :edge_kind "edge" :data (.fromString (.-Long @mongo-module) "9223372036854775807")}
                                                                             {:source_node_id "topic:binary-a" :target_node_id "topic:binary-b" :edge_kind "edge" :data (new (.-Binary @mongo-module) (.from js/Buffer #js [1 2 3]))}]))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:long-a" "topic:long-b"] :max_nodes 3} "BSON Long edge spread matches reference")))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:binary-a" "topic:binary-b"] :max_nodes 3} "BSON Binary edge spread matches reference")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "topic:special" :extra {:large (.fromString (.-Long @mongo-module) "9223372036854775807") :blob (new (.-Binary @mongo-module) (.from js/Buffer #js [1 2 3]))}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:special"] :max_nodes 2} "nested BSON Long and Binary match reference JSON")))
      (.then (fn [] (.insertOne (.collection db "events") (clj->js {:id "topic:bson" :extra {:label "BSON" :nested {:at (js/Date. "2020-01-01T00:00:00Z")}}}))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:bson"] :max_nodes 2} "nested BSON date matches reference JSON")))
      (.then (fn [] (.insertMany (.collection db "graph_edges")
                 (clj->js (conj (mapv (fn [i] {:source_node_id "topic:oversat" :target_node_id (str "topic:out-" i) :edge_kind "mentions_topic"}) (range 500))
                                {:source_node_id "topic:oversat" :target_node_id "topic:desired" :edge_kind "mentions_topic"})))))
      (.then (fn [] (compare-case base {:seed_node_ids ["topic:oversat"] :max_nodes 3} "500-edge traversal matches reference")))
      (.then (fn [] (request base {:seed_node_ids ["topic:oversat" "topic:desired"] :max_nodes 2} true "/v1/graph/connections")))
      (.then (fn [r] (check! "cap selects desired edge beyond off-selection saturation" 1 (count (get-in r [:body :edges])))
               (let [ids (mapv #(str "topic:selected-" %) (range 23))
                     rows (vec (take 501 (for [a ids b ids] {:source_node_id a :target_node_id b :edge_kind "mentions_topic"})))]
                 (-> (.insertMany (.collection db "graph_edges") (clj->js rows))
                     (.then (fn [] (let [start (js/Date.now)]
                                      (reset! reference-mode true)
                                      (-> (request base {:seed_node_ids ids :max_nodes 23} true "/v1/graph/connections")
                                          (.then (fn [_] (let [reference-ms (- (js/Date.now) start) candidate-start (js/Date.now)]
                                            (reset! reference-mode false)
                                            (-> (request base {:seed_node_ids ids :max_nodes 23} true "/v1/graph/connections")
                                                (.then (fn [candidate] (println "SYNTHETIC LATENCY 500 selected edges, reference-ms" reference-ms "port-ms" (- (js/Date.now) candidate-start)) candidate))))))))))
                     (.then (fn [result]
                              (check! "full cap selected-edge bound" 500 (count (get-in result [:body :edges])))
                              (-> (.toArray (.limit (.find (.collection db "graph_edges") (clj->js {:source_node_id {:$in ids} :target_node_id {:$in ids}})) 500))
                                  (.then (fn [found] (check! "full cap preserves selected cursor order"
                                    (mapv #(select-keys % [:source_node_id :target_node_id]) (js->clj found :keywordize-keys true))
                                    (mapv (fn [e] {:source_node_id (:source e) :target_node_id (:target e)}) (get-in result [:body :edges]))))))))))))
      (.then (fn [] (let [rows (vec (mapcat (fn [i] (let [m (str "discord:lat:g:m" i) u (str "discord:user:lat" i) p (str "bluesky:user:lat" i)]
                                                        [{:source_node_id m :target_node_id u :edge_kind "authored_by"}
                                                         {:source_node_id m :target_node_id p :edge_kind "mentions_bluesky_user"}])) (range 64)))]
                     (.insertMany (.collection db "graph_edges") (clj->js rows)))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection)
                          ids (vec (mapcat (fn [i] [(str "discord:lat:g:m" i) (str "discord:user:lat" i) (str "bluesky:user:lat" i)]) (range 64)))
                          payload {:seed_node_ids ids :max_nodes 193}]
                     (set! (.-aggregate collection) (fn [& args]
                       (let [cursor (.apply original collection (clj->js args))]
                         (when true
                           (let [to-array (.-toArray cursor)]
                             (set! (.-toArray cursor) (fn [] (js/Promise. (fn [resolve reject]
                               (js/setTimeout (fn [] (-> (.call to-array cursor) (.then resolve) (.catch reject))) 50))))))) cursor)))
                     (let [start (js/Date.now)]
                       (reset! reference-mode true)
                       (-> (request base payload true "/v1/graph/connections")
                           (.then (fn [reference] (let [reference-ms (- (js/Date.now) start) candidate-start (js/Date.now)]
                             (reset! reference-mode false)
                             (-> (request base payload true "/v1/graph/connections")
                                 (.then (fn [candidate] (println "SYNTHETIC LATENCY 64 authors, 50ms/aggregate, reference-ms" reference-ms "port-ms" (- (js/Date.now) candidate-start))
                                          (check! "synthetic latency requests succeeded" [200 200] [(:status reference) (:status candidate)])))))))
                           (.finally #(set! (.-aggregate collection) original)))))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection)]
                     (set! (.-aggregate collection) (fn [& _] (throw (js/Error. "synthetic author read failure"))))
                     (-> (request base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 3} true "/v1/graph/connections")
                         (.then (fn [r] (check! "author failure preserves exact cap edges" #{["discord:g:c:m" "discord:user:42" "authored_by"] ["discord:g:c:m" "bluesky:user:alice.example" "mentions_bluesky_user"]} (set (map (juxt :source :target :kind) (get-in r [:body :edges]))))
                                  (check! "author failure leaves profile uncorrected" [] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))))
                         (.finally #(set! (.-aggregate collection) original))))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-aggregate collection)]
                     (set! (.-aggregate collection) (fn [& _] (throw (js/Error. "synthetic author read failure"))))
                     (-> (compare-case base {:seed_node_ids ["discord:g:c:m" "discord:user:42" "bluesky:user:alice.example"] :max_nodes 4} "author query failure preserves reference response")
                         (.finally #(set! (.-aggregate collection) original))))))
      (.then (fn [] (.insertOne (.collection db "graph_edges") (clj->js {:source_node_id "topic:retry-a" :target_node_id "topic:retry-b" :edge_kind "edge"}))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-find collection) calls (atom 0)]
                      (set! (.-find collection) (fn [& args]
                        (if (= 1 (swap! calls inc))
                          (let [cursor (js-obj) failure (fn [] (let [e (js/Error. "synthetic transient edge read")] (set! (.-name e) "MongoNetworkError") (js/Promise.reject e)))]
                            (aset cursor "limit" (fn [_] cursor)) (aset cursor "maxTimeMS" (fn [_] cursor)) (aset cursor "toArray" failure) cursor)
                          (.apply original collection (clj->js args)))))
                      (-> (request base {:seed_node_ids ["topic:retry-a" "topic:retry-b"] :max_nodes 2} true "/v1/graph/connections")
                          (.then (fn [response] (check! "transient edge read retries once" 2 @calls)
                                   (check! "transient edge read recovers edge" 1 (count (get-in response [:body :edges])))))
                          (.finally #(set! (.-find collection) original))))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-find collection)]
                      (set! (.-find collection) (fn [& args] (let [filter (first args)]
                        (if (and (.-source_node_id filter) (.-target_node_id filter))
                          (throw (js/Error. "synthetic cap read failure"))
                          (.apply original collection (clj->js args))))))
                      (-> (request base {:seed_node_ids ["discord:g:c:m"] :max_nodes 3} true "/v1/graph/connections")
                          (.then (fn [r] (check! "cap failure preserves traversal edges" #{["discord:g:c:m" "discord:user:42" "authored_by"] ["discord:g:c:m" "bluesky:user:alice.example" "mentions_bluesky_user"]} (set (map (juxt :source :target :kind) (get-in r [:body :edges]))))
                                   (check! "cap failure preserves successful author fix" ["alice.example"] (get-in r [:body :stats :peopleBridges 0 :blueskyProfiles]))))
                          (.finally #(set! (.-find collection) original))))))
      (.then (fn [] (test-stalled-supplement base)))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-find collection)]
                     (set! (.-find collection) (fn [& _] (throw (js/Error. "synthetic supplemental read failure"))))
                     (-> (compare-case base {:seed_node_ids ["topic:error"] :max_nodes 1} "supplemental read failure preserves reference response")
                         (.finally #(set! (.-find collection) original))))))
      (.then (fn [] (let [collection (.. @active-app -mongo -graphEdges) original (.-find collection)]
                     (set! (.-find collection) (fn [& _] (throw (js/Error. "synthetic graph read failure"))))
                     (-> (compare-case base {:seed_node_ids ["topic:error"] :max_nodes 2} "graph read failure matches reference")
                         (.finally #(set! (.-find collection) original))))))))

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
                                          (if (and (= url "/v1/graph/connections") (not= "1" (aget (.-headers req) "x-reference")))
                                            (graph-port/handler req reply)
                                            (.call original (.-server req) req reply))))))))
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
  (reset! mongo-module (aget modules 2))
  (let [client (new (.-MongoClient (aget modules 2)) (str uri "/?directConnection=true"))
        db (.db client db-name)
        app-ref (atom nil)]
    (-> (.connect client)
        (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                         (.createCollection db "graph_edges" #js {:collation #js {:locale "en" :strength 2}})
                         (js/Promise.resolve nil))))
        (.then (fn [] (compose-app modules ((.-loadConfig (aget modules 1))))) )
        (.then (fn [app] (reset! app-ref app) (reset! active-app app) (.listen app #js {:host "127.0.0.1" :port 0})))
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
