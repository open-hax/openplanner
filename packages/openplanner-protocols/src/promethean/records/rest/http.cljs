(ns promethean.records.rest.http
  "Shared HTTP helpers for REST API record implementations.")

(defn- build-headers [auth-token]
  (let [headers #js {"Content-Type" "application/json"}]
    (when auth-token
      (aset headers "Authorization" (str "Bearer " auth-token)))
    headers))

(defn ^:async http-get [base-url path auth-token]
  (let [url (str base-url path)
        response (await (js/fetch url #js {:method "GET"
                                           :headers (build-headers auth-token)}))]
    (if (.-ok response)
      (await (.json response))
      (throw (js/Error. (str "HTTP " (.-status response) ": " (.-statusText response)))))))

(defn ^:async http-post [base-url path body auth-token]
  (let [url (str base-url path)
        response (await (js/fetch url #js {:method "POST"
                                           :headers (build-headers auth-token)
                                           :body (js/JSON.stringify (clj->js body))}))]
    (if (.-ok response)
      (await (.json response))
      (throw (js/Error. (str "HTTP " (.-status response) ": " (.-statusText response)))))))

(defn ^:async http-put [base-url path body auth-token]
  (let [url (str base-url path)
        response (await (js/fetch url #js {:method "PUT"
                                           :headers (build-headers auth-token)
                                           :body (js/JSON.stringify (clj->js body))}))]
    (if (.-ok response)
      (await (.json response))
      (throw (js/Error. (str "HTTP " (.-status response) ": " (.-statusText response)))))))

(defn ^:async http-delete [base-url path auth-token]
  (let [url (str base-url path)
        response (await (js/fetch url #js {:method "DELETE"
                                           :headers (build-headers auth-token)}))]
    (if (.-ok response)
      nil
      (throw (js/Error. (str "HTTP " (.-status response) ": " (.-statusText response)))))))
