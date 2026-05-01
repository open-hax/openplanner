(ns openplanner.translations.core-test
  (:require [cljs.test :refer [deftest is run-tests]]
            [openplanner.translations.boundary :as boundary]))

(deftest label-overall-drives-segment-status
  (is (= "approved" (boundary/next-segment-status-js #js {:overall "approve" :currentStatus "pending"})))
  (is (= "approved" (boundary/next-segment-status-js #js {:overall "needs_edit" :corrected_text "fix"})))
  (is (= "in_review" (boundary/next-segment-status-js #js {:overall "needs_edit"})))
  (is (= "rejected" (boundary/next-segment-status-js #js {:overall "reject"}))))

(deftest document-status-is-derived-from-counts
  (is (= "fully_approved" (boundary/document-overall-status-js #js {:total 3 :approved 3})))
  (is (= "fully_rejected" (boundary/document-overall-status-js #js {:total 2 :rejected 2})))
  (is (= "pending_review" (boundary/document-overall-status-js #js {:total 2 :pending 2})))
  (is (= "partial_review" (boundary/document-overall-status-js #js {:total 2 :approved 1 :pending 1}))))

(deftest segment-normalization-reports-required-field-errors
  (let [segment (boundary/normalize-translation-segment-js #js {:source_text "hello" :target_lang "es"})]
    (is (= "hello" (aget segment "source_text")))
    (is (= "pending" (aget segment "status")))
    (is (= 2 (.-length (aget segment "errors"))))))

(deftest graph-memory-plan-is-data-only
  (let [plan (boundary/translation-graph-memory-plan-js #js {:segment_id "seg:1"
                                                            :source_text "hello world"
                                                            :translated_text "hola mundo"
                                                            :source_lang "en"
                                                            :target_lang "es"
                                                            :document_id "doc:1"
                                                            :domain "docs"})]
    (is (true? (aget plan "ok?")))
    (is (= "translation:en:es:seg:1" (aget (aget plan "node") "id")))
    (is (= "has_translation" (aget (aget plan "edge") "kind")))))

(defn -main []
  (let [result (run-tests 'openplanner.translations.core-test)]
    (when (pos? (+ (:fail result) (:error result)))
      (js/process.exit 1))))
