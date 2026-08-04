(ns promethean.records.rest.label-management
  "REST API implementation of LabelManagement protocol."
  (:require [promethean.openplanner-protocols :as protocols]
            [promethean.records.rest.http :as http]))

(defrecord RestLabelManagement [base-url auth-token]
  protocols/LabelManagement
  (create-label [_ label]
    (http/http-post base-url "/labels" label auth-token))

  (apply-label [_ label-id target-id target-type]
    (http/http-post base-url (str "/labels/" label-id "/apply")
                    {:targetId target-id :targetType target-type}
                    auth-token))

  (query-by-label [_ label-id opts]
    (http/http-get base-url
                   (str "/labels/" label-id "/targets"
                        (when-let [params (clj->js opts)]
                          (str "?" (js/URLSearchParams. params))))
                   auth-token)))
