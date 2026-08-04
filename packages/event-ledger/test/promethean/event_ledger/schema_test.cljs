(ns promethean.event-ledger.schema-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.event-ledger.schema :as schema]))

(deftest validate-envelope-valid
  (testing "Valid minimal envelope"
    (let [result (schema/validate-envelope {:event/type "user.create.request"})]
      (is (true? (:valid result)))
      (is (nil? (:errors result)))))

  (testing "Valid full envelope"
    (let [result (schema/validate-envelope
                   {:event/id "test-123"
                    :event/type "user.create.request"
                    :event/time "2026-01-01T00:00:00Z"
                    :event/from {:actor-id "user-1" :actor-kind "user"}
                    :event/to {:actor-id "auth" :actor-kind "system"}
                    :causal/root "root-123"
                    :session/id "session-456"
                    :delivery/mode "tell"
                    :payload {:email "test@example.com"}
                    :contracts ["auth"]
                    :expectations {:timeout 30}})]
      (is (true? (:valid result)))))

  (testing "Valid envelope with delivery mode ask"
    (let [result (schema/validate-envelope {:event/type "test" :delivery/mode "ask"})]
      (is (true? (:valid result)))))

  (testing "Valid envelope with delivery mode stream"
    (let [result (schema/validate-envelope {:event/type "test" :delivery/mode "stream"})]
      (is (true? (:valid result)))))

  (testing "Valid envelope with delivery mode ack-required"
    (let [result (schema/validate-envelope {:event/type "test" :delivery/mode "ack-required"})]
      (is (true? (:valid result))))))

(deftest validate-envelope-invalid
  (testing "Missing event/type"
    (let [result (schema/validate-envelope {})]
      (is (false? (:valid result)))
      (is (seq (:errors result)))))

  (testing "Invalid delivery mode"
    (let [result (schema/validate-envelope {:event/type "test" :delivery/mode "invalid"})]
      (is (false? (:valid result)))
      (is (some #(re-find #"mode" %) (:errors result)))))

  (testing "Invalid from shape"
    (let [result (schema/validate-envelope
                   {:event/type "test"
                    :event/from {:actor-kind "user"}})]
      (is (false? (:valid result)))))

  (testing "Invalid event/type (not a string)"
    (let [result (schema/validate-envelope {:event/type 123})]
      (is (false? (:valid result))))))

(deftest validate-envelope-js-test
  (testing "JS-compatible validation returns JS object"
    (let [result (schema/validate-envelope-js
                   #js {"event/type" "user.create.request"})]
      (is (true? (.-valid result)))
      (is (nil? (.-errors result)))))

  (testing "JS validation with invalid input"
    (let [result (schema/validate-envelope-js #js {})]
      (is (false? (.-valid result)))
      (is (some? (.-errors result))))))
