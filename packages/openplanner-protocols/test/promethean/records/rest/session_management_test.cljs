(ns promethean.records.rest.session-management-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.session-management :as sm]))

(deftest ^:async create-session-test
  (testing "Creates session via POST /sessions"
    (let [fetched (atom nil)]
      (set! js/globalThis.fetch
            (fn [url opts]
              (reset! fetched {:url url :opts opts})
              (js/Promise.resolve
                #js {:ok true
                     :status 200
                     :json (fn [] (js/Promise.resolve #js {"_id" "s1" "actor-id" "user-1"}))})))
      (let [record (sm/->RestSessionManagement "http://localhost:3000" nil)
            result (await (protocols/create-session record {:actor-id "user-1"}))]
        (is (= "http://localhost:3000/sessions" (:url @fetched)))
        (is (= "POST" (aget (:opts @fetched) "method")))
        (is (= "s1" (aget result "_id")))))))

(deftest ^:async get-session-test
  (testing "Gets session via GET /sessions/:id"
    (set! js/globalThis.fetch
          (fn [_url _opts]
            (js/Promise.resolve
              #js {:ok true
                   :status 200
                   :json (fn [] (js/Promise.resolve #js {"_id" "s1" "actor-id" "user-1"}))})))
    (let [record (sm/->RestSessionManagement "http://localhost:3000" nil)
          result (await (protocols/get-session record "s1"))]
      (is (= "s1" (aget result "_id")))
      (is (= "user-1" (aget result "actor-id"))))))

(deftest ^:async close-session-test
  (testing "Closes session via DELETE /sessions/:id"
    (let [fetched (atom nil)]
      (set! js/globalThis.fetch
            (fn [url opts]
              (reset! fetched {:url url :opts opts})
              (js/Promise.resolve
                #js {:ok true :status 200
                     :json (fn [] (js/Promise.resolve nil))})))
      (let [record (sm/->RestSessionManagement "http://localhost:3000" nil)
            _result (await (protocols/close-session record "s1"))]
        (is (= "http://localhost:3000/sessions/s1" (:url @fetched)))
        (is (= "DELETE" (aget (:opts @fetched) "method")))))))
