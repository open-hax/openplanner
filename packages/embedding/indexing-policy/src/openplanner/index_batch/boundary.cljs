;; SPDX-License-Identifier: LGPL-3.0-or-later
(ns openplanner.index-batch.boundary
  (:require [openplanner.index-batch.core :as law]))

(defn estimate-tokens [input]
  (let [text (js/String (if (js/Boolean input) input ""))
        blank? (zero? (.-length (.trim text)))]
    (law/token-estimate {:blank? blank? :chars (.-length text)
                         :words (if blank? 0 (count (.match text (js* "/\\S+/g"))))})))

;; A generic foreign iterator primitive keeps JS IteratorClose/error ordering
;; and streams without an intermediate Array.from allocation. No policy lives
;; in this loop; each callback obtains its immutable transition from the law.
(def consume-native
  (js* "(function (input, visit) { for (const entry of input) visit(entry); })"))

(defn- nullish-default [value fallback] (if (some? value) value fallback))

(defn batch-chunks [chunks ^js opts]
  (let [tokens (nullish-default (when (some? opts) (.-maxBatchTokens opts))
                                (:max-batch-tokens law/defaults))
        items (nullish-default (when (some? opts) (.-maxBatchItems opts))
                               (:max-batch-items law/defaults))
        state (volatile! law/initial-state)
        current (volatile! #js [])
        batches #js []]
    (consume-native
      chunks
      (fn [^js chunk]
        (let [next-tokens (estimate-tokens (.-text chunk))
              nonempty? (pos? (:count @state))
              token-overflow? (and nonempty? (> (+ (:tokens @state) next-tokens) tokens))
              item-limit? (and nonempty? (not token-overflow?) (>= (:count @state) items))
              plan (law/step @state {:next-tokens next-tokens :token-overflow? token-overflow?
                                     :item-limit? item-limit?})]
          (when (:flush-before? plan)
            (.push batches @current)
            (vreset! current #js []))
          (.push @current chunk)
          (vreset! state (:state plan))
          nil)))
    (when (pos? (:count @state)) (.push batches @current))
    batches))

(defn pack-blocks [blocks target-tokens target-chars overlap-chars]
  (let [current (volatile! "") output #js []]
    (consume-native
      blocks
      (fn [block]
        (let [candidate (law/joined @current block)
              nonempty? (js/Boolean @current)
              tokens-over? (and nonempty? (> (estimate-tokens candidate) target-tokens))
              chars-over? (and nonempty? (not tokens-over?) (> (.-length candidate) target-chars))
              flush? (law/pack-flush? @current tokens-over? chars-over?)
              emission (law/pack-emission @current flush?)]
          ;; Preserve the parent effect order: trim/push before limit coercion.
          (when (some? emission) (.push output (.trim emission)))
          (let [budget (when flush? (law/overlap-budget target-chars (.-length block) overlap-chars))
                overlap (if (and flush? (> budget 0)) (.trim (.slice @current (- budget))) "")
                plan (law/pack-step @current {:block block :candidate candidate :flush? flush? :overlap overlap})]
            (vreset! current (:current plan))))))
    (when (pos? (.-length (.trim @current))) (.push output (.trim @current)))
    (.filter output js/Boolean)))

(defn locate-offsets [text chunks]
  (let [cursor (volatile! 0)]
    (.map chunks
          (fn [chunk]
            (let [found (.indexOf text chunk @cursor)
                  start (if (< found 0) (.indexOf text chunk) found)
                  plan (law/offset-step @cursor start (if (< start 0) 0 (.-length chunk)))]
              (vreset! cursor (:cursor plan))
              (let [offset (:offset plan)]
                #js {:charStart (:charStart offset) :charEnd (:charEnd offset)}))))))
