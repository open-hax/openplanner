(ns openplanner.kafka.jobs-test
  (:require [clojure.test :refer [deftest is testing]]
            [openplanner.kafka.jobs :as jobs])
  (:import (java.util Date)))

(def valid-event
  {:schema "openplanner.event.v1" :id "event-1"
   :ts "2026-01-02T03:04:05Z" :source "test" :kind "test"})

(deftest timestamp-validation
  (testing "a valid instant is preserved for Mongo"
    (is (nil? (jobs/validate-event! valid-event)))
    (is (= (Date/from (java.time.Instant/parse (:ts valid-event)))
           (:ts (jobs/event->mongo-map valid-event)))))
  (testing "malformed, impossible and missing timestamps are rejected"
    (doseq [ts ["not-a-date" "2026-02-30T03:04:05Z" "" nil]]
      (let [error (try (jobs/validate-event! (assoc valid-event :ts ts))
                       nil
                       (catch clojure.lang.ExceptionInfo e e))]
        (is (some? error) (str "expected rejection for " (pr-str ts)))
        (is (= :ts (:field (ex-data error))))
        (is (= "event-1" (:event-id (ex-data error))))))))
