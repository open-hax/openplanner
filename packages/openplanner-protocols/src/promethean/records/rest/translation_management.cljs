(ns promethean.records.rest.translation-management
  "REST API implementation of TranslationManagement protocol."
  (:require [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.http :as http]))

(defrecord RestTranslationManagement [base-url auth-token]
  protocols/TranslationManagement
  (create-translation [_ translation]
    (http/http-post base-url "/translations" translation auth-token))

  (label-translation [_ segment-id label]
    (http/http-put base-url (str "/translations/" segment-id "/label") {:label label} auth-token))

  (batch-translate [_ batch]
    (http/http-post base-url "/translations/batch" {:segments batch} auth-token)))
