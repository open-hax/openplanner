(ns promethean.records.socket-io.event-admission
  "Socket.IO implementation of EventAdmission protocol.
   Emits events to a Socket.IO namespace and listens for responses."
  (:require [promethean.openplanner-protocols :as protocols]))

(defn ^:async emit-and-await [socket event-type payload timeout-ms]
  (let [causal-root (str (random-uuid))
        timeout (or timeout-ms 30000)
        envelope (assoc payload
                        :event/id (str (random-uuid))
                        :event/time (.toISOString (js/Date.))
                        :causal/root causal-root)]
    (js/Promise.
      (fn [resolve reject]
        (let [state (atom {:timer nil :handler nil})
              handler (fn [response]
                        (js/clearTimeout (:timer @state))
                        (.off socket (str "response:" causal-root) (:handler @state))
                        (resolve response))
              timer (js/setTimeout
                      (fn []
                        (.off socket (str "response:" causal-root) (:handler @state))
                        (reject (js/Error. (str "Socket.IO timeout after " timeout "ms"))))
                      timeout)]
          (swap! state assoc :timer timer :handler handler)
          (.on socket (str "response:" causal-root) handler)
          (.emit socket event-type envelope))))))

(defrecord SocketIoEventAdmission [socket]
  protocols/EventAdmission
  (append-event! [_ envelope]
    (emit-and-await socket "event:append" envelope nil))

  (append-events! [_ envelopes]
    (emit-and-await socket "event:append:batch" {:events envelopes} nil))

  (query-events [_ filter-spec]
    (emit-and-await socket "event:query" filter-spec nil))

  (watch-events [_ filter-spec callback]
    (let [id (str (random-uuid))]
      (.on socket "event:watch" (fn [event] (callback (js->clj event :keywordize-keys true))))
      (.emit socket "event:watch:subscribe" (clj->js filter-spec))
      {:id id
       :close! (fn [] (.off socket "event:watch" callback))})))
