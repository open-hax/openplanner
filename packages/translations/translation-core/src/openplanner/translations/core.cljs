(ns openplanner.translations.core
  "Pure translation domain logic for OpenPlanner.

  This namespace owns business decisions only: status transitions, document
  aggregate status, segment normalization, and graph-memory upsert plans. Routes
  remain responsible for HTTP, Mongo, and timestamps."
  (:require [clojure.string :as str]))

(def segment-statuses #{:pending :in-review :approved :rejected})
(def label-overalls #{:approve :needs-edit :reject})

(defn token
  [value]
  (some-> value str str/trim str/lower-case (str/replace #"_" "-") keyword))

(defn status-wire
  [status]
  (some-> status name (str/replace #"-" "_")))

(defn nonblank-string
  [value]
  (let [s (some-> value str str/trim)]
    (when-not (str/blank? s) s)))

(defn next-segment-status
  [{:keys [current-status overall corrected-text]}]
  (let [overall (token overall)
        current-status (or (token current-status) :pending)]
    (case overall
      :approve :approved
      :needs-edit (if (nonblank-string corrected-text) :approved :in-review)
      :reject :rejected
      current-status)))

(defn document-overall-status
  [{:keys [total approved rejected pending]}]
  (cond
    (and (pos? total) (= approved total)) :fully-approved
    (and (pos? total) (= rejected total)) :fully-rejected
    (and (pos? total) (= pending total)) :pending-review
    (pos? pending) :partial-review
    :else :mixed))

(defn summarize-segments
  [segments]
  (let [counts (frequencies (map #(token (:status %)) segments))
        total (count segments)
        approved (get counts :approved 0)
        pending (get counts :pending 0)
        rejected (get counts :rejected 0)
        in-review (get counts :in-review 0)]
    {:total-segments total
     :approved approved
     :pending pending
     :rejected rejected
     :in-review in-review
     :overall-status (document-overall-status {:total total
                                               :approved approved
                                               :pending pending
                                               :rejected rejected})}))

(defn normalize-segment
  [{:keys [source-text translated-text source-lang target-lang document-id segment-index status mt-model confidence domain content-type url-context garden-id org-id project]}]
  {:source-text (or (nonblank-string source-text) "")
   :translated-text (or (nonblank-string translated-text) "")
   :source-lang (or (nonblank-string source-lang) "en")
   :target-lang (or (nonblank-string target-lang) "")
   :document-id (or (nonblank-string document-id) "")
   :segment-index (long (or segment-index 0))
   :status (if (contains? segment-statuses (token status)) (token status) :pending)
   :mt-model (nonblank-string mt-model)
   :confidence (when (some? confidence)
                 (let [n (js/Number confidence)]
                   (when (js/Number.isFinite n) n)))
   :domain (nonblank-string domain)
   :content-type (nonblank-string content-type)
   :url-context (nonblank-string url-context)
   :garden-id (nonblank-string garden-id)
   :org-id (nonblank-string org-id)
   :project (nonblank-string project)})

(defn segment-errors
  [{:keys [source-text translated-text target-lang document-id]}]
  (cond-> []
    (str/blank? source-text) (conj {:path [:source-text] :error :required})
    (str/blank? translated-text) (conj {:path [:translated-text] :error :required})
    (str/blank? target-lang) (conj {:path [:target-lang] :error :required})
    (str/blank? document-id) (conj {:path [:document-id] :error :required})))

(defn graph-memory-plan
  [{:keys [segment-id source-text translated-text corrected-text source-lang target-lang document-id domain content-type]}]
  (let [target-text (or (nonblank-string corrected-text) translated-text)
        node-id (str "translation:" source-lang ":" target-lang ":" segment-id)]
    (if (and (nonblank-string source-text) (nonblank-string target-text))
      {:ok? true
       :node {:id node-id
              :kind "translation_example"
              :label (str source-lang "→" target-lang ": " (subs source-text 0 (min 50 (count source-text))) "...")
              :data {:source_text source-text
                     :target_text target-text
                     :source_lang source-lang
                     :target_lang target-lang
                     :document_id document-id
                     :domain domain
                     :content_type content-type
                     :quality "approved"
                     :segment_id segment-id}}
       :edge {:id (str "translation:doc:" document-id ":" segment-id)
              :source document-id
              :target node-id
              :kind "has_translation"
              :data {:source_lang source-lang
                     :target_lang target-lang}}}
      {:ok? false :error "Missing source or target text"})))
