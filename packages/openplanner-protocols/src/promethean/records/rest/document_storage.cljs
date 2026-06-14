(ns promethean.records.rest.document-storage
  "REST API implementation of DocumentStorage protocol."
  (:require [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.http :as http]))

(defrecord RestDocumentStorage [base-url auth-token]
  protocols/DocumentStorage
  (store-document [_ doc]
    (http/http-post base-url "/documents" doc auth-token))

  (get-document [_ doc-id]
    (http/http-get base-url (str "/documents/" doc-id) auth-token))

  (query-documents [_ query]
    (http/http-get base-url
                   (str "/documents?" (js/URLSearchParams. (clj->js query)))
                   auth-token))

  (archive-document [_ doc-id]
    (http/http-delete base-url (str "/documents/" doc-id) auth-token)))
