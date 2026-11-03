(ns graph-node-projection (:require [clojure.string :as str] [event-externs :as ext] [boundary-values :as bv]))
(defn- js-string [x] (bv/js-string x))
(defn- nullish [a b] (if (nil? a) b a))
(defn project [ev prepare split-sentences]
  (let [extra (:foreign-extra ev) sr (:foreign-source-ref ev) node-id (str/trim (js-string (nullish (get extra "node_id") (nullish (get sr "message") ""))))
        direct (str/trim (js-string (nullish (:foreign-text ev) ""))) preview (str/trim (js-string (nullish (get extra "preview") ""))) body (if (seq direct) direct preview)
        project (get-in ev [:source_ref :project]) ts (bv/date (:ts ev))]
    (if-not (and (seq node-id) (seq body)) {:nodes [] :edges [] :embeddings []}
      (let [prepared (ext/prepare-document prepare split-sentences node-id body (:foreign-extra ev))
            label (let [x (str/trim (js-string (nullish (get extra "label") (nullish (get extra "path") (nullish (get sr "message") node-id)))))] (if (seq x) x node-id))
            chunks (when (> (:chunk-count prepared) 1) (:chunks prepared))
            chunk-nodes (mapv (fn [c] {:id (str "graph.node:doc_chunk:" (:id c)) :ts ts :project project :node-id (:id c) :node-kind "doc_chunk" :label (str label " [chunk " (inc (:chunkIndex c)) "/" (:chunkCount c) "]") :preview (.slice (:text c) 0 800) :extra {:parent_node_id node-id :chunk_index (:chunkIndex c) :chunk_count (:chunkCount c)}}) chunks)
            chunk-edges (mapv (fn [c] {:source_node_id node-id :target_node_id (:id c) :edge_kind "contains_chunk" :layer "derived" :project project :source "openplanner-derive" :data {:parent_node_id node-id :chunk_index (:chunkIndex c) :chunk_count (:chunkCount c)} :updated_at ts}) chunks)
            sentences (:sentences prepared)
            sentence-id #(str (or project "devel") ":sentence:" (:hash %))
            sentence-nodes (mapv (fn [s] (let [text (:sentence s) id (sentence-id s)] {:id (str "graph.node:sentence:" id) :ts ts :project project :node-id id :node-kind "sentence" :label (if (> (count text) 120) (str (.slice text 0 117) "...") text) :preview text :extra {:derived_from_node_id node-id}})) sentences)
            sentence-edges (mapv (fn [s] {:source_node_id node-id :target_node_id (sentence-id s) :edge_kind "contains_sentence" :layer "derived" :project project :source "openplanner-derive" :data {:sentence_hash (:hash s)} :updated_at ts}) sentences)
            inputs (concat (if (seq chunks) (map (fn [c] {:node-id (:id c) :text (:text c) :chunk-count (:chunkCount c)}) chunks) [{:node-id node-id :text (:normalized-text prepared) :chunk-count 1}]) (map (fn [s] {:node-id (sentence-id s) :text (:sentence s) :chunk-count 1}) sentences))]
        {:nodes (into chunk-nodes sentence-nodes) :edges (into chunk-edges sentence-edges)
         :embeddings (mapv #(assoc % :source-event-id (:id ev) :project project) inputs)}))))
