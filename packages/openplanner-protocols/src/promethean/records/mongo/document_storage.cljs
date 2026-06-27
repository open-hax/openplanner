(ns promethean.records.mongo.document-storage
  "Mongo implementation of DocumentStorage protocol."
  (:require [promethean.openplanner-protocols :as protocols]))

(defn- now-iso [] (.toISOString (js/Date.)))

(defn- ^:async insert-doc! [coll doc]
  (await (.insertOne coll (clj->js doc)))
  doc)

(defn- ^:async find-doc [coll query]
  (let [result (await (.findOne coll query))]
    (when result (js->clj result :keywordize-keys true))))

(defn- ^:async find-docs [coll query]
  (let [cursor (.find coll (clj->js query))
        result (await (.toArray cursor))]
    (js->clj result :keywordize-keys true)))

(defn- ^:async update-doc! [coll query update]
  (await (.updateOne coll query update))
  nil)

(defrecord MongoDocumentStorage [db collection-name]
  protocols/DocumentStorage
  (store-document [_ doc]
    (let [coll (.collection db collection-name)
          id (or (:id doc) (str (random-uuid)))
          stored (merge doc {:id id
                             :_id id
                             :created-at (now-iso)
                             :updated-at (now-iso)})]
      (insert-doc! coll stored)))

  (get-document [_ doc-id]
    (find-doc (.collection db collection-name) #js {"_id" doc-id}))

  (query-documents [_ query]
    (find-docs (.collection db collection-name) query))

  (archive-document [_ doc-id]
    (update-doc! (.collection db collection-name)
                 #js {"_id" doc-id}
                 #js {"$set" #js {:archived true :updated-at (now-iso)}})))
