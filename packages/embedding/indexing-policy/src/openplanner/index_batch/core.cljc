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

(defn joined [current block]
  (if (seq current) (str current "\n\n" block) block))

(defn pack-flush? [current token-overflow? char-overflow?]
  (boolean (and (seq current) (or (true? token-overflow?) (true? char-overflow?)))))

(defn overlap-budget [target-chars block-chars overlap-chars]
  #?(:clj (Math/max 0.0 (Math/min (double overlap-chars) (- (double target-chars) block-chars 2)))
     :cljs (js/Math.max 0 (js/Math.min overlap-chars (- target-chars block-chars 2)))))

(defn pack-emission [current flush?] (when flush? current))

(defn pack-step [current {:keys [block candidate flush? overlap]}]
  {:emit (pack-emission current flush?)
   :current (if flush? (joined overlap block) candidate)})

;; Historical offset lookup advances using the fixed 400-character default,
;; even when the caller supplied a different packing overlap. Preserve that law.
(def offset-overlap-chars 400)
(defn offset-step [cursor start size]
  (if (neg? start)
    {:cursor cursor :offset {:charStart nil :charEnd nil}}
    (let [end (+ start size)]
      {:cursor #?(:clj (Math/max (double (inc start)) (double (- end offset-overlap-chars)))
                  :cljs (js/Math.max (inc start) (- end offset-overlap-chars)))
       :offset {:charStart start :charEnd end}})))
