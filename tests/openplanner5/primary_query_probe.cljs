;; Isolated query-shape experiment, not wired into a serving path.
(ns openplanner5.primary-query-probe)
(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_query_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(defn check! [label expected actual]
  (if (= expected actual) (println "PASS" label)
      (do (swap! failures inc) (println "FAIL" label "expected" (pr-str expected) "got" (pr-str actual)))))
(defn query [frontier] {:$or [{:source_node_id {:$in frontier}} {:target_node_id {:$in frontier}}]})
(defn primary-pipeline [frontier]
  [{:$match (query frontier)} {:$limit 500}
   {:$lookup {:from "graph_edges" :let {:source "$source_node_id" :kind "$edge_kind"}
              :pipeline [{:$match {:$expr {:$and [{:$eq ["$source_node_id" "$$source"]}
                                                   {:$eq ["$edge_kind" "authored_by"]}
                                                   {:$in ["$$kind" ["mentions_bluesky_user" "mentions_bluesky_post"]]}]}}}
                         {:$project {:_id 0 :target_node_id 1}}]
              :as "__authors"}}])
(defn exact-bytes [a b]
  {:$cond [{:$and [{:$eq [{:$type a} "string"]} {:$eq [{:$type b} "string"]}]}
           {:$and [{:$eq [{:$strLenBytes a} {:$strLenBytes b}]} {:$eq [{:$indexOfBytes [a b]} 0]}]}
           false]})
(defn primary-exact-pipeline [frontier]
  [{:$match (query frontier)} {:$limit 500}
   {:$lookup {:from "graph_edges" :let {:source "$source_node_id" :kind "$edge_kind"}
              :pipeline [{:$match {:$expr {:$and [{:$eq ["$source_node_id" "$$source"]} {:$eq ["$edge_kind" "authored_by"]}]}}}
                         {:$match {:$expr {:$and [(exact-bytes "$source_node_id" "$$source")
                                                    (exact-bytes "$edge_kind" "authored_by")
                                                    {:$or [(exact-bytes "$$kind" "mentions_bluesky_user")
                                                           (exact-bytes "$$kind" "mentions_bluesky_post")]}]}}}
                         {:$match {:target_node_id {:$regex "^discord:user:"}}}
                         {:$limit 2} {:$project {:_id 0 :target_node_id 1}}]
              :as "__authors"}}])
(defn selected-pipeline [frontier]
  (if (= "exact" (.-OPENPLANNER_QUERY_MODE js/process.env)) (primary-exact-pipeline frontier) (primary-pipeline frontier)))
(defn run [mongo]
  (let [client (new (.-MongoClient mongo) (str uri "/?directConnection=true")) db (.db client db-name) edges (.collection db "graph_edges")
        rows (into [{:source_node_id "discord:g:c:m" :target_node_id "discord:user:42" :edge_kind "authored_by"}
                    {:source_node_id "discord:g:c:m" :target_node_id "bluesky:user:alice" :edge_kind "mentions_bluesky_user"}
                    {:source_node_id "discord:g:c:m" :target_node_id "discord:user:43" :edge_kind "authored_by"}
                    {:source_node_id "discord:g:c:Case" :target_node_id "discord:user:case42" :edge_kind "authored_by"}
                    {:source_node_id "discord:g:c:Case" :target_node_id "bluesky:user:casealice" :edge_kind "mentions_bluesky_user"}
                    {:source_node_id "discord:g:c:case" :target_node_id "discord:user:case43" :edge_kind "authored_by"}
                    {:source_node_id "discord:g:c:case" :target_node_id "bluesky:user:casebob" :edge_kind "mentions_bluesky_user"}
                    {:source_node_id "discord:g:c:Case.[é🙂]" :target_node_id "discord:user:unicode42" :edge_kind "authored_by"}
                    {:source_node_id "discord:g:c:Case.[é🙂]" :target_node_id "bluesky:user:unicodealice" :edge_kind "mentions_bluesky_user"}
                    {:source_node_id "discord:g:c:case.[é🙂]" :target_node_id "discord:user:unicode43" :edge_kind "authored_by"}
                    {:source_node_id "discord:g:c:case.[é🙂]" :target_node_id "bluesky:user:unicodebob" :edge_kind "mentions_bluesky_user"}]
                   (conj (mapv (fn [i] {:source_node_id "topic:saturated" :target_node_id (str "discord:g:c:off-" i) :edge_kind "edge"}) (range 500))
                         {:source_node_id "topic:saturated" :target_node_id "topic:reachable" :edge_kind "edge"}))]
    (-> (.connect client)
        (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                       (.createCollection db "graph_edges" #js {:collation #js {:locale "en" :strength 2}})
                       (js/Promise.resolve nil))))
        (.then (fn [] (if (= "1" (.-OPENPLANNER_QUERY_INDEX js/process.env))
                       (js/Promise.all #js [(.createIndex edges #js {:source_node_id 1}) (.createIndex edges #js {:edge_kind 1})])
                       (js/Promise.resolve nil))))
        (.then (fn [] (.insertMany edges (clj->js rows))))
        (.then (fn [] (js/Promise.all #js [(.toArray (.limit (.find edges (clj->js (query ["discord:g:c:m"]))) 500))
                                           (.toArray (.aggregate edges (clj->js (selected-pipeline ["discord:g:c:m"]))))])))
        (.then (fn [result]
                 (let [reference (js->clj (aget result 0) :keywordize-keys true) enriched (js->clj (aget result 1) :keywordize-keys true)
                       fields (juxt :source_node_id :target_node_id :edge_kind)
                       mention (first (filter #(= "mentions_bluesky_user" (:edge_kind %)) enriched))]
                   (check! "primary lookup retains sampled cursor edge order" (mapv fields reference) (mapv fields enriched))
                   (check! "primary lookup observes both authors including unselected" #{"discord:user:42" "discord:user:43"} (set (map :target_node_id (:__authors mention))))
                   (js/Promise.all #js [(.toArray (.limit (.find edges (clj->js (query ["topic:saturated"]))) 500))
                                       (.toArray (.aggregate edges (clj->js (selected-pipeline ["topic:saturated"]))))]))))
        (.then (fn [result]
                 (let [reference (js->clj (aget result 0) :keywordize-keys true) enriched (js->clj (aget result 1) :keywordize-keys true)]
                   (check! "primary lookup preserves sampled 500-row cutoff" 500 (count enriched))
                   (check! "primary lookup preserves sampled saturated order" (mapv :target_node_id reference) (mapv :target_node_id enriched))
                   (check! "reference cutoff excludes 501st edge" false (boolean (some #(= "topic:reachable" (:target_node_id %)) reference)))
                   (-> (.toArray (.aggregate edges (clj->js [{:$match (query ["discord:g:c:m"])} {:$limit 500} {:$lookup {:from "graph_edges" :pipeline [{:$notARealStage {}}] :as "__authors"}}])))
                       (.then (fn [_] (check! "invalid enrichment fails while base read works" true false)))
                       (.catch (fn [_] (check! "invalid enrichment fails while base read works" true true)))))))
        (.then (fn [] (if (= "1" (.-OPENPLANNER_TEST_COLLATION js/process.env))
                       (-> (.toArray (.aggregate edges (clj->js (selected-pipeline ["discord:g:c:Case"]))))
                           (.then (fn [rows] (let [data (js->clj rows :keywordize-keys true)
                                                    by-source (into {} (map (fn [e] [(:source_node_id e) (set (map :target_node_id (:__authors e)))])
                                                                            (filter #(= "mentions_bluesky_user" (:edge_kind %)) data)))]
                                               (check! "collated primary lookup keeps author sources distinct"
                                                       {"discord:g:c:Case" #{"discord:user:case42"} "discord:g:c:case" #{"discord:user:case43"}} by-source))))
                           (.then (fn [] (if (= "exact" (.-OPENPLANNER_QUERY_MODE js/process.env))
                             (-> (js/Promise.all #js [(.toArray (.limit (.find edges (clj->js (query ["discord:g:c:Case.[é🙂]"]))) 500))
                                                       (.toArray (.aggregate edges (clj->js (selected-pipeline ["discord:g:c:Case.[é🙂]"]))))])
                                 (.then (fn [xs] (let [ref (js->clj (aget xs 0) :keywordize-keys true) actual (js->clj (aget xs 1) :keywordize-keys true)
                                                        by-source (into {} (map (fn [e] [(:source_node_id e) (set (map :target_node_id (:__authors e)))]) (filter #(= "mentions_bluesky_user" (:edge_kind %)) actual)))]
                                                   (check! "exact byte lookup preserves collated frontier order for metacharacter Unicode IDs" (mapv :target_node_id ref) (mapv :target_node_id actual))
                                                   (check! "exact byte lookup distinguishes metacharacter Unicode sources" {"discord:g:c:Case.[é🙂]" #{"discord:user:unicode42"} "discord:g:c:case.[é🙂]" #{"discord:user:unicode43"}} by-source)))))
                             (-> (js/Promise.all #js [(.toArray (.limit (.find edges (clj->js (query ["discord:g:c:Case"]))) 500))
                                                       (.toArray (.aggregate edges (clj->js (selected-pipeline ["discord:g:c:Case"])) #js {:collation #js {:locale "simple"}}))])
                                 (.then (fn [xs] (let [ref (js->clj (aget xs 0) :keywordize-keys true) simple (js->clj (aget xs 1) :keywordize-keys true)]
                                                   (check! "simple collation preserves reference frontier row selection" (mapv :target_node_id ref) (mapv :target_node_id simple))))))))))
                       (js/Promise.resolve nil))))
        (.then (fn [] (if (= "1" (.-OPENPLANNER_QUERY_EXPLAIN js/process.env))
                       (-> (.explain (.aggregate edges (clj->js (selected-pipeline ["discord:g:c:Case.[é🙂]"]))) "executionStats")
                           (.then (fn [plan] (println "EXPLAIN" (js/JSON.stringify plan)))))
                       (js/Promise.resolve nil))))
        (.finally (fn [] (-> (.dropDatabase db) (.then (fn [dropped] (println "Database dropped:" db-name dropped) (.close client)))))))))
(if-not (and uri (re-matches #"mongodb://127\.0\.0\.1:[0-9]+/?" uri))
  (do (js/console.error "OPENPLANNER_E2E_MONGO_URI must name disposable loopback MongoDB") (set! (.-exitCode js/process) 2))
  (-> (js/import "mongodb") (.then run)
      (.then (fn [] (when (pos? @failures) (set! (.-exitCode js/process) 1))))
      (.catch (fn [err] (js/console.error err) (set! (.-exitCode js/process) 2)))))
