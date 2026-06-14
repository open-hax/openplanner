(ns promethean.records.rest.event-admission
  "REST API implementation of EventAdmission protocol.
   For external services that can't use Mongo directly."
  (:require [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.http :as http]))

(defrecord RestEventAdmission [base-url auth-token]
  protocols/EventAdmission
  (append-event! [_ envelope]
    (http/http-post base-url "/events" envelope auth-token))

  (append-events! [_ envelopes]
    (http/http-post base-url "/events/batch" {:events envelopes} auth-token))

  (query-events [_ filter-spec]
    (http/http-get base-url
                   (str "/events?" (js/URLSearchParams. (clj->js filter-spec)))
                   auth-token))

  (watch-events [_ _filter-spec _callback]
    (throw (js/Error. "watch-events not supported via REST; use Socket.IO or Mongo"))))
