(ns event-externs (:require [mongo-projection :as mp] [clojure.string :as str] [lossless-json :as lj] [boundary-values :as bv]))

;; The only foreign boundaries used by the experimental slice.
(defn admission! [admission ev]
  (let [sr (or (.-source_ref ev) #js {}) meta (or (.-meta ev) #js {})
        norm #(if (nil? %) nil (js/String %)) nullish #(if (nil? %1) %2 %1)]
    (.appendEvent admission #js {:id (.-id ev) :ts (js/Date. (.-ts ev)) :source (.-source ev) :kind (.-kind ev)
                                :project (norm (.-project sr)) :session (norm (.-session sr)) :message (norm (.-message sr))
                                :role (norm (.-role meta)) :author (norm (.-author meta)) :model (norm (.-model meta))
                                :tags (nullish (.-tags meta) nil) :text (norm (nullish (.-text ev) "")) :attachments (nullish (.-attachments ev) nil)
                                :extra (nullish (.-extra ev) nil) :schema_version (.-schema_version ev) :migration_state (.-migration_state ev)})))
(defn prior! [app channel ts]
  (-> (.findOne (.. app -mongo -events) #js {:kind "discord.message" :extra.channel_id channel :ts #js {:$lt ts}} #js {:sort #js {:ts -1} :projection #js {:id 1}})
      (.then #(when % (.-id %)))
      (.catch (fn [_] nil))))
(defn- batches! [collection ops]
  (reduce (fn [p batch] (.then p (fn [] (.bulkWrite collection (lj/encode batch) #js {:ordered false})))) (js/Promise.resolve) (partition-all 1000 ops)))
(defn writes! [app nodes labels edges now]
  (-> (batches! (.. app -mongo -events) (mapv #(mp/node-op % now) nodes))
      (.then #(batches! (.. app -mongo -graphLabelNodes) labels))
      (.then (fn [] (if (seq edges) (.bulkWrite (.. app -mongo -graphEdges) (lj/encode (mp/edge-ops edges (js/Date.))) #js {:ordered false}) (js/Promise.resolve))))))
(defn metrics! [counter events]
  (counter "openplanner_events_ingested_total" #js {:backend "mongodb"} (count events))
  (doseq [ctx events :let [ev ((:raw-event ctx))]]
    (counter "openplanner_events_by_source" #js {:source (.-source ev) :backend "mongodb"})
    (counter "openplanner_events_by_kind" #js {:kind (.-kind ev) :backend "mongodb"})))
(defn kafka! [app req events]
  (let [p (.publishRawEvents (.-kafkaEvents app) (to-array (map #((:raw-event %)) events)) #js {:requestId (.-id req)})]
    (if (= "await" (.-OPENPLANNER_KAFKA_PUBLISH_MODE js/process.env)) p
        (do (.catch p (fn [err] (.warn (.-log app) #js {:err err :count (count events)} "Detached kafka raw event publish rejected"))) (js/Promise.resolve)))))

(defn passage-text [value]
  (let [text (.trim (js/String (or value "")))
        expand #(str/replace % "\\n" "\n")
        template (.trim (expand (js/String (or (.-EMBED_PASSAGE_TEMPLATE js/process.env) ""))))
        prefix (expand (js/String (or (.-EMBED_PASSAGE_PREFIX js/process.env) "")))]
    (cond (empty? text) "" (seq template) (str/replace template "{text}" text) (seq prefix) (str prefix text) :else text)))
(defn- timeout [promise ms label]
  (let [timer (atom nil) timeout-promise (js/Promise. (fn [_ reject] (reset! timer (js/setTimeout #(reject (js/Error. (str label " timed out after " ms "ms"))) ms))))]
    (.finally (js/Promise.race #js [promise timeout-promise]) #(js/clearTimeout @timer))))
(defn- embedding-ops [rows now]
  (mapv (fn [r]
          {:updateOne {:filter {:_id (str (bv/js-string (:node_id r)) "::" (:embedding_model r) "::" (:embedding_dimensions r) "::0")}
                       :update {:$set (assoc (select-keys r [:node_id :source_event_id :project :embedding_model :embedding_dimensions :embedding :chunk_count :text :updated_at]) :chunk_index 0 :updatedAt now)
                                :$setOnInsert {:createdAt now}} :upsert true}}) rows))
(defn- embed-group! [hot collection model rows]
  (let [generator (.getBackgroundEmbeddingFunctionForModel hot model) ids (mapv :node_id rows)]
    (-> (.. collection (find (clj->js {:node_id {:$in ids} :embedding_model model})) (project #js {:node_id 1 :text 1}) (toArray))
        (.then (fn [existing]
                 (let [previous (into {} (map (fn [r] [(js/String (.-node_id r)) (js/String (or (.-text r) ""))]) (vec existing)))
                       pending (filterv #(not= (:text %) (get previous (:node_id %))) rows)]
                   (when (seq pending)
                     (-> (timeout (.generate generator (clj->js (mapv :text pending))) 30000 (str "graph node embedding batch " model))
                         (.then (fn [vectors]
                                  (let [now (js/Date.) stored (keep-indexed (fn [i row]
                                                                             (let [v (aget vectors i)]
                                                                               (when (and (js/Array.isArray v) (pos? (.-length v)))
                                                                                 (assoc row :embedding_model model :embedding_dimensions (.-length v) :embedding (js->clj v) :updated_at now)))) pending)]
                                    (when (seq stored) (.bulkWrite collection (clj->js (embedding-ops stored now)) #js {:ordered false})))))))))))))
(defn start-graph-embeddings! [app inputs]
  ;; Begin model selection and the first Mongo lookup before metrics/Kafka,
  ;; then leave the rest detached, as the reference async IIFE does.
  (when (seq inputs)
    (let [hot (.. app -embeddingRuntime -hot) collection (.. app -mongo -graphNodeEmbeddings)]
      (try
        (let [order (atom []) groups (reduce (fn [m row] (let [model (.getModel hot (clj->js {:source "graph-event" :kind "graph.node" :project (:project row)}))]
                                           (when-not (contains? m model) (swap! order conj model))
                                           (update m model (fnil conj []) row))) {} inputs)
              run (fn run [entries]
                    (if-let [[model rows] (first entries)]
                      (.then (embed-group! hot collection model rows) #(run (rest entries)))
                      (js/Promise.resolve)))]
          (.catch (run (mapv (fn [model] [model (get groups model)]) @order)) (fn [err] (.warn (.-log app) #js {:err err :count (count inputs)} "Failed to materialize graph node embeddings during event ingest"))))
        (catch :default err (.warn (.-log app) #js {:err err :count (count inputs)} "Failed to materialize graph node embeddings during event ingest"))))))

(defn start-event-vector! [app indexer ev]
  ;; Invoke the existing indexing boundary immediately; its promise is detached.
  (let [sr (or (.-source_ref ev) #js {}) meta (or (.-meta ev) #js {}) extra (or (.-extra ev) #js {})
        hot (.. app -embeddingRuntime -hot) project (when-not (nil? (.-project sr)) (js/String (.-project sr)))
        label-spec (.-openplanner_labels extra) raw-labels (when label-spec (.-labels label-spec))
        label-values (if (js/Array.isArray raw-labels) (->> (vec raw-labels) (map #(if (nil? %) "" (.trim (js/String %)))) (remove empty?) distinct vec) [])
        quality (if (or (nil? label-spec) (nil? (.-quality label-spec))) "" (.-quality label-spec))
        scope #js {:source (.-source ev) :kind (.-kind ev) :project project}]
    (try
      (let [embedding (.getBackgroundEmbeddingFunction hot scope) model (.getModel hot scope)
            metadata #js {:ts (.-ts ev) :source (.-source ev) :kind (.-kind ev) :project (.-project sr) :session (.-session sr)
                          :author (if (nil? (.-author meta)) "" (js/String (.-author meta))) :role (if (nil? (.-role meta)) "" (js/String (.-role meta)))
                          :model (if (nil? (.-model meta)) "" (js/String (.-model meta))) :embedding_model (or model "")
                          :search_tier "hot" :visibility (if (nil? (.-visibility extra)) "internal" (.-visibility extra))
                          :quality_label quality :labels (to-array label-values) :title (if (nil? (.-title extra)) (if (nil? (.-message sr)) (.-id ev) (.-message sr)) (.-title extra))}
            p (indexer #js {:mongo (.-mongo app) :tier "hot" :parentId (.-id ev) :text (.-text ev) :extra extra :metadata metadata :embeddingFunction embedding})]
        (.catch (timeout p 30000 (str "event vector index " (.-id ev)))
                (fn [err] (.warn (.-log app) #js {:err err :eventId (.-id ev)} "Failed to index event into MongoDB vectors; preserving base event without embeddings"))))
      (catch :default err (.warn (.-log app) #js {:err err :eventId (.-id ev)} "Failed to index event into MongoDB vectors; preserving base event without embeddings") (js/Promise.resolve)))))

(defn prepare-document [prepare split-sentences node-id body extra]
  (let [prepared (prepare (lj/encode {:parentId node-id :text body :extra extra :forceChunking false :targetChunkTokens 1000 :targetChunkChars 4000 :overlapChars 100}))
        chunks (js->clj (.-chunks prepared) :keywordize-keys true)
        sources (if (<= (.-chunkCount prepared) 1) [(.-normalizedText prepared)] (mapv :text chunks))
        sentences (->> sources (mapcat #(js->clj (split-sentences %) :keywordize-keys true)) (filter #(> (:tokens %) 3)))]
    {:normalized-text (.-normalizedText prepared) :chunk-count (.-chunkCount prepared) :chunks chunks :sentences (:rows (reduce (fn [state s] (if (contains? (:seen state) (:hash s)) state (-> state (update :seen conj (:hash s)) (update :rows conj s)))) {:seen #{} :rows []} sentences))}))

(defn js-string [x] (js/String (if (or (map? x) (vector? x)) (clj->js x) x)))
(defn nullish [x fallback] (if (nil? x) fallback x))
(defn normalize-event [ev]
  ;; Domain decisions use known keyword fields; JSON metadata is independently
  ;; normalized with string keys, including JS object-spread enumeration.
  (let [known (js->clj ev :keywordize-keys true) sr (.-source_ref ev) raw-extra (.-extra ev)
        event-id (js->clj (.-id ev)) event-kind (js->clj (.-kind ev))
        id-identity (if (or (map? event-id) (vector? event-id)) (random-uuid) event-id)
        project (when (and sr (not (nil? (.-project sr)))) (js/String (.-project sr)))
        raw-atts (when raw-extra (.-attachments raw-extra))
        attachment-json (when (js/Array.isArray raw-atts) (mapv #(js/JSON.stringify %) (vec raw-atts)))
        domain-extra (if (map? (:extra known)) (:extra known) {})
        domain-meta (if (map? (:meta known)) (:meta known) {})
        domain-sr (if (map? (:source_ref known)) (:source_ref known) {})]
    (-> known (assoc :id event-id :kind event-kind :id-identity id-identity :extra domain-extra :meta domain-meta :source_ref (assoc domain-sr :project project))
        (assoc :foreign-extra (if (nil? raw-extra) {} (js->clj raw-extra))
               :spread-extra (js->clj (lj/copy-enumerables raw-extra))
               :attachment-json attachment-json
               :foreign-kind (js->clj (.-kind ev))
               :foreign-text (when-not (nil? (.-text ev)) (js->clj (.-text ev)))
               :foreign-source-ref (when sr (js->clj sr))))))

(defn resolved [] (js/Promise.resolve))
(defn then [promise f] (.then promise f))
(defn bad-body! [reply] (.send (.status reply 400) #js {:error "expected { events: [...] }"}))
(defn response [value] (lj/encode value))
(defn- validate-raw! [ev]
  (doseq [[ok msg] [[(and ev (= "openplanner.event.v1" (.-schema ev))) "event.schema must be openplanner.event.v1"]
                    [(and ev (js/Boolean (.-id ev))) "event.id required"] [(and ev (js/Boolean (.-ts ev))) "event.ts required (ISO)"]
                    [(and ev (js/Boolean (.-source ev))) "event.source required"] [(and ev (js/Boolean (.-kind ev))) "event.kind required"]]]
    (when-not ok (throw (js/Error. msg)))))
(defn- event-context [raw]
  ;; The raw event is captured only by boundary closures; the projection sees
  ;; normalized Clojure data after sequential validation.
  {:validate! #(validate-raw! raw)
   :normalize! #(normalize-event raw)
   :admit! (fn [admission] (admission! admission raw))
   :start-vector! (fn [app indexer] (start-event-vector! app indexer raw))
   :raw-event (fn [] raw)})
(defn request-events [req]
  (let [body (.-body req) events (when body (.-events body))]
    (when (js/Array.isArray events) (mapv event-context (vec events)))))
