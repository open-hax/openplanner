(ns promethean.records.rest.user-management-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.user-management :as um]))

(defn- mock-response [body]
  #js {:ok true :status 200
       :json (fn [] (js/Promise.resolve body))})

(deftest ^:async create-user-test
  (testing "Creates user via POST /users"
    (let [fetched (atom nil)]
      (set! js/globalThis.fetch
            (fn [url opts]
              (reset! fetched {:url url :opts opts})
              (js/Promise.resolve
                (mock-response
                  #js {"event/type" "user.create.success"
                       "payload" #js {"userId" "u1"}}))))
      (let [record (um/->RestUserManagement "http://localhost:3000" nil)
            _result (await (protocols/create-user record {:username "alice"}))]
        (is (= "http://localhost:3000/users" (:url @fetched)))
        (is (= "POST" (aget (:opts @fetched) "method")))))))

(deftest ^:async authenticate-test
  (testing "Authenticates via POST /users/login"
    (set! js/globalThis.fetch
          (fn [_url _opts]
            (js/Promise.resolve
              (mock-response
                #js {"event/type" "user.login.success"
                     "payload" #js {"userId" "u1"}}))))
    (let [record (um/->RestUserManagement "http://localhost:3000" nil)
          result (await (protocols/authenticate record {:username "alice" :password "secret"}))]
      (is (= "user.login.success" (aget result "event/type"))))))

(deftest ^:async get-user-test
  (testing "Gets user via GET /users/:id"
    (set! js/globalThis.fetch
          (fn [_url _opts]
            (js/Promise.resolve
              (mock-response
                #js {"_id" "u1" "username" "alice"}))))
    (let [record (um/->RestUserManagement "http://localhost:3000" nil)
          result (await (protocols/get-user record "u1"))]
      (is (= "u1" (aget result "_id")))
      (is (= "alice" (aget result "username"))))))
