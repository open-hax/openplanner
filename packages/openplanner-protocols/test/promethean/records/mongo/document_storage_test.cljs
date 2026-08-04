(ns promethean.records.mongo.document-storage-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.mongo.document-storage :as ds]))

(defn- mock-db-and-atoms [coll-name]
  (let [docs (atom {})]
    {:db #js {:collection (fn [name]
                            (if (= name coll-name)
                              #js {:insertOne (fn [doc]
                                                (let [id (or (.-_id doc) (str (random-uuid)))
                                                      stored (assoc (js->clj doc :keywordize-keys true) :_id id)]
                                                  (swap! docs assoc id stored)
                                                  (js/Promise.resolve #js {})))
                                   :findOne (fn [query]
                                              (let [id (aget query "_id")]
                                                (js/Promise.resolve (clj->js (get @docs id)))))
                                   :find (fn [_query]
                                           #js {:toArray (fn [] (js/Promise.resolve (clj->js (vals @docs))))})
                                   :updateOne (fn [query update]
                                                (let [id (aget query "_id")
                                                      set-obj (.-$set update)
                                                      existing (get @docs id)]
                                                  (when existing
                                                    (let [updated (merge existing (js->clj set-obj :keywordize-keys true))]
                                                      (swap! docs assoc id updated)))
                                                  (js/Promise.resolve #js {})))}
                              #js {}))}
     :docs docs}))

(deftest ^:async store-document-test
  (testing "Stores a document with generated id and timestamps"
    (let [{:keys [db]} (mock-db-and-atoms "test_docs")
          record (ds/->MongoDocumentStorage db "test_docs")
          result (await (protocols/store-document record {:title "Hello"}))]
      (is (some? (:id result)))
      (is (= "Hello" (:title result)))
      (is (some? (:created-at result)))
      (is (some? (:updated-at result)))))

  (testing "Preserves existing id"
    (let [{:keys [db]} (mock-db-and-atoms "test_docs")
          record (ds/->MongoDocumentStorage db "test_docs")
          result (await (protocols/store-document record {:id "custom-id" :title "Test"}))]
      (is (= "custom-id" (:id result))))))

(deftest ^:async get-document-test
  (testing "Gets a document by id"
    (let [{:keys [db docs]} (mock-db-and-atoms "test_docs")
          record (ds/->MongoDocumentStorage db "test_docs")
          _stored (await (protocols/store-document record {:title "Hello"}))
          doc-id (first (keys @docs))
          result (await (protocols/get-document record doc-id))]
      (is (some? result))
      (is (= "Hello" (:title result))))))

(deftest ^:async query-documents-test
  (testing "Queries documents"
    (let [{:keys [db]} (mock-db-and-atoms "test_docs")
          record (ds/->MongoDocumentStorage db "test_docs")]
      (await (protocols/store-document record {:title "First"}))
      (await (protocols/store-document record {:title "Second"}))
      (let [result (await (protocols/query-documents record {}))]
        (is (vector? result))
        (is (>= (count result) 2))))))

(deftest ^:async archive-document-test
  (testing "Archives a document"
    (let [{:keys [db docs]} (mock-db-and-atoms "test_docs")
          record (ds/->MongoDocumentStorage db "test_docs")
          _stored (await (protocols/store-document record {:title "To Archive"}))
          doc-id (first (keys @docs))
          result (await (protocols/archive-document record doc-id))]
      (is (nil? result)))))
