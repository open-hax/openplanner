(ns event-slice (:require [clojure.string :as str] [discord-projection :as dp] [mongo-projection :as mp] [event-externs :as ext] [label-projection :as labels] [graph-node-projection :as gn] [boundary-values :as bv]))

;; Experimental, unserved event handler. Its broader parity is not established.
;; It is never installed in the production entry.
(defn graph-edge [m]
  (let [extra (:extra m) norm #(if (nil? %) "" (str/trim (ext/js-string %)))
        src (norm (:source_node_id extra)) dst (norm (:target_node_id extra))
        kind (norm (if (some? (:edge_type extra)) (:edge_type extra) (:edge_kind extra)))]
    (if (and (seq src) (seq dst) (seq kind) (not= src dst))
      [{:source_node_id src :target_node_id dst :edge_kind kind :layer (when (some? (:layer extra)) (ext/js-string (:layer extra)))
        :project (get-in m [:source_ref :project])
        :source (:source m) :data (:foreign-extra m) :updated_at (bv/date (:ts m))}] [])))

(defn handler [app admission counter indexer prepare split-sentences track! req reply]
  (let [events (ext/request-events req)]
    (if (nil? events)
      (ext/bad-body! reply)
      (let [ids (atom []) accepted (atom []) nodes (atom {}) node-order (atom []) embeddings (atom {}) embedding-order (atom []) label-ops (atom {}) label-order (atom []) vectors (atom []) edges (atom []) now (bv/now)]
        (-> (reduce
             (fn [p ctx]
               (ext/then p (fn []
                             ((:validate! ctx))
                             (let [m ((:normalize! ctx))]
                               (-> ((:admit! ctx) admission)
                              (ext/then (fn []
                                       (swap! ids conj (:id m)) (swap! accepted conj ctx)
                                       (let [extra (:extra m) ls (labels/project m now)
                                             _ (doseq [l ls] (when-not (contains? @label-ops (:id l)) (swap! label-order conj (:id l)) (swap! label-ops assoc (:id l) (:op l))) (swap! edges conj (:edge l)))
                                             explicit (:previous_message_id extra)
                                             channel (when-not (nil? (:channel_id extra)) (str/trim (bv/js-string (:channel_id extra))))
                                             prior (if (or (not= "discord.message" (:kind m)) (seq (str/trim (ext/js-string (ext/nullish explicit "")))) (not (seq (str/trim (str (or channel ""))))))
                                                     (ext/resolved) (ext/prior! app channel (bv/date (:ts m))))]
                                         (ext/then prior (fn [prev]
                                                        (let [p (cond (= "graph.edge" (:kind m)) {:edges (graph-edge m) :topic-nodes []} (= "discord.message" (:kind m)) (dp/project m prev) :else {:edges [] :topic-nodes []}) timestamp (bv/date (:ts m))
                                                              structure (if (= "discord.message" (:kind m)) (dp/guild-channel m) {:nodes [] :edges []})
                                                              social (if (= "discord.message" (:kind m)) (dp/author-mentions-reply m) {:author-nodes [] :author-edges [] :other-edges []})
                                                              node-projection (if (= "graph.node" (:kind m)) (gn/project m prepare split-sentences) {:nodes [] :edges [] :embeddings []})
                                                              web (if (= "discord.message" (:kind m)) (dp/urls-and-bluesky m) {:nodes [] :edges []})
                                                              preview (when (and (not (contains? #{"graph.node" "graph.edge"} (:kind m))) (string? (:text m))) (str/trim (:text m)))
                                                              reaction (if (and (= "discord.reaction" (:kind m)) (seq preview)) (dp/reaction m) {:nodes [] :edges []})
                                                              generic (when (seq preview) (let [label (ext/nullish (get-in m [:foreign-extra "label"]) (ext/nullish (get-in m [:foreign-source-ref "message"]) (if (> (count preview) 80) (str (.slice preview 0 77) "...") preview)))] {:id (str "graph.node:derive:" (bv/js-string (:id m))) :ts timestamp :project (get-in m [:source_ref :project]) :node-id (:id m) :embedding-key (:id-identity m) :node-kind (:foreign-kind m) :label (if (seq (str/trim (ext/js-string label))) (str/trim (ext/js-string label)) (:id m)) :preview preview :extra {:lake (get-in m [:source_ref :project]) :entity_key (:id m) :source_event_id (:id m) :source_kind (:foreign-kind m)} :foreign-extra (:spread-extra m)}))
                                                              topic-nodes (map (fn [n] {:id (str "graph.node:" (:node_id n)) :ts timestamp :project "topic" :node-id (:node_id n) :node-kind "topic" :label (:label n) :preview (:preview n) :extra {:topic (:label n) :slug (subs (:node_id n) 6)}}) (:topic-nodes p))
                                                              atts (when (and (= "discord.message" (:kind m)) (vector? (:attachments extra))) (keep-indexed (fn [i a] (when (bv/truthy? a) (mp/attachment m a (get-in m [:foreign-extra "attachments" i]) (get-in m [:attachment-json i])))) (:attachments extra)))]
                                                          (doseq [n (concat (when generic [generic]) (take (if (= "discord.guild" (:node-kind (first (:nodes structure)))) 1 0) (:nodes structure)) (:author-nodes social) (drop (if (= "discord.guild" (:node-kind (first (:nodes structure)))) 1 0) (:nodes structure)) topic-nodes (map :node atts) (:nodes web) (:nodes node-projection) (:nodes reaction))]
                                                            (when-not (contains? @nodes (:id n)) (swap! node-order conj (:id n)) (swap! nodes assoc (:id n) n))
                                                            (let [text (ext/passage-text (:preview n)) embedding-key (ext/nullish (:embedding-key n) (:node-id n))] (when (and (not= false (:embed? n)) (not= "graph.node" (:kind m)) (seq text)) (when-not (contains? @embeddings embedding-key) (swap! embedding-order conj embedding-key)) (swap! embeddings assoc embedding-key {:node_id (:node-id n) :source_event_id (:id m) :project (:project n) :text text :chunk_count 1}))))
                                                          (doseq [input (:embeddings node-projection)]
                                                            (let [text (ext/passage-text (:text input)) id (:node-id input)]
                                                              (when (seq text) (when-not (contains? @embeddings id) (swap! embedding-order conj id))
                                                                    (swap! embeddings assoc id {:node_id id :source_event_id (:source-event-id input) :project (:project input) :text text :chunk_count (:chunk-count input)}))))
                                                          (swap! edges into (:edges node-projection))
                                                          (let [guild? (some #(= "in_guild" (:edge_kind %)) (:edges structure))]
                                                            (swap! edges into (take (if guild? 1 0) (:edges structure)))
                                                            (swap! edges into (:author-edges social))
                                                            (swap! edges into (drop (if guild? 1 0) (:edges structure))))
                                                          (swap! edges into (:other-edges social))
                                                          (swap! edges into (map #(assoc % :updated_at timestamp) (:edges p)))
                                                          (swap! edges into (mapcat :edges atts))
                                                          (swap! edges into (:edges web))
                                                          (swap! edges into (:edges reaction))
                                                          (when (seq preview) (let [task ((:start-vector! ctx) app indexer)] (swap! vectors conj task) (track! task))))))))))))))
             (ext/resolved) events)
            (ext/then (fn [] (ext/writes! app (mapv @nodes @node-order) (mapv @label-ops @label-order) @edges now)))
            (ext/then (fn [] (when-let [task (ext/start-graph-embeddings! app (mapv @embeddings @embedding-order))] (track! task)) (ext/metrics! counter @accepted) (ext/kafka! app req @accepted)))
            (ext/then (fn [] (ext/response {:ok true :count (count @ids) :ids @ids :projectedGraphEdges (count @edges)
                               :ftsEnabled true :storageBackend "mongodb" :indexed true :indexing (if (or (seq @embeddings) (seq @vectors)) "queued" "skipped") :queuedEventVectors (count @vectors) :queuedGraphNodeEmbeddings (count @embeddings)}))))))))
