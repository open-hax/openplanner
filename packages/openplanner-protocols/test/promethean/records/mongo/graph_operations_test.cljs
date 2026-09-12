(ns promethean.records.mongo.graph-operations-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.mongo.graph-operations :as go]))

(defn- mock-db []
  (let [nodes (atom {})
        edges (atom {})]
    #js {:collection (fn [name]
                       (case name
                         "graph_nodes"
                         #js {:insertOne (fn [doc]
                                           (let [id (or (.-_id doc) (str (random-uuid)))
                                                 stored (assoc (js->clj doc :keywordize-keys true) :_id id)]
                                             (swap! nodes assoc id stored)
                                             (js/Promise.resolve #js {})))
                              :find (fn [_query]
                                      #js {:toArray (fn [] (js/Promise.resolve (clj->js (vals @nodes))))})}
                         "graph_edges"
                         #js {:insertOne (fn [doc]
                                           (let [id (or (.-_id doc) (str (random-uuid)))
                                                 stored (assoc (js->clj doc :keywordize-keys true) :_id id)]
                                             (swap! edges assoc id stored)
                                             (js/Promise.resolve #js {})))
                              :find (fn [query]
                                      (let [q (js->clj query :keywordize-keys true)
                                            or-clauses (get q :$or)
                                            filtered (filter
                                                       (fn [edge]
                                                         (some (fn [clause]
                                                                 (or (= (:source clause) (:source edge))
                                                                     (= (:source clause) (:target edge))
                                                                     (= (:target clause) (:source edge))
                                                                     (= (:target clause) (:target edge))))
                                                               or-clauses))
                                                       (vals @edges))]
                                        #js {:toArray (fn [] (js/Promise.resolve (clj->js filtered)))}))}
                         #js {}))}))

(deftest ^:async add-node-test
  (testing "Adds a node"
    (let [db (mock-db)
          record (go/->MongoGraphOperations db)
          result (await (protocols/add-node record {:type "concept" :label "AI"}))]
      (is (some? (:id result)))
      (is (= "concept" (:type result)))
      (is (= "AI" (:label result))))))

(deftest ^:async add-edge-test
  (testing "Adds an edge"
    (let [db (mock-db)
          record (go/->MongoGraphOperations db)
          result (await (protocols/add-edge record {:source "a" :target "b" :type "related"}))]
      (is (some? (:id result)))
      (is (= "a" (:source result)))
      (is (= "b" (:target result))))))

(deftest ^:async query-neighbors-test
  (testing "Queries neighbors of a node"
    (let [db (mock-db)
          record (go/->MongoGraphOperations db)]
      (await (protocols/add-edge record {:source "node1" :target "node2" :type "knows"}))
      (await (protocols/add-edge record {:source "node1" :target "node3" :type "knows"}))
      (await (protocols/add-edge record {:source "node2" :target "node3" :type "follows"}))
      (let [result (await (protocols/query-neighbors record "node1" {}))]
        (is (vector? result))
        (is (some #(= "node2" %) result))
        (is (some #(= "node3" %) result))))))

(deftest ^:async traverse-test
  (testing "Traverses graph nodes"
    (let [db (mock-db)
          record (go/->MongoGraphOperations db)]
      (await (protocols/add-node record {:id "n1" :type "concept"}))
      (await (protocols/add-node record {:id "n2" :type "concept"}))
      (let [result (await (protocols/traverse record "n1" {}))]
        (is (vector? result))
        (is (>= (count result) 2))))))
