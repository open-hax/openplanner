;; SPDX-License-Identifier: LGPL-3.0-or-later
(ns openplanner.index-batch.core)

(def defaults {:max-batch-tokens 40000 :max-batch-items 256})
(def initial-state {:count 0 :tokens 0})
(defn ceil [x] #?(:clj (long (Math/ceil (double x))) :cljs (js/Math.ceil x)))
(defn token-estimate [{:keys [blank? chars words]}]
  (if blank? 0 (max (ceil (/ chars 4)) (ceil (* words 1.35)))))

;; Comparisons with caller-provided limits are JS boundary facts. Keeping them
;; lazy there preserves coercion, NaN/Infinity and short-circuit getter behavior.
;; This law owns the flush decision and immutable numeric batch transition.
(defn step [state {:keys [next-tokens token-overflow? item-limit?]}]
  (let [flush? (and (pos? (:count state)) (or (true? token-overflow?) (true? item-limit?)))
        base (if flush? initial-state state)]
    {:flush-before? (boolean flush?)
     :state {:count (inc (:count base)) :tokens (+ (:tokens base) next-tokens)}}))
