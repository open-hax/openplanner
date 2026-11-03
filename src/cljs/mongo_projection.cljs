(ns mongo-projection
  (:require [clojure.string :as str]
            ["node:crypto" :as crypto]
            [lossless-json :as lj] [boundary-values :as bv]))

(defn text-hash [s] (when-not (string? s) (throw (js/TypeError. "text.trim is not a function"))) (-> (crypto/createHash "sha256") (.update (-> s str/trim str/lower-case)) (.digest "hex")))
(defn- js-or [x fallback] (if (bv/truthy? x) x fallback))
(defn- js-string [x] (bv/js-string x))
(defn attachment [event att & [foreign-att serialized-att]]
  (let [extra (:extra event) sr (:source_ref event)
        guild (str/trim (js-string (if (nil? (:guild_id extra)) (if (nil? (:session sr)) "" (:session sr)) (:guild_id extra))))
        channel (str/trim (js-string (if (nil? (:channel_id extra)) "" (:channel_id extra))))
        id (js-string (if (bv/truthy? (:id att)) (:id att) (text-hash (if (bv/truthy? (:url att)) (:url att) (if (nil? serialized-att) (bv/json-stringify (if (nil? foreign-att) att foreign-att)) serialized-att)))))
        node-id (str "discord:attachment:" id) label (js-string (js-or (:filename att) "attachment"))
        preview (str "Attachment " label " (" (js-string (js-or (:content_type att) "file")) ", " (js-string (js-or (:size att) 0)) " bytes)")
        common {:source (:source event) :project (:project sr) :updated_at (bv/date (:ts event))}
        edges (cond-> [(merge common {:source_node_id (:id event) :target_node_id node-id :edge_kind "has_attachment" :layer "multimodal" :data {:filename label :url (:url att) :content_type (:content_type att) :size (:size att)}})]
                (bv/truthy? (:url att)) (conj (merge common {:source_node_id node-id :target_node_id (str "web:url:" (js-string (:url att))) :edge_kind "has_url" :layer "citation" :data {:url (:url att)}})))]
    {:node {:id (str "graph.node:" node-id) :ts (bv/date (:ts event)) :project (:project sr) :node-id node-id :node-kind "discord.attachment" :label label :preview preview :extra (merge (js->clj (lj/copy-enumerables (lj/encode (if (nil? foreign-att) att foreign-att)))) {"message_id" (:id event) "channel_id" channel "guild_id" guild})}
     :embedding {:node_id node-id :source_event_id (:id event) :project (:project sr) :text preview :chunk_count 1}
     :edges edges}))

(defn node-op [node now]
  (let [{:keys [id ts project node-id node-kind label preview extra foreign-extra]} node]
    {:updateOne {:filter {:_id id}
                 :update {:$set {:id id :ts ts :source "openplanner-derive" :kind "graph.node" :project project :session nil :message label :role nil :author nil :model nil :tags nil :text "" :attachments nil
                                  :extra (merge (js->clj (clj->js {:node_id node-id :node_kind node-kind :label label :preview preview :content_hash (text-hash preview) :lake project})) (js->clj (lj/encode extra)) foreign-extra)
                                  :schema_version 3 :migration_state {:applied ["event/v1->v2-source-ref" "event/v2->v3-reference-first-text"] :verified_at (.toISOString now) :strategy "new-write"} :updatedAt now}
                          :$setOnInsert {:createdAt now}} :upsert true}}))

(defn edge-ops [rows now]
  (let [order (atom []) dedup (reduce (fn [m row] (let [k (str (js-string (:source_node_id row)) "||" (js-string (:target_node_id row)) "||" (js-string (:edge_kind row))) prev (get m k)]
                                    (when-not (contains? m k) (swap! order conj k))
                                    (assoc m k (if (and (js/Boolean (clj->js (:data prev))) (js/Boolean (clj->js (:data row))))
                                                 (assoc (merge prev row) :data (js->clj (lj/copy-enumerables (lj/encode (:data prev)) (lj/encode (:data row))))) row)))) {} rows)]
    (mapv (fn [[_ row]]
            (let [{:keys [source_node_id target_node_id edge_kind layer project source data updated_at]} row]
              {:updateOne {:filter {:source_node_id source_node_id :target_node_id target_node_id :edge_kind edge_kind}
                           :update {:$set {:source_node_id source_node_id :target_node_id target_node_id :edge_kind edge_kind :layer layer :project project :source source :data data :updated_at (or updated_at now) :updatedAt now}
                                    :$setOnInsert {:_id (str (js-string source_node_id) "||" (js-string target_node_id) "||" (js-string edge_kind)) :createdAt now}} :upsert true}})) (mapv (fn [k] [k (get dedup k)]) @order))))

(defn write! [events edges nodes rows now]
  (-> (if (seq nodes) (.bulkWrite events (lj/encode (mapv #(node-op % now) nodes)) #js {:ordered false}) (js/Promise.resolve))
      (.then (fn [] (if (seq rows) (.bulkWrite edges (lj/encode (edge-ops rows now)) #js {:ordered false}) (js/Promise.resolve))))))
