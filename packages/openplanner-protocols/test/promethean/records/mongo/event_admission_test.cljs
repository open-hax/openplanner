(ns promethean.records.mongo.event-admission-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.mongo.event-admission :as ea]))

(defn- mock-collection []
  (let [docs (atom [])]
    #js {:insertOne (fn [doc]
                       (swap! docs conj (js->clj doc :keywordize-keys true))
                       (js/Promise.resolve #js {}))
         :find (fn [_query]
                 (let [cursor #js {:toArray (fn [] (js/Promise.resolve (clj->js @docs)))}]
                   (aset cursor "sort" (fn [_] cursor))
                   cursor))
         :findOne (fn [query]
                    (let [id (aget query "event/id")
                          found (first (filter #(= (:event/id %) id) @docs))]
                      (js/Promise.resolve (if found (clj->js found) nil))))
         :watch (fn [& _]
                  #js {:on (fn [_ _] #js {})})
         :docs docs}))

(defn- mock-db []
  (let [counters (atom 0)
        collections (atom {})]
    (letfn [(get-collection [name]
              (if-let [c (get @collections name)]
                c
                (let [c (case name
                          "_counters" #js {:findOneAndUpdate (fn [_ _ _]
                                                               (swap! counters inc)
                                                               #js {:value #js {:seq @counters}})}
                          "event_ledger" (mock-collection)
                          #js {})]
                  (swap! collections assoc name c)
                  c)))]
      #js {:collection (fn [name] (get-collection name))})))

(deftest ^:async append-event-test
  (testing "Appends event and returns document with ledger/seq"
    (let [db (mock-db)
          record (ea/->MongoEventAdmission db)
          result (await (protocols/append-event! record
                         {:event/type "user.create.request"
                          :payload {:username "alice"}}))]
      (is (= "user.create.request" (:event/type result)))
      (is (some? (:event/id result)))
      (is (some? (:event/time result)))
      (is (number? (:ledger/seq result)))
      (is (some? (:expiresAt result)))))

  (testing "Generates event/id when not provided"
    (let [db (mock-db)
          record (ea/->MongoEventAdmission db)
          result (await (protocols/append-event! record
                         {:event/type "test"}))]
      (is (string? (:event/id result)))
      (is (= 36 (count (:event/id result))))))

  (testing "Preserves existing event/id"
    (let [db (mock-db)
          record (ea/->MongoEventAdmission db)
          result (await (protocols/append-event! record
                         {:event/type "test" :event/id "custom-id"}))]
      (is (= "custom-id" (:event/id result))))))

(deftest ^:async append-events-test
  (testing "Appends multiple events"
    (let [db (mock-db)
          record (ea/->MongoEventAdmission db)
          result (await (protocols/append-events! record
                         [{:event/type "a" :payload {:x 1}}
                          {:event/type "b" :payload {:y 2}}]))]
      (is (= 2 (count result)))
      (is (= "a" (:event/type (first result))))
      (is (= "b" (:event/type (second result)))))))

(deftest ^:async query-events-test
  (testing "Queries events by filter"
    (let [db (mock-db)
          record (ea/->MongoEventAdmission db)]
      (await (protocols/append-event! record
                {:event/type "user.create.request" :payload {}}))
      (await (protocols/append-event! record
                {:event/type "session.create" :payload {}}))
      (let [result (await (protocols/query-events record {:event/type "user.create.request"}))]
        (is (vector? result))
        (is (>= (count result) 1))))))
