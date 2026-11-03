(ns lossless-json)

;; Re-encode JSON-shaped Clojure values with own enumerable properties, even
;; for keys such as "__proto__". BSON dates and other foreign values pass through.
(defn encode [value]
  (cond
    (map? value) (let [obj (js-obj)]
                   (doseq [[k v] value]
                     (js/Object.defineProperty obj (if (keyword? k) (name k) (str k))
                                               #js {:value (encode v) :enumerable true :writable true :configurable true}))
                   obj)
    (sequential? value) (to-array (map encode value))
    :else value))

(defn copy-enumerables [& sources]
  (let [target (js-obj)]
    (doseq [source sources :when (some? source)
            key (vec (js/Object.keys source))]
      (js/Object.defineProperty target key #js {:value (aget source key) :enumerable true :writable true :configurable true}))
    target))
