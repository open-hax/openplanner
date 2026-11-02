(ns promethean.event-ledger.rest-adapter-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.event-ledger.rest-adapter :as adapter]))

(defn- mock-collection
  "Create a mock Mongo collection that tracks calls."
  [_opts]
  (let [calls (atom [])
        inserted (atom nil)]
    #js {:insertOne (fn [doc]
                       (swap! calls conj {:method :insertOne :doc (js->clj doc :keywordize-keys true)})
                       (reset! inserted doc)
                       (js/Promise.resolve #js {}))
         :findOne (fn [query]
                    (swap! calls conj {:method :findOne :query (js->clj query :keywordize-keys true)})
                    (js/Promise.resolve #js {}))
         :calls calls
         :inserted inserted}))

(defn- mock-db
  "Create a mock Mongo db."
  []
  (let [seq-counter (atom 0)
        collections (atom {})]
    (letfn [(make-counters []
              #js {:findOneAndUpdate (fn [_query _update _opts]
                                      (swap! seq-counter inc)
                                      (js/Promise.resolve #js {:value #js {:seq @seq-counter}}))})
            (make-ledger []
              (mock-collection {}))
            (make-ttl-overrides []
              #js {:find (fn [_]
                           #js {:toArray (fn [] (js/Promise.resolve #js []))})})
            (make-default []
              #js {:insertOne (fn [_] (js/Promise.resolve #js {}))
                   :findOne (fn [_] (js/Promise.resolve #js {}))})
            (get-collection [name]
              (if-let [c (get @collections name)]
                c
                (let [c (case name
                          "_counters" (make-counters)
                          "event_ledger" (make-ledger)
                          "event_ttl_overrides" (make-ttl-overrides)
                          (make-default))]
                  (swap! collections assoc name c)
                  c)))]
      #js {:collection (fn [name] (get-collection name))})))

(deftest rest-event->envelope-map-test
  (testing "Maps CLJS map to ledger envelope"
    (let [rest-event {:kind "user.create.request"
                      :source "web-client"
                      :ts "2026-01-01T00:00:00Z"
                      :id "rest-123"
                      :source_ref {:project "my-project"
                                   :session "sess-456"}
                      :text "Hello world"
                      :extra {:custom_field "value"}
                      :meta {:role "admin"}}
          envelope (adapter/rest-event->envelope rest-event)]
      (is (= "user.create.request" (:event/type envelope)))
      (is (= {:actor-id "web-client" :actor-kind "web-client"} (:event/from envelope)))
      (is (= "2026-01-01T00:00:00Z" (:event/time envelope)))
      (is (= "rest-123" (:event/id envelope)))
      (is (= "sess-456" (:session/id envelope)))
      (is (= "Hello world" (get-in envelope [:payload :text])))
      (is (= "my-project" (get-in envelope [:payload :project])))
      (is (= "value" (get-in envelope [:payload :custom_field])))
      (is (= {:role "admin"} (get-in envelope [:payload :meta]))))))

(deftest rest-event->envelope-js-test
  (testing "Maps JS object to ledger envelope"
    (let [rest-event (js/JSON.parse "{\"kind\":\"graph.node\",\"source\":\"cli\",\"ts\":\"2026-06-05T00:00:00Z\",\"id\":\"js-event-1\",\"text\":\"some text\"}")
          envelope (adapter/rest-event->envelope rest-event)]
      (is (= "graph.node" (:event/type envelope)))
      (is (= {:actor-id "cli" :actor-kind "cli"} (:event/from envelope)))
      (is (= "2026-06-05T00:00:00Z" (:event/time envelope)))
      (is (= "js-event-1" (:event/id envelope)))
      (is (= "some text" (get-in envelope [:payload :text]))))))

(deftest rest-event->envelope-minimal-test
  (testing "Handles minimal event with only required fields"
    (let [rest-event {:kind "test.event"}
          envelope (adapter/rest-event->envelope rest-event)]
      (is (= "test.event" (:event/type envelope)))
      (is (nil? (:event/time envelope)))
      (is (nil? (:event/id envelope)))
      (is (map? (:event/from envelope)))
      (is (map? (:payload envelope))))))

(deftest ^:async append-rest-event-test
  (testing "Appends a single REST event and returns compatible response"
    (let [db (mock-db)
          rest-event {:kind "user.login.request"
                      :source "auth-service"
                      :ts "2026-06-05T12:00:00Z"
                      :id "login-001"
                      :text "User logged in"}
          ^js result (await (adapter/append-rest-event db rest-event))]
      (is (true? (.-ok result)))
      (is (= 1 (.-count result)))
      (is (= "login-001" (aget (.-ids result) 0)))
      (is (= "event-ledger" (.-storageBackend result)))
      (is (number? (aget (.-ledgerSeqs result) 0)))))

  (testing "Returns error response on invalid envelope"
    (let [db (mock-db)
          ^js result (await (adapter/append-rest-event db {}))]
      (is (false? (.-ok result)))
      (is (some? (.-error result)))
      (is (= 0 (.-count result))))))

(deftest ^:async append-rest-events-test
  (testing "Appends multiple events"
    (let [db (mock-db)
          events #js [#js {:kind "a" :source "s1" :id "e1"}
                      #js {:kind "b" :source "s2" :id "e2"}
                      #js {:kind "c" :source "s3" :id "e3"}]
          ^js result (await (adapter/append-rest-events db events))]
      (is (true? (.-ok result)))
      (is (= 3 (.-count result)))
      (is (= 3 (count (.-ids result))))
      (is (= 3 (count (.-ledgerSeqs result))))))

  (testing "Handles empty input"
    (let [db (mock-db)
          ^js result (await (adapter/append-rest-events db #js []))]
      (is (true? (.-ok result)))
      (is (= 0 (.-count result)))
      (is (= 0 (count (.-ids result)))))))
