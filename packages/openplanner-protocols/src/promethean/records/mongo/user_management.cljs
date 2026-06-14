(ns promethean.records.mongo.user-management
  "Mongo implementation of UserManagement protocol."
  (:require [promethean.openplanner-protocols :as protocols]))

(defn- ^:async insert-user! [coll user-data]
  (await (.insertOne coll (clj->js user-data)))
  {:event/type "user.create.success"
   :payload {:userId (:_id user-data)}})

(defn- ^:async find-user-by-username [coll username credentials]
  (let [result (await (.findOne coll #js {:username username}))]
    (if result
      (let [stored-password (.-password result)
            provided-password (:password credentials)]
        (if (= stored-password provided-password)
          {:event/type "user.login.success"
           :payload {:userId (.-_id result)}}
          {:event/type "user.login.failure"
           :payload {:reason "invalid credentials"}}))
      {:event/type "user.login.failure"
       :payload {:reason "user not found"}})))

(defn- ^:async find-user-by-id [coll user-id]
  (let [result (await (.findOne coll #js {"_id" user-id}))]
    (when result (js->clj result :keywordize-keys true))))

(defn- ^:async update-user! [coll user-id updates]
  (let [result (await (.findOneAndUpdate
                        coll
                        #js {"_id" user-id}
                        #js {"$set" (clj->js updates)}
                        #js {"returnDocument" "after"}))]
    (if (.-value result)
      {:event/type "user.update.success"
       :payload {:userId user-id}}
      {:event/type "user.update.failure"
       :payload {:reason "user not found"}})))

(defrecord MongoUserManagement [db]
  protocols/UserManagement
  (create-user [_ user-data]
    (let [coll (.collection db "knoxx_users")
          id (or (:id user-data) (str (random-uuid)))
          stored (assoc user-data :_id id :id id)]
      (insert-user! coll stored)))

  (authenticate [_ credentials]
    (find-user-by-username (.collection db "knoxx_users") (:username credentials) credentials))

  (get-user [_ user-id]
    (find-user-by-id (.collection db "knoxx_users") user-id))

  (update-user [_ user-id updates]
    (update-user! (.collection db "knoxx_users") user-id updates)))
