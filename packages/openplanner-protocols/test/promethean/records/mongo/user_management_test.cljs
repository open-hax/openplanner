(ns promethean.records.mongo.user-management-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.mongo.user-management :as um]))

(defn- mock-db []
  (let [users (atom {})]
    #js {:collection (fn [name]
                       (if (= name "knoxx_users")
                         #js {:insertOne (fn [doc]
                                           (let [id (or (.-_id doc) (str (random-uuid)))
                                                 stored (assoc (js->clj doc :keywordize-keys true) :_id id)]
                                             (swap! users assoc id stored)
                                             (js/Promise.resolve #js {})))
                              :findOne (fn [query]
                                         (let [id (aget query "_id")
                                               username (aget query "username")]
                                           (cond
                                             id (js/Promise.resolve (clj->js (get @users id)))
                                             username (js/Promise.resolve
                                                        (clj->js
                                                          (first (filter #(= (:username %) username) (vals @users)))))
                                             :else (js/Promise.resolve nil))))
                              :findOneAndUpdate (fn [query update _opts]
                                                  (let [id (aget query "_id")
                                                        set-obj (.-$set update)
                                                        existing (get @users id)]
                                                    (if existing
                                                      (let [updated (merge existing (js->clj set-obj :keywordize-keys true))]
                                                        (swap! users assoc id updated)
                                                        (js/Promise.resolve #js {:value (clj->js updated)}))
                                                      (js/Promise.resolve #js {:value nil}))))}
                         #js {}))}))

(deftest ^:async create-user-test
  (testing "Creates a user"
    (let [db (mock-db)
          record (um/->MongoUserManagement db)
          result (await (protocols/create-user record {:username "alice" :email "alice@test.com"}))]
      (is (= "user.create.success" (:event/type result)))
      (is (some? (get-in result [:payload :userId]))))))

(deftest ^:async authenticate-success-test
  (testing "Authenticates with valid credentials"
    (let [db (mock-db)
          record (um/->MongoUserManagement db)]
      (await (protocols/create-user record {:username "alice" :password "secret"}))
      (let [result (await (protocols/authenticate record {:username "alice"}))]
        (is (= "user.login.success" (:event/type result)))
        (is (some? (get-in result [:payload :userId])))))))

(deftest ^:async authenticate-failure-test
  (testing "Fails to authenticate with invalid user"
    (let [db (mock-db)
          record (um/->MongoUserManagement db)
          result (await (protocols/authenticate record {:username "unknown"}))]
      (is (= "user.login.failure" (:event/type result)))
      (is (= "user not found" (get-in result [:payload :reason]))))))

(deftest ^:async get-user-test
  (testing "Gets a user by id"
    (let [db (mock-db)
          record (um/->MongoUserManagement db)
          created (await (protocols/create-user record {:username "alice"}))
          user-id (get-in created [:payload :userId])
          result (await (protocols/get-user record user-id))]
      (is (some? result))
      (is (= "alice" (:username result))))))

(deftest ^:async update-user-test
  (testing "Updates a user"
    (let [db (mock-db)
          record (um/->MongoUserManagement db)
          created (await (protocols/create-user record {:username "alice"}))
          user-id (get-in created [:payload :userId])
          result (await (protocols/update-user record user-id {:email "new@test.com"}))]
      (is (= "user.update.success" (:event/type result))))))

(deftest ^:async update-user-not-found-test
  (testing "Fails to update non-existent user"
    (let [db (mock-db)
          record (um/->MongoUserManagement db)
          result (await (protocols/update-user record "nonexistent" {:email "x"}))]
      (is (= "user.update.failure" (:event/type result)))
      (is (= "user not found" (get-in result [:payload :reason]))))))
