(ns promethean.event-ledger.ttl-config-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.event-ledger.ttl-config :as ttl]))

(defn- make-cursor
  "Create a mock cursor with .toArray method."
  [docs]
  #js {:toArray (fn [] (js/Promise.resolve (clj->js docs)))})

(defn- make-override-collection
  "Create a mock collection with TTL overrides."
  [overrides]
  #js {:find (fn [_query] (make-cursor overrides))})

(defn- make-db
  "Create a mock db with given TTL overrides."
  [overrides]
  (let [colls (atom {"event_ttl_overrides" (make-override-collection overrides)})]
    #js {:collection (fn [name]
                       (or (get @colls name)
                           #js {:find (fn [_] (make-cursor []))}))}))

(deftest ^:async resolve-ttl-default-test
  (testing "Returns default TTL when no overrides exist"
    (let [db (make-db [])
          ttl-days (await (ttl/resolve-ttl db "user.create.request"))]
      (is (= 30 ttl-days)))))

(deftest ^:async resolve-ttl-override-match-test
  (testing "Returns override TTL when prefix matches"
    (let [db (make-db [{:prefixes ["user."] :ttl-days 90}
                       {:prefixes ["audit."] :ttl-days 365}])
          user-ttl (await (ttl/resolve-ttl db "user.create.request"))
          audit-ttl (await (ttl/resolve-ttl db "audit.login.success"))]
      (is (= 90 user-ttl))
      (is (= 365 audit-ttl)))))

(deftest ^:async resolve-ttl-override-no-match-test
  (testing "Returns default when no prefix matches"
    (let [db (make-db [{:prefixes ["user."] :ttl-days 90}])
          ttl-days (await (ttl/resolve-ttl db "session.started"))]
      (is (= 30 ttl-days)))))

(deftest ^:async resolve-ttl-nil-type-test
  (testing "Returns default for nil event type"
    (let [db (make-db [{:prefixes ["user."] :ttl-days 90}])
          ttl-days (await (ttl/resolve-ttl db nil))]
      (is (= 30 ttl-days)))))

(deftest ^:async resolve-ttl-session-override-test
  (testing "session.* events get 7 day TTL"
    (let [db (make-db [{:prefixes ["session."] :ttl-days 7}])
          ttl-days (await (ttl/resolve-ttl db "session.started"))]
      (is (= 7 ttl-days)))))

(deftest ^:async resolve-ttl-batch-test
  (testing "Batch resolves multiple event types in one DB read"
    (let [db (make-db [{:prefixes ["user."] :ttl-days 90}
                       {:prefixes ["session."] :ttl-days 7}])
          result (await (ttl/resolve-ttl-batch db ["user.create" "session.start" "audit.log"]))]
      (is (= 90 (get result "user.create")))
      (is (= 7 (get result "session.start")))
      (is (= 30 (get result "audit.log"))))))

(deftest ^:async resolve-ttl-first-match-wins-test
  (testing "First matching prefix wins"
    (let [db (make-db [{:prefixes ["user."] :ttl-days 90}
                       {:prefixes ["user.admin."] :ttl-days 365}])
          ttl-days (await (ttl/resolve-ttl db "user.admin.create"))]
      (is (= 90 ttl-days)))))
