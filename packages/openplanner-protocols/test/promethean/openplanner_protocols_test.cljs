(ns promethean.openplanner-protocols-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]))

(deftest make-envelope-test
  (testing "Creates envelope with required fields"
    (let [env (protocols/make-envelope "user.create.request" {:username "alice"})]
      (is (= "user.create.request" (:event/type env)))
      (is (= {:username "alice"} (:payload env)))))

  (testing "Envelope passes validation"
    (let [env (protocols/make-envelope "test.event" {})]
      (is (:valid (protocols/validate-envelope env))))))

(deftest validate-envelope-test
  (testing "Rejects envelope without event/type"
    (let [result (protocols/validate-envelope {:payload {}})]
      (is (not (:valid result)))
      (is (seq (:errors result)))))

  (testing "Accepts valid envelope"
    (let [result (protocols/validate-envelope
                   {:event/type "test"
                    :event/id "abc"
                    :payload {:key "val"}})]
      (is (:valid result)))))

(deftest protocol-definitions-exist-test
  (testing "All protocols are defined"
    (is (some? protocols/EventAdmission))
    (is (some? protocols/SessionManagement))
    (is (some? protocols/DocumentStorage))
    (is (some? protocols/GraphOperations))
    (is (some? protocols/TranslationManagement))
    (is (some? protocols/LabelManagement))
    (is (some? protocols/UserManagement))
    (is (some? protocols/RealtimeSubscription))))

(deftest validate-envelope-js-test
  (testing "JS interop: accepts valid JS object"
    (let [js-obj #js {"event/type" "test.event" "payload" #js {"key" "val"}}
          result (js->clj (protocols/validate-envelope-js js-obj) :keywordize-keys true)]
      (is (:valid result))))

  (testing "JS interop: rejects invalid JS object"
    (let [js-obj #js {"payload" #js {}}
          result (js->clj (protocols/validate-envelope-js js-obj) :keywordize-keys true)]
      (is (not (:valid result))))))

(deftest validate-envelope-edge-cases-test
  (testing "Rejects nil envelope"
    (let [result (protocols/validate-envelope nil)]
      (is (not (:valid result)))))

  (testing "Rejects empty map"
    (let [result (protocols/validate-envelope {})]
      (is (not (:valid result)))))

  (testing "Invalid event/from structure"
    (let [result (protocols/validate-envelope
                   {:event/type "test"
                    :event/from {:actor-id 123}})]
      (is (not (:valid result)))))

  (testing "Invalid delivery/mode enum"
    (let [result (protocols/validate-envelope
                   {:event/type "test"
                    :delivery/mode "invalid"})]
      (is (not (:valid result)))))

  (testing "Valid with all optional fields"
    (let [result (protocols/validate-envelope
                   {:event/type "test"
                    :event/id "id-1"
                    :event/time "2026-01-01T00:00:00Z"
                    :event/from {:actor-id "a" :actor-kind "web"}
                    :event/to {:actor-id "b" :actor-kind "server"}
                    :causal/root "root-1"
                    :causal/parent "parent-1"
                    :session/id "sess-1"
                    :turn/id "turn-1"
                    :delivery/mode "ask"
                    :delivery/id "del-1"
                    :payload {:key "val"}
                    :contracts ["c1"]
                    :expectations {:e "v"}})]
      (is (:valid result)))))
