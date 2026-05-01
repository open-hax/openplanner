(ns openplanner.translations.boundary
  "JavaScript boundary for translation domain logic."
  (:require [openplanner.translations.core :as core]))

(defn- js-object?
  [value]
  (and (some? value) (= "object" (goog/typeOf value)) (not (array? value))))

(defn- jget
  [obj k]
  (when (js-object? obj) (aget obj k)))

(defn- segment-from-js
  [input]
  {:source-text (or (jget input "source_text") (jget input "sourceText"))
   :translated-text (or (jget input "translated_text") (jget input "translatedText"))
   :source-lang (or (jget input "source_lang") (jget input "sourceLang"))
   :target-lang (or (jget input "target_lang") (jget input "targetLang"))
   :document-id (or (jget input "document_id") (jget input "documentId"))
   :segment-index (or (jget input "segment_index") (jget input "segmentIndex"))
   :status (jget input "status")
   :mt-model (or (jget input "mt_model") (jget input "mtModel"))
   :confidence (jget input "confidence")
   :domain (jget input "domain")
   :content-type (or (jget input "content_type") (jget input "contentType"))
   :url-context (or (jget input "url_context") (jget input "urlContext"))
   :garden-id (or (jget input "garden_id") (jget input "gardenId"))
   :org-id (or (jget input "org_id") (jget input "orgId"))
   :project (jget input "project")})

(defn- normalized-segment->js
  [segment]
  #js {:source_text (:source-text segment)
       :translated_text (:translated-text segment)
       :source_lang (:source-lang segment)
       :target_lang (:target-lang segment)
       :document_id (:document-id segment)
       :segment_index (:segment-index segment)
       :status (core/status-wire (:status segment))
       :mt_model (:mt-model segment)
       :confidence (:confidence segment)
       :domain (:domain segment)
       :content_type (:content-type segment)
       :url_context (:url-context segment)
       :garden_id (:garden-id segment)
       :org_id (:org-id segment)
       :project (:project segment)
       :errors (clj->js (core/segment-errors segment))})

(defn next-segment-status-js
  [input]
  (core/status-wire
    (core/next-segment-status {:current-status (jget input "currentStatus")
                               :overall (jget input "overall")
                               :corrected-text (or (jget input "corrected_text")
                                                   (jget input "correctedText"))})))

(defn document-overall-status-js
  [input]
  (core/status-wire
    (core/document-overall-status {:total (or (jget input "total") 0)
                                   :approved (or (jget input "approved") 0)
                                   :rejected (or (jget input "rejected") 0)
                                   :pending (or (jget input "pending") 0)})))

(defn summarize-segments-js
  [segments]
  (let [rows (if (array? segments) (array-seq segments) [])
        normalized (mapv (fn [row] {:status (jget row "status")}) rows)
        summary (core/summarize-segments normalized)]
    #js {:total_segments (:total-segments summary)
         :approved (:approved summary)
         :pending (:pending summary)
         :rejected (:rejected summary)
         :in_review (:in-review summary)
         :overall_status (core/status-wire (:overall-status summary))}))

(defn normalize-translation-segment-js
  [input]
  (normalized-segment->js (core/normalize-segment (segment-from-js input))))

(defn translation-graph-memory-plan-js
  [input]
  (let [plan (core/graph-memory-plan {:segment-id (str (or (jget input "segment_id") (jget input "segmentId") (jget input "_id") ""))
                                      :source-text (jget input "source_text")
                                      :translated-text (jget input "translated_text")
                                      :corrected-text (or (jget input "corrected_text") (jget input "correctedText"))
                                      :source-lang (jget input "source_lang")
                                      :target-lang (jget input "target_lang")
                                      :document-id (jget input "document_id")
                                      :domain (jget input "domain")
                                      :content-type (jget input "content_type")})]
    (clj->js plan)))

(defn sft-row-js
  [input]
  (clj->js (core/sft-row {:source-lang (or (jget input "source_lang") (jget input "sourceLang") "English")
                           :target-lang (or (jget input "target_lang") (jget input "targetLang"))
                           :source-text (or (jget input "source_text") (jget input "sourceText"))
                           :translated-text (or (jget input "translated_text") (jget input "translatedText"))
                           :corrected-text (or (jget input "corrected_text") (jget input "correctedText"))})))

(defn- language-row-from-js
  [row]
  {:target-lang (or (jget row "target_lang") (jget row "targetLang") (jget row "_id"))
   :total (jget row "total")
   :approved (jget row "approved")
   :rejected (jget row "rejected")
   :pending (jget row "pending")
   :in-review (or (jget row "in_review") (jget row "inReview"))})

(defn- corrections-from-js
  [value]
  (if (js-object? value)
    (into {}
          (map (fn [entry] [(aget entry 0) (aget entry 1)]))
          (array-seq (js/Object.entries value)))
    {}))

(defn- labeler-from-js
  [row]
  {:email (or (jget row "email") (jget row "_id"))
   :segments-labeled (or (jget row "segments_labeled") (jget row "segmentsLabeled"))})

(defn manifest-shape-js
  [input]
  (let [languages (if (array? (jget input "languages"))
                    (mapv language-row-from-js (array-seq (jget input "languages")))
                    [])
        labelers (if (array? (jget input "labelers"))
                   (mapv labeler-from-js (array-seq (jget input "labelers")))
                   [])]
    (clj->js (core/manifest-shape {:project (jget input "project")
                                   :languages languages
                                   :corrections-by-language (corrections-from-js (jget input "correctionsByLanguage"))
                                   :labelers labelers}))))
