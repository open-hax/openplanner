(ns promethean.event-ledger.watcher-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.event-ledger.watcher :as watcher]))

(deftest build-pipeline-test
  (testing "Empty filter returns nil"
    (is (nil? (#'watcher/build-pipeline {}))))

  (testing "Single event/type filter"
    (let [result (#'watcher/build-pipeline {:event/type "user.create.request"})]
      (is (vector? result))
      (is (= 1 (count result)))
      (is (= "user.create.request"
             (get-in (first result) ["$match" "fullDocument.event/type"])))))

  (testing "Vector event/type filter produces $in"
    (let [result (#'watcher/build-pipeline {:event/type ["a" "b"]})]
      (is (= {"$in" ["a" "b"]}
             (get-in (first result) ["$match" "fullDocument.event/type"])))))

  (testing "session/id filter"
    (let [result (#'watcher/build-pipeline {:session/id "s1"})]
      (is (= "s1"
             (get-in (first result) ["$match" "fullDocument.session/id"])))))

  (testing "causal/root filter"
    (let [result (#'watcher/build-pipeline {:causal/root "r1"})]
      (is (= "r1"
             (get-in (first result) ["$match" "fullDocument.causal/root"])))))

  (testing "Combined filters"
    (let [result (#'watcher/build-pipeline {:event/type "x" :session/id "s1" :causal/root "r1"})]
      (is (= 1 (count result)))
      (let [match (get (first result) "$match")]
        (is (= "x" (get match "fullDocument.event/type")))
        (is (= "s1" (get match "fullDocument.session/id")))
        (is (= "r1" (get match "fullDocument.causal/root")))))))

(deftest watcher-registry-test
  (testing "close-all-watchers clears registry"
    (watcher/close-all-watchers)
    (is (= {} @@#'watcher/watcher-registry))))

(deftest generate-watcher-id-test
  (testing "Generates sequential IDs"
    (watcher/close-all-watchers)
    (let [id1 (#'watcher/generate-watcher-id)
          id2 (#'watcher/generate-watcher-id)]
      (is (string? id1))
      (is (string? id2))
      (is (not= id1 id2))
      (is (re-find #"^watcher-" id1))
      (is (re-find #"^watcher-" id2)))))
