(ns promethean.records.mongo.translation-management-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.mongo.translation-management :as tm]))

(defn- mock-db []
  (let [docs (atom {})]
    #js {:collection (fn [name]
                       (if (= name "translation_segments")
                         #js {:insertOne (fn [doc]
                                           (let [id (or (.-_id doc) (str (random-uuid)))
                                                 stored (assoc (js->clj doc :keywordize-keys true) :_id id)]
                                             (swap! docs assoc id stored)
                                             (js/Promise.resolve #js {})))
                               :findOneAndUpdate (fn [query update _opts]
                                                   (let [id (aget query "_id")
                                                         set-obj (.-$set update)
                                                         existing (get @docs id)]
                                                     (if existing
                                                       (let [updated (merge existing (js->clj set-obj :keywordize-keys true))]
                                                         (swap! docs assoc id updated)
                                                         (js/Promise.resolve #js {:value (clj->js updated)}))
                                                       (js/Promise.resolve #js {:value nil}))))
                              :insertMany (fn [arr]
                                            (doseq [doc (js->clj arr :keywordize-keys true)]
                                              (let [id (or (:id doc) (str (random-uuid)))]
                                                (swap! docs assoc id (assoc doc :_id id))))
                                            (js/Promise.resolve #js {}))}
                         #js {}))}))

(deftest ^:async create-translation-test
  (testing "Creates a translation segment"
    (let [db (mock-db)
          record (tm/->MongoTranslationManagement db)
          result (await (protocols/create-translation record {:source "hello" :target "hola"}))]
      (is (some? (:id result)))
      (is (= "hello" (:source result)))
      (is (= "hola" (:target result))))))

(deftest ^:async label-translation-test
  (testing "Labels a translation segment"
    (let [db (mock-db)
          record (tm/->MongoTranslationManagement db)
          created (await (protocols/create-translation record {:source "hello" :target "hola"}))
          result (await (protocols/label-translation record (:id created) "greeting"))]
      (is (some? result))
      (is (= "greeting" (:label result))))))

(deftest ^:async batch-translate-test
  (testing "Batch translates multiple segments"
    (let [db (mock-db)
          record (tm/->MongoTranslationManagement db)
          result (await (protocols/batch-translate record
                        [{:source "hello" :target "hola"}
                         {:source "bye" :target "adios"}]))]
      (is (string? result))
      (is (= 36 (count result))))))
