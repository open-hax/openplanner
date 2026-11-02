(ns promethean.records.rest.event-admission-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.event-admission :as ea]))

(deftest ^:async append-event-test
  (testing "Appends event via POST /events"
    (let [fetched (atom nil)]
      (set! js/globalThis.fetch
            (fn [url opts]
              (reset! fetched {:url url :opts opts})
              (js/Promise.resolve
                #js {:ok true
                     :status 200
                     :json (fn [] (js/Promise.resolve #js {"event/id" "123" "event/type" "test"}))})))
      (let [record (ea/->RestEventAdmission "http://localhost:3000" nil)
            result (await (protocols/append-event! record
                          {:event/type "test" :payload {:x 1}}))]
        (is (= "http://localhost:3000/events" (:url @fetched)))
        (is (= "POST" (aget (:opts @fetched) "method")))
        (is (= "123" (aget result "event/id")))))))

  (deftest ^:async append-event-with-auth-test
  (testing "Includes auth token in headers"
    (let [fetched (atom nil)]
      (set! js/globalThis.fetch
            (fn [url opts]
              (reset! fetched {:url url :opts opts})
              (js/Promise.resolve
                #js {:ok true
                     :status 200
                     :json (fn [] (js/Promise.resolve #js {"event/id" "123"}))})))
      (let [record (ea/->RestEventAdmission "http://localhost:3000" "my-token")
            _result (await (protocols/append-event! record {:event/type "test"}))]
        (is (= "Bearer my-token" (aget (.-headers (:opts @fetched)) "Authorization")))))))

(deftest ^:async append-events-test
  (testing "Appends multiple events via POST /events/batch"
    (set! js/globalThis.fetch
          (fn [_url _opts]
            (js/Promise.resolve
              #js {:ok true
                   :status 200
                   :json (fn [] (js/Promise.resolve #js {"count" 2}))})))
    (let [record (ea/->RestEventAdmission "http://localhost:3000" nil)
          result (await (protocols/append-events! record
                        [{:event/type "a"} {:event/type "b"}]))]
      (is (= 2 (aget result "count"))))))
