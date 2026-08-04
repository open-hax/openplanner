(ns promethean.event-ledger.core-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.event-ledger.core :as core]))

(defn- mock-collection
  "Create a mock Mongo collection that tracks calls."
  [_opts]
  (let [calls (atom [])
        inserted (atom nil)
        existing-doc (atom nil)]
    #js {:insertOne (fn [doc]
                       (swap! calls conj {:method :insertOne :doc (js->clj doc :keywordize-keys true)})
                       (reset! inserted doc)
                       (js/Promise.resolve #js {}))
         :findOne (fn [query]
                    (swap! calls conj {:method :findOne :query (js->clj query :keywordize-keys true)})
                    (js/Promise.resolve (or @existing-doc #js {})))
         :createIndex (fn [keys _opts]
                        (swap! calls conj {:method :createIndex :keys (js->clj keys :keywordize-keys true)})
                        (js/Promise.resolve #js {}))
         :calls calls
         :inserted inserted
         :existing-doc existing-doc}))

(defn- make-counters []
  (let [seq-counter (atom 0)]
    #js {:findOneAndUpdate (fn [_ _ _]
                             (swap! seq-counter inc)
                             #js {:value #js {:seq @seq-counter}})}))

(defn- make-ttl-overrides []
  #js {:find (fn [_]
               #js {:toArray (fn [] (js/Promise.resolve #js []))})})

(defn- make-default []
  #js {:insertOne (fn [_] (js/Promise.resolve #js {}))
       :findOne (fn [_] (js/Promise.resolve #js {}))
       :createIndex (fn [_ _] (js/Promise.resolve #js {}))
       :watch (fn [& _] #js {:on (fn [_ _] #js {})})})

(defn- mock-db
  "Create a mock Mongo db with a counters collection and ledger collection."
  []
  (let [collections (atom {})]
    (letfn [(get-collection [name]
              (if-let [c (get @collections name)]
                c
                (let [c (case name
                          "_counters" (make-counters)
                          "event_ledger" (mock-collection {})
                          "event_ttl_overrides" (make-ttl-overrides)
                          (make-default))]
                  (swap! collections assoc name c)
                  c)))]
      #js {:collection (fn [name] (get-collection name))})))

(deftest ensure-event-id-test
  (testing "Generates event/id when not provided"
    (let [env {:event/type "test"}
          result (#'core/ensure-event-id env)]
      (is (string? (:event/id result)))
      (is (= 36 (count (:event/id result))))))

  (testing "Preserves existing event/id"
    (let [env {:event/id "existing-id" :event/type "test"}
          result (#'core/ensure-event-id env)]
      (is (= "existing-id" (:event/id result))))))

(deftest ensure-event-time-test
  (testing "Generates event/time when not provided"
    (let [env {:event/type "test"}
          result (#'core/ensure-event-time env)]
      (is (string? (:event/time result)))))

  (testing "Preserves existing event/time"
    (let [env {:event/time "2026-01-01T00:00:00Z" :event/type "test"}
          result (#'core/ensure-event-time env)]
      (is (= "2026-01-01T00:00:00Z" (:event/time result))))))

(deftest ensure-causal-root-test
  (testing "Generates causal/root when not provided"
    (let [env {:event/type "test"}
          result (#'core/ensure-causal-root env)]
      (is (string? (:causal/root result)))))

  (testing "Preserves existing causal/root"
    (let [env {:causal/root "existing-root" :event/type "test"}
          result (#'core/ensure-causal-root env)]
      (is (= "existing-root" (:causal/root result))))))

(deftest ensure-session-id-test
  (testing "Generates session/id when not provided"
    (let [env {:event/type "test"}
          result (#'core/ensure-session-id env)]
      (is (string? (:session/id result)))))

  (testing "Preserves existing session/id"
    (let [env {:session/id "existing-session" :event/type "test"}
          result (#'core/ensure-session-id env)]
      (is (= "existing-session" (:session/id result))))))

(deftest ensure-delivery-mode-test
  (testing "Defaults to tell"
    (let [env {:event/type "test"}
          result (#'core/ensure-delivery-mode env)]
      (is (= "tell" (:delivery/mode result)))))

  (testing "Preserves existing mode"
    (let [env {:delivery/mode "ask" :event/type "test"}
          result (#'core/ensure-delivery-mode env)]
      (is (= "ask" (:delivery/mode result))))))

(deftest ^:async append-event-test
  (testing "Appends a valid event"
    (let [db (mock-db)
          doc (await (core/append-event db {:event/type "user.create.request"}))]
      (is (string? (:event/id doc)))
      (is (= "user.create.request" (:event/type doc)))
      (is (number? (:ledger/seq doc)))
      (is (pos? (:ledger/seq doc)))
      (is (= "tell" (:delivery/mode doc)))
      (is (string? (:causal/root doc)))
      (is (string? (:session/id doc)))
      (is (some? (:expiresAt doc)))
      (is (some? (:createdAt doc)))
      (is (some? (:updatedAt doc)))))

  (testing "Preserves provided fields"
    (let [db (mock-db)
          doc (await (core/append-event db {:event/type "test"
                                            :event/id "custom-id"
                                            :delivery/mode "ask"
                                            :causal/root "custom-root"
                                            :session/id "custom-session"
                                            :payload {:key "value"}}))]
      (is (= "custom-id" (:event/id doc)))
      (is (= "ask" (:delivery/mode doc)))
      (is (= "custom-root" (:causal/root doc)))
      (is (= "custom-session" (:session/id doc)))
      (is (= {:key "value"} (:payload doc)))))

  (testing "Accepts JS object input"
    (let [db (mock-db)
          js-obj (js/JSON.parse "{\"event/type\":\"js.test\",\"event/id\":\"js-object-id\"}")
          doc (await (core/append-event db js-obj))]
      (is (= "js.test" (:event/type doc)))
      (is (= "js-object-id" (:event/id doc)))))

  (testing "Returns existing doc on duplicate event/id"
    (let [db (mock-db)
          _first (await (core/append-event db {:event/type "test" :event/id "dup-id"}))
          second (await (core/append-event db {:event/type "test" :event/id "dup-id"}))]
      (is (= "dup-id" (:event/id second)))))

  (testing "Rejects invalid envelope"
    (let [db (mock-db)]
      (try
        (await (core/append-event db {}))
        (is false "Should have thrown")
        (catch :default err
          (is (instance? js/Error err))
          (is (re-find #"Invalid envelope" (.-message err))))))))

(deftest ^:async append-events-test
  (testing "Appends multiple events"
    (let [db (mock-db)
          v (await (core/append-events db [{:event/type "a"} {:event/type "b"} {:event/type "c"}]))]
      (is (= 3 (count v)))
      (is (= "a" (:event/type (nth v 0))))
      (is (= "b" (:event/type (nth v 1))))
      (is (= "c" (:event/type (nth v 2)))))))
