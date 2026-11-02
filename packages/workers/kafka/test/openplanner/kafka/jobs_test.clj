(ns openplanner.kafka.jobs-test
  (:require [clojure.test :refer [deftest is testing run-tests]]
            [openplanner.kafka.jobs :as jobs]))

(deftest audit-record-parse-guard
  (testing "malformed JSON is isolated and a later valid record still parses"
    (let [[bad good] (mapv jobs/parse-audit-record
                           ["{" "{\"schema\":\"openplanner.event.v1\",\"id\":\"next\"}"])]
      (is (instance? Exception (:error bad)))
      (is (= "next" (:id (jobs/extract-event (:payload good)))))))
  (testing "fatal errors are not classified as bad records"
    (with-redefs [jobs/parse-json (fn [_] (throw (AssertionError. "fatal")))]
      (is (thrown? AssertionError (jobs/parse-audit-record "anything"))))))

(defn -main [& _]
  (let [{:keys [fail error]} (run-tests 'openplanner.kafka.jobs-test)]
    (when (pos? (+ fail error)) (System/exit 1))))
