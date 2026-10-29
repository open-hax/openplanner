(ns promethean.records.rest.user-management
  "REST API implementation of UserManagement protocol."
  (:require [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.http :as http]))

(defrecord RestUserManagement [base-url auth-token]
  protocols/UserManagement
  (create-user [_ user-data]
    (http/http-post base-url "/users" user-data auth-token))

  (authenticate [_ credentials]
    (http/http-post base-url "/users/login" credentials auth-token))

  (get-user [_ user-id]
    (http/http-get base-url (str "/users/" user-id) auth-token))

  (update-user [_ user-id updates]
    (http/http-put base-url (str "/users/" user-id) updates auth-token)))
