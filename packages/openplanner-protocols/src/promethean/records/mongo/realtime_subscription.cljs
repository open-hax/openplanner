(ns promethean.records.mongo.realtime-subscription
  "In-memory implementation of RealtimeSubscription protocol.
   Uses an atom to track subscriptions; Socket.IO integration plugs in later."
  (:require [promethean.openplanner-protocols :as protocols]))

(defrecord InMemoryRealtimeSubscription [subscriptions]
  protocols/RealtimeSubscription
  (subscribe [_ room event-type callback]
    (let [id (str (random-uuid))
          entry {:id id :room room :event-type event-type :callback callback}]
      (swap! subscriptions assoc id entry)
      {:id id
       :close (fn []
                (swap! subscriptions dissoc id))}))

  (unsubscribe [_ handle]
    (swap! subscriptions dissoc (:id handle)))

  (emit-to-room [_ room event-type data]
    (let [matching (filter (fn [[_ v]]
                             (and (= (:room v) room)
                                  (= (:event-type v) event-type)))
                           @subscriptions)]
      (doseq [[_ {:keys [callback]}] matching]
        (callback data)))))

(defn create-subscription-manager
  "Create an in-memory realtime subscription manager."
  []
  (->InMemoryRealtimeSubscription (atom {})))
