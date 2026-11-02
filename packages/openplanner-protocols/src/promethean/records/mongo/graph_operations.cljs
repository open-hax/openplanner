(ns promethean.records.mongo.graph-operations
  "Mongo implementation of GraphOperations protocol."
  (:require [promethean.openplanner-protocols :as protocols]))

(defn- ^:async insert-node! [coll node]
  (await (.insertOne coll (clj->js node)))
  node)

(defn- ^:async insert-edge! [coll edge]
  (await (.insertOne coll (clj->js edge)))
  edge)

(defn- ^:async query-neighbor-ids [coll query node-id]
  (let [cursor (.find coll (clj->js query))
        edges (await (.toArray cursor))
        edge-list (js->clj edges :keywordize-keys true)
        neighbor-ids (mapcat
                       (fn [e]
                         (if (= (:source e) node-id)
                           [(:target e)]
                           [(:source e)]))
                       edge-list)]
    (vec (distinct neighbor-ids))))

(defn- ^:async query-all-nodes [coll]
  (let [cursor (.find coll #js {})
        nodes (await (.toArray cursor))]
    (js->clj nodes :keywordize-keys true)))

(defrecord MongoGraphOperations [db]
  protocols/GraphOperations

  (add-node [_ node]
    (let [coll (.collection db "graph_nodes")
          id (or (:id node) (str (random-uuid)))
          stored (assoc node :_id id :id id)]
      (insert-node! coll stored)))

  (add-edge [_ edge]
    (let [coll (.collection db "graph_edges")
          id (or (:id edge) (str (random-uuid)))
          stored (assoc edge :_id id :id id)]
      (insert-edge! coll stored)))

  (query-neighbors [_ node-id opts]
    (let [coll (.collection db "graph_edges")
          edge-types (:edge-types opts)
          query (if (seq edge-types)
                  {:$or [{:source node-id} {:target node-id}]
                   :type {:$in edge-types}}
                  {:$or [{:source node-id} {:target node-id}]})]
      (query-neighbor-ids coll query node-id)))

  (traverse [_ _start _opts]
    (query-all-nodes (.collection db "graph_nodes"))))
