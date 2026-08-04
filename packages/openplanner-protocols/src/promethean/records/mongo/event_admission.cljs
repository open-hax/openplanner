(ns promethean.records.mongo.event-admission
  "Mongo change stream implementation of EventAdmission protocol.
   Writes events to the event_ledger collection and watches via change streams."
  (:require [promethean.openplanner-protocols :as protocols]))

(def LEDGER_COLLECTION "event_ledger")
(def COUNTERS_COLLECTION "_counters")
(def LEDGER_SEQ_KEY "event_ledger")
(def DEFAULT_TTL_DAYS 30)

(defn- now-iso [] (.toISOString (js/Date.)))

(defn- ttl-expiry [ttl-days]
  (let [ms (* (or ttl-days DEFAULT_TTL_DAYS) 24 60 60 1000)]
    (js/Date. (+ (.now js/Date) ms))))

(defn- ^:async assign-seq! [db]
  (let [counters (.collection db COUNTERS_COLLECTION)
        result (await (.findOneAndUpdate
                        counters
                        #js {"_id" LEDGER_SEQ_KEY}
                        #js {"$inc" #js {"seq" 1}}
                        #js {"upsert" true "returnDocument" "after"}))
        val (.-value result)]
    (when val (.-seq val))))

(defn- ensure-defaults [env]
  (cond-> env
    (not (:event/id env)) (assoc :event/id (str (random-uuid)))
    (not (:event/time env)) (assoc :event/time (now-iso))
    (not (:causal/root env)) (assoc :causal/root (str (random-uuid)))
    (not (:session/id env)) (assoc :session/id (str (random-uuid)))
    (not (:delivery/mode env)) (assoc :delivery/mode "tell")))

(defn- build-doc [env seq-num]
  (let [now (now-iso)]
    (assoc env
           :ledger/seq seq-num
           :expiresAt (ttl-expiry DEFAULT_TTL_DAYS)
           :createdAt now
           :updatedAt now)))

(defn- ^:async insert-or-dup! [coll doc event-id]
  (try
    (await (.insertOne coll (clj->js doc)))
    doc
    (catch :default e
      (if (= 11000 (.-code e))
        (let [existing (await (.findOne coll #js {"event/id" event-id}))]
          (js->clj existing :keywordize-keys true))
        (throw e)))))

(defn- ^:async query-events-impl [coll query]
  (let [cursor (.find coll query)
        sorted (.sort cursor #js {"event/time" -1})
        docs (await (.toArray sorted))]
    (js->clj docs :keywordize-keys true)))

(defn- ^:async append-event-impl! [db envelope]
  (let [env (ensure-defaults envelope)
        event-id (:event/id env)
        seq-num (await (assign-seq! db))
        doc (build-doc env seq-num)
        coll (.collection db LEDGER_COLLECTION)]
    (await (insert-or-dup! coll doc event-id))))

(defrecord MongoEventAdmission [db]
  protocols/EventAdmission
  (append-event! [_ envelope]
    (append-event-impl! db envelope))

  (append-events! [this envelopes]
    (js/Promise.all
      (clj->js (mapv #(protocols/append-event! this %) envelopes))))

  (query-events [_ filter-spec]
    (query-events-impl (.collection db LEDGER_COLLECTION) (clj->js filter-spec)))

  (watch-events [_ filter-spec callback]
    (let [coll (.collection db LEDGER_COLLECTION)
          pipeline (if (:event/type filter-spec)
                     [#js {"$match" #js {"fullDocument.event/type" (:event/type filter-spec)}}]
                     [])
          stream (.watch coll pipeline)
          id (str (random-uuid))]
      (.on stream "change"
           (fn [change]
             (when-let [doc (.-fullDocument change)]
               (callback (js->clj doc :keywordize-keys true)))))
      {:id id
       :close! (fn [] (.close stream))})))
