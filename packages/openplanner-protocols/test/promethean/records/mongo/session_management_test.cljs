(ns promethean.records.mongo.session-management-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.mongo.session-management :as sm]))

(defn- mock-db []
  (let [sessions (atom {})]
    #js {:collection (fn [name]
                       (case name
                         "knoxx_sessions"
                         #js {:insertOne (fn [doc]
                                           (let [id (or (.-_id doc) (str (random-uuid)))
                                                 stored (assoc (js->clj doc :keywordize-keys true) :_id id)]
                                             (swap! sessions assoc id stored)
                                             (js/Promise.resolve #js {})))
                              :findOne (fn [query]
                                         (let [id (aget query "_id")]
                                           (js/Promise.resolve (clj->js (get @sessions id)))))
                              :findOneAndUpdate (fn [query update _opts]
                                                  (let [id (aget query "_id")
                                                        doc (get @sessions id)
                                                        set-doc (js->clj (.-$set update) :keywordize-keys true)
                                                        updated (merge doc set-doc)]
                                                    (swap! sessions assoc id updated)
                                                    (js/Promise.resolve #js {:value (clj->js updated)})))
                              :deleteOne (fn [query]
                                           (let [id (aget query "_id")]
                                             (swap! sessions dissoc id)
                                             (js/Promise.resolve #js {:deletedCount 1})))}
                         #js {}))}))

(deftest ^:async create-session-test
  (testing "Creates a session"
    (let [db (mock-db)
          record (sm/->MongoSessionManagement db)
          result (await (protocols/create-session record {:actor-id "user-1"}))]
      (is (some? (:_id result)))
      (is (= "user-1" (:actor-id result)))
      (is (some? (:createdAt result))))))

(deftest ^:async get-session-test
  (testing "Gets a session by ID"
    (let [db (mock-db)
          record (sm/->MongoSessionManagement db)
          created (await (protocols/create-session record {:actor-id "user-1"}))
          result (await (protocols/get-session record (:_id created)))]
      (is (= "user-1" (:actor-id result))))))

(deftest ^:async close-session-test
  (testing "Closes a session"
    (let [db (mock-db)
          record (sm/->MongoSessionManagement db)
          created (await (protocols/create-session record {:actor-id "user-1"}))
          result (await (protocols/close-session record (:_id created)))]
      (is (nil? result)))))
