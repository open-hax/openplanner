(ns promethean.records.mongo.realtime-subscription-test
  (:require [cljs.test :refer [deftest is testing]]
            [promethean.openplanner-protocols :as protocols]
            [promethean.records.mongo.realtime-subscription :as rs]))

(deftest subscribe-test
  (testing "Subscribes to a room/event and returns handle with close"
    (let [mgr (rs/create-subscription-manager)
          received (atom nil)
          handle (protocols/subscribe mgr "room-1" "update" (fn [data] (reset! received data)))]
      (is (some? (:id handle)))
      (is (fn? (:close handle)))
      (protocols/emit-to-room mgr "room-1" "update" {:x 1})
      (is (= {:x 1} @received)))))

(deftest unsubscribe-test
  (testing "Unsubscribes stops receiving events"
    (let [mgr (rs/create-subscription-manager)
          received (atom nil)
          handle (protocols/subscribe mgr "room-1" "update" (fn [data] (reset! received data)))]
      (protocols/unsubscribe mgr handle)
      (protocols/emit-to-room mgr "room-1" "update" {:x 1})
      (is (nil? @received)))))

(deftest close-handle-test
  (testing "Close function on handle unsubscribes"
    (let [mgr (rs/create-subscription-manager)
          received (atom nil)
          handle (protocols/subscribe mgr "room-1" "update" (fn [data] (reset! received data)))]
      ((:close handle))
      (protocols/emit-to-room mgr "room-1" "update" {:x 1})
      (is (nil? @received)))))

(deftest emit-only-matching-room-test
  (testing "Events only go to matching rooms"
    (let [mgr (rs/create-subscription-manager)
          received-a (atom nil)
          received-b (atom nil)]
      (protocols/subscribe mgr "room-a" "update" (fn [data] (reset! received-a data)))
      (protocols/subscribe mgr "room-b" "update" (fn [data] (reset! received-b data)))
      (protocols/emit-to-room mgr "room-a" "update" {:target "a"})
      (is (= {:target "a"} @received-a))
      (is (nil? @received-b)))))

(deftest emit-only-matching-event-type-test
  (testing "Events only go to matching event types"
    (let [mgr (rs/create-subscription-manager)
          received-update (atom nil)
          received-delete (atom nil)]
      (protocols/subscribe mgr "room-1" "update" (fn [data] (reset! received-update data)))
      (protocols/subscribe mgr "room-1" "delete" (fn [data] (reset! received-delete data)))
      (protocols/emit-to-room mgr "room-1" "update" {:action "updated"})
      (is (= {:action "updated"} @received-update))
      (is (nil? @received-delete)))))
