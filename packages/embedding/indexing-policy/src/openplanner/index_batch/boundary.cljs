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
