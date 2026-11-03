(ns label-projection (:require [clojure.string :as str] [boundary-values :as bv]))
(defn- slug [s] (let [v (-> s str/lower-case (str/replace #"[^a-z0-9]+" "-") (str/replace #"^-+|-+$" "")) v (subs v 0 (min 96 (count v)))] (if (empty? v) "label" v)))
(defn- js-string [x] (bv/js-string x))
(defn- nullish [a b] (if (nil? a) b a))
(defn project [ev now]
  (let [extra (:foreign-extra ev) spec (get extra "openplanner_labels") values (if (vector? (get spec "labels")) (get spec "labels") [])
        labels (->> values (map #(str/trim (js-string (nullish % "")))) (remove empty?) distinct)
        tenant (let [v (str/trim (js-string (nullish (get spec "tenant_id") (nullish (get extra "tenant_id") "default"))))] (if (seq v) v "default"))
        project (get-in ev [:source_ref :project]) ts (bv/date (:ts ev))]
    (mapv (fn [label] (let [id (str "label:" tenant ":" (slug label))]
                        {:id id
                         :op {:updateOne {:filter {:label_id id} :update {:$set {:_id id :label_id id :label label :emoji nil :description (str "Auto-derived event label: " label) :color nil :tenant_id tenant :project project :embedding_model nil :embedding_dimensions 0 :embedding nil :created_by "event-ingest" :updatedAt now} :$setOnInsert {:createdAt now}} :upsert true}}
                         :edge {:source_node_id (:id ev) :target_node_id id :edge_kind "has_label" :layer nil :project project :source (:source ev) :data {:applied_at (.toISOString ts) :confidence 1 :label label :claim_system (get spec "claim_system") :source_event_id (:id ev)} :updated_at ts}})) labels)))
