(ns promethean.records.socket-io.event-admission-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.socket-io.event-admission :as ea]))

(defn- mock-socket []
  (let [handlers (atom {})
        emissions (atom [])]
    #js {:on (fn [event handler]
               (swap! handlers update event (fnil conj []) handler))
         :off (fn [event handler]
                (swap! handlers update event (fn [hs] (vec (remove #(identical? % handler) hs)))))
          :emit (fn [event data]
                  (swap! emissions conj {:event event :data data})
                  ;; Auto-trigger response handler for testing
                  (let [causal-root (or (get data :causal/root)
                                        (aget data "causal/root"))]
                    (when-let [response-handers (get @handlers (str "response:" causal-root))]
                      (doseq [h response-handers]
                        (h #js {"event/id" "resp-1" :ok true})))))
         :handlers handlers
         :emissions emissions}))

(deftest ^:async append-event-test
  (testing "Appends event via Socket.IO emit"
    (let [sock (mock-socket)
          record (ea/->SocketIoEventAdmission sock)
          result (await (protocols/append-event! record
                          {:event/type "test" :payload {:x 1}}))]
      (is (= 1 (count @(.-emissions sock))))
      (is (= "event:append" (:event (first @(.-emissions sock)))))
      (is (= "resp-1" (aget result "event/id"))))))

(deftest ^:async query-events-test
  (testing "Queries events via Socket.IO emit"
    (let [sock (mock-socket)
          record (ea/->SocketIoEventAdmission sock)
          result (await (protocols/query-events record {:event/type "test"}))]
      (is (= "event:query" (:event (first @(.-emissions sock)))))
      (is (= "resp-1" (aget result "event/id"))))))

(deftest ^:async watch-events-test
  (testing "Watches events via Socket.IO on"
    (let [sock (mock-socket)
          record (ea/->SocketIoEventAdmission sock)
          received (atom nil)
          handle (protocols/watch-events record {:event/type "test"}
                                         (fn [event] (reset! received event)))]
      (is (some? (:id handle)))
      (is (fn? (:close! handle)))
      ;; Simulate an event
      (when-let [handlers (get @(.-handlers sock) "event:watch")]
        (doseq [h handlers]
          (h #js {"event/type" "test" "payload" #js {"x" 1}})))
      (is (= "test" (:event/type @received))))))
