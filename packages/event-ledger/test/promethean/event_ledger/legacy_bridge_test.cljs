(ns promethean.event-ledger.legacy-bridge-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.event-ledger.legacy-bridge :as bridge]))

(defn- js-doc
  "Create a JS document object matching Mongo driver output."
  [id type & {:keys [time]}]
  (let [obj #js {"event/id" id "event/type" type "_id" "mock-id"}]
    (when time (aset obj "event/time" time))
    obj))

(defn- make-sorted-collection
  "Create a mock collection that returns docs sorted by event/time."
  [js-docs]
  (let [sorted (to-array (sort-by #(or (aget % "event/time") "") js-docs))]
    #js {:find (fn [_query]
                 #js {:toArray (fn [] (js/Promise.resolve sorted))})
         :findOne (fn [query]
                    (let [id (aget query "event/id")
                          found (first (filter #(= (aget % "event/id") id) sorted))]
                      (js/Promise.resolve (if found (js/JSON.parse (js/JSON.stringify found)) nil))))}))

(defn- make-db
  "Create a mock db with ledger and legacy collections."
  [ledger-docs legacy-docs]
  (let [default #js {:find (fn [] #js {:toArray (fn [] (js/Promise.resolve #js []))})
                     :findOne (fn [] (js/Promise.resolve nil))}]
    #js {:collection (fn [name]
                       (case name
                         "event_ledger" (make-sorted-collection ledger-docs)
                         "events" (make-sorted-collection legacy-docs)
                          default))}))

(deftest ^:async merge-find-events-dedup-test
  (testing "Deduplicates by event/id, ledger takes precedence"
    (let [db (make-db [(js-doc "e1" "a" :time "2026-01-01")
                       (js-doc "e2" "b" :time "2026-01-02")]
                      [(js-doc "e1" "legacy-a" :time "2026-01-01")
                       (js-doc "e3" "c" :time "2026-01-03")])
          result (await (bridge/merge-find-events db nil 10))]
      (is (= 3 (count result)))
      (is (= "a" (:event/type (first result)))))))

(deftest ^:async merge-find-events-sort-test
  (testing "Results sorted by timestamp"
    (let [db (make-db [(js-doc "e2" "x" :time "2026-01-02")]
                      [(js-doc "e1" "x" :time "2026-01-01")
                       (js-doc "e3" "x" :time "2026-01-03")])
          result (await (bridge/merge-find-events db nil 10))]
      (is (= ["e1" "e2" "e3"] (mapv :event/id result))))))

(deftest ^:async merge-find-events-limit-test
  (testing "Respects limit"
    (let [db (make-db [(js-doc "e1" "a" :time "2026-01-01")
                       (js-doc "e2" "b" :time "2026-01-02")
                       (js-doc "e3" "c" :time "2026-01-03")]
                      [])
          result (await (bridge/merge-find-events db nil 2))]
      (is (= 2 (count result))))))

(deftest ^:async find-event-by-id-ledger-first-test
  (testing "Checks ledger first"
    (let [db (make-db [(js-doc "e1" "from-ledger")]
                      [(js-doc "e1" "from-legacy")])
          result (await (bridge/find-event-by-id db "e1"))]
      (is (= "from-ledger" (:event/type result))))))

(deftest ^:async find-event-by-id-fallback-test
  (testing "Falls back to legacy if not in ledger"
    (let [db (make-db []
                      [(js-doc "e1" "from-legacy")])
          result (await (bridge/find-event-by-id db "e1"))]
      (is (= "from-legacy" (:event/type result))))))

(deftest ^:async find-event-by-id-not-found-test
  (testing "Returns nil when not found in either collection"
    (let [db (make-db [] [])
          result (await (bridge/find-event-by-id db "nonexistent"))]
      (is (nil? result)))))
