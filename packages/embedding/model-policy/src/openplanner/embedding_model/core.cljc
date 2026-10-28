;; SPDX-License-Identifier: LGPL-3.0-or-later
(ns openplanner.embedding-model.core
  (:require [clojure.string :as str]))

;; Explicit ECMAScript trim set, shared by JVM/JS laws rather than Java's \s.
(def trim-pattern
  #"^[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+|[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+$")

(defn trimmed [value] (str/replace value trim-pattern ""))

(defn parse-mode [input]
  (cond (empty? input) :empty
        (str/starts-with? input "{") :json
        :else :pairs))

(defn pair-entries [input]
  (into [] (keep (fn [entry]
                  (let [text (trimmed entry)
                        eq (str/index-of text "=")]
                    (when (and eq (pos? eq))
                      [(subs text 0 eq) (subs text (inc eq))]))))
        (str/split input #"[;,]")))

(defn valid-entries [entries]
  (into [] (keep (fn [[key value]]
                  (when (and (string? key) (string? value))
                    (let [k (trimmed key) v (trimmed value)]
                      (when (and (seq k) (seq v)) [k v]))))) entries))

;; The boundary performs property reads lazily: later getters must not run once
;; an earlier scope resolves. Values and truthiness are native JS boundary facts.
(def scope-order [[0 "byProject"] [1 "bySource"] [2 "byKind"]])
(defn present-model? [native-truthy] (true? native-truthy))
