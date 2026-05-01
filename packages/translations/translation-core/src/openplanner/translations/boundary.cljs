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
