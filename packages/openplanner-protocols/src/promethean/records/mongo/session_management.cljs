(ns promethean.records.mongo.session-management
  "Mongo change stream implementation of SessionManagement protocol."
  (:require [promethean.openplanner-protocols :as protocols]))

(def SESSION_COLLECTION "knoxx_sessions")

(defn- now-iso [] (.toISOString (js/Date.)))

(defn- ^:async insert-session! [coll doc]
  (await (.insertOne coll doc))
  (js->clj doc :keywordize-keys true))

(defn- ^:async find-session [coll session-id]
  (let [result (await (.findOne coll #js {"_id" session-id}))]
    (when result (js->clj result :keywordize-keys true))))

(defn- ^:async update-session! [coll session-id update-doc]
  (let [result (await (.findOneAndUpdate
                        coll
                        #js {"_id" session-id}
                        #js {"$set" (clj->js update-doc)}
                        #js {"returnDocument" "after"}))]
    (js->clj (.-value result) :keywordize-keys true)))

(defn- ^:async delete-session! [coll session-id]
  (await (.deleteOne coll #js {"_id" session-id}))
  nil)

(defrecord MongoSessionManagement [db]
  protocols/SessionManagement
  (create-session [_ opts]
    (let [coll (.collection db SESSION_COLLECTION)
          id (str (random-uuid))
          doc (clj->js (merge {:_id id
                               :actor-id "unknown"
                               :createdAt (now-iso)
                               :updatedAt (now-iso)}
                              opts))]
      (insert-session! coll doc)))

  (get-session [_ session-id]
    (find-session (.collection db SESSION_COLLECTION) session-id))

  (update-session [_ session-id updates]
    (let [update-doc (merge (js->clj updates :keywordize-keys true)
                            {:updatedAt (now-iso)})]
      (update-session! (.collection db SESSION_COLLECTION) session-id update-doc)))

  (close-session [_ session-id]
    (delete-session! (.collection db SESSION_COLLECTION) session-id)))
