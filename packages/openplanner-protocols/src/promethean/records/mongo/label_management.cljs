(ns promethean.records.mongo.label-management
  "Mongo implementation of LabelManagement protocol."
  (:require [promethean.openplanner-protocols :as protocols]))

(defn- ^:async insert-label! [coll label]
  (await (.insertOne coll (clj->js label)))
  label)

(defn- ^:async apply-label-to-target! [coll label-id target-id target-type]
  (await (.insertOne
            coll
            (clj->js {:labelId label-id
                      :targetId target-id
                      :targetType target-type})))
  nil)

(defn- ^:async query-label-targets [coll query]
  (let [cursor (.find coll (clj->js query))
        docs (await (.toArray cursor))]
    (js->clj docs :keywordize-keys true)))

(defrecord MongoLabelManagement [db]
  protocols/LabelManagement
  (create-label [_ label]
    (let [coll (.collection db "km_labels")
          id (or (:id label) (str (random-uuid)))
          stored (assoc label :_id id :id id)]
      (insert-label! coll stored)))

  (apply-label [_ label-id target-id target-type]
    (apply-label-to-target! (.collection db "graph_label_nodes") label-id target-id target-type))

  (query-by-label [_ label-id opts]
    (let [coll (.collection db "graph_label_nodes")
          target-type (:target-type opts)
          query (if target-type
                  {:labelId label-id :targetType target-type}
                  {:labelId label-id})]
      (query-label-targets coll query))))
