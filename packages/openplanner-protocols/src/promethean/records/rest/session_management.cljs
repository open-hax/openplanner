(ns promethean.records.rest.session-management
  "REST API implementation of SessionManagement protocol."
  (:require [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.http :as http]))

(defrecord RestSessionManagement [base-url auth-token]
  protocols/SessionManagement
  (create-session [_ opts]
    (http/http-post base-url "/sessions" opts auth-token))

  (get-session [_ session-id]
    (http/http-get base-url (str "/sessions/" session-id) auth-token))

  (update-session [_ session-id updates]
    (http/http-put base-url (str "/sessions/" session-id) updates auth-token))

  (close-session [_ session-id]
    (http/http-delete base-url (str "/sessions/" session-id) auth-token)))
