(ns promethean.records.mongo.label-management-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.mongo.label-management :as lm]))

(defn- mock-db []
  (let [labels (atom {})
        label-nodes (atom {})]
    #js {:collection (fn [name]
                       (case name
                         "km_labels"
                         #js {:insertOne (fn [doc]
                                           (let [id (or (.-_id doc) (str (random-uuid)))
                                                 stored (assoc (js->clj doc :keywordize-keys true) :_id id)]
                                             (swap! labels assoc id stored)
                                             (js/Promise.resolve #js {})))}
                         "graph_label_nodes"
                         #js {:insertOne (fn [doc]
                                           (let [id (or (.-_id doc) (str (random-uuid)))
                                                 stored (assoc (js->clj doc :keywordize-keys true) :_id id)]
                                             (swap! label-nodes assoc id stored)
                                             (js/Promise.resolve #js {})))
                              :find (fn [query]
                                      (let [q (js->clj query :keywordize-keys true)
                                            label-id (:labelId q)
                                            filtered (filter
                                                       (fn [ln]
                                                         (and (= (:labelId ln) label-id)
                                                              (or (nil? (:targetType q))
                                                                  (= (:targetType ln) (:targetType q)))))
                                                       (vals @label-nodes))]
                                        #js {:toArray (fn [] (js/Promise.resolve (clj->js filtered)))}))}
                         #js {}))}))

(deftest ^:async create-label-test
  (testing "Creates a label"
    (let [db (mock-db)
          record (lm/->MongoLabelManagement db)
          result (await (protocols/create-label record {:name "important" :color "red"}))]
      (is (some? (:id result)))
      (is (= "important" (:name result)))
      (is (= "red" (:color result))))))

(deftest ^:async apply-label-test
  (testing "Applies a label to a target"
    (let [db (mock-db)
          record (lm/->MongoLabelManagement db)
          result (await (protocols/apply-label record "label-1" "node-1" "node"))]
      (is (nil? result)))))

(deftest ^:async query-by-label-test
  (testing "Queries targets by label"
    (let [db (mock-db)
          record (lm/->MongoLabelManagement db)]
      (await (protocols/apply-label record "label-1" "node-1" "node"))
      (await (protocols/apply-label record "label-1" "node-2" "node"))
      (await (protocols/apply-label record "label-2" "node-3" "edge"))
      (let [result (await (protocols/query-by-label record "label-1" {}))]
        (is (vector? result))
        (is (= 2 (count result)))))))

(deftest ^:async query-by-label-with-type-test
  (testing "Queries targets by label with target type filter"
    (let [db (mock-db)
          record (lm/->MongoLabelManagement db)]
      (await (protocols/apply-label record "label-1" "node-1" "node"))
      (await (protocols/apply-label record "label-1" "edge-1" "edge"))
      (let [result (await (protocols/query-by-label record "label-1" {:target-type "node"}))]
        (is (vector? result))
        (is (= 1 (count result)))
        (is (= "node-1" (:targetId (first result))))))))
