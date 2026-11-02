(ns promethean.records.mongo.translation-management
  "Mongo implementation of TranslationManagement protocol."
  (:require [promethean.openplanner-protocols :as protocols]))

(defn- ^:async insert-translation! [coll translation]
  (await (.insertOne coll (clj->js translation)))
  translation)

(defn- ^:async update-translation-label! [coll segment-id label]
  (let [result (await (.findOneAndUpdate
                        coll
                        #js {"_id" segment-id}
                        #js {"$set" #js {:label label}}
                        #js {"returnDocument" "after"}))]
    (js->clj (.-value result) :keywordize-keys true)))

(defn- ^:async insert-batch! [coll docs batch-id]
  (await (.insertMany coll (clj->js docs)))
  batch-id)

(defrecord MongoTranslationManagement [db]
  protocols/TranslationManagement
  (create-translation [_ translation]
    (let [coll (.collection db "translation_segments")
          id (or (:id translation) (str (random-uuid)))
          stored (assoc translation :_id id :id id)]
      (insert-translation! coll stored)))

  (label-translation [_ segment-id label]
    (update-translation-label! (.collection db "translation_segments") segment-id label))

  (batch-translate [_ batch]
    (let [batch-id (str (random-uuid))
          coll (.collection db "translation_segments")
          docs (mapv (fn [t] (assoc t :batch-id batch-id :id (str (random-uuid)))) batch)]
      (insert-batch! coll docs batch-id))))
