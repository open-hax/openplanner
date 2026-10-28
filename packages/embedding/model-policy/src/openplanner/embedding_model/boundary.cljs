;; SPDX-License-Identifier: LGPL-3.0-or-later
(ns openplanner.embedding-model.boundary
  (:require [openplanner.embedding-model.core :as law]))

(defn- object-entries [value]
  (if (and (some? value) (= "object" (goog/typeOf value)) (not (array? value)))
    (mapv (fn [entry] [(aget entry 0) (aget entry 1)]) (js/Object.entries value))
    []))

(defn- materialize [entries]
  ;; Preserve ordinary-object assignment, including inherited setters and the
  ;; legacy __proto__ string-assignment behavior. Never mutate an input object.
  (let [out #js {}]
    (doseq [[key value] entries] (aset out key value))
    out))

(defn- json-result [input]
  ;; The legacy fallback covers assignment failures too, including a throwing
  ;; inherited setter. Pair-list materialization remains outside this catch.
  (try {:ok true :value (materialize (law/valid-entries (object-entries (js/JSON.parse input))))}
       (catch :default _ {:ok false})))

(defn parse-model-map [raw]
  (if-not (js/Boolean raw)
    #js {}
    (let [input (.trim raw)
          mode (law/parse-mode input)
          parsed (when (= mode :json) (json-result input))]
      (if (:ok parsed)
        (:value parsed)
        (materialize (law/valid-entries (if (= mode :empty) [] (law/pair-entries input))))))))

(defn- norm-scope [value]
  (when-not (undefined? value)
    (let [text (.trim value)] (when (> (.-length text) 0) text))))

(defn resolve-model [^js config ^js scope]
  ;; Normalize all three before the first map read, matching the previous API's
  ;; exception and getter order even when a higher-priority model is present.
  (let [keys [(norm-scope (.-project scope))
              (norm-scope (.-source scope))
              (norm-scope (.-kind scope))]]
    (loop [slots law/scope-order]
      (if-let [[index map-name] (first slots)]
        (let [key (nth keys index)
              value (when (js/Boolean key) (aget (aget config map-name) key))]
          (if (law/present-model? (js/Boolean value)) value (recur (next slots))))
        (.-defaultModel config)))))
