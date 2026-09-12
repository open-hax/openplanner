(ns promethean.event-ledger.core
  "Event ledger core: append events to the Mongo event_ledger collection.
   Handles envelope validation, seq assignment, TTL, and idempotent inserts."
  (:require
    [promethean.event-ledger.db :as db]
    [promethean.event-ledger.schema :as schema]
    [promethean.event-ledger.ttl-config :as ttl]))

(def COUNTERS_COLLECTION "_counters")
(def LEDGER_SEQ_KEY "event_ledger")

(defn- now-iso []
  (.toISOString (js/Date.)))

(defn- ttl-expiry
  "Compute expiresAt from now + ttl-days."
  [ttl-days]
  (let [ms (* (or ttl-days ttl/DEFAULT_TTL_DAYS) 24 60 60 1000)]
    (js/Date. (+ (.now js/Date) ms))))

(defn- ensure-event-id
  "Generate a UUID v4 if event/id is not set."
  [envelope]
  (if (get envelope :event/id)
    envelope
    (assoc envelope :event/id (str (random-uuid)))))

(defn- ensure-event-time
  "Set event/time to now if not provided."
  [envelope]
  (if (get envelope :event/time)
    envelope
    (assoc envelope :event/time (now-iso))))

(defn- ensure-causal-root
  "Set causal/root if not provided."
  [envelope]
  (if (get envelope :causal/root)
    envelope
    (assoc envelope :causal/root (str (random-uuid)))))

(defn- ensure-session-id
  "Set session/id if not provided."
  [envelope]
  (if (get envelope :session/id)
    envelope
    (assoc envelope :session/id (str (random-uuid)))))

(defn- ensure-delivery-mode
  "Default delivery/mode to tell."
  [envelope]
  (if (get envelope :delivery/mode)
    envelope
    (assoc envelope :delivery/mode "tell")))

(defn- fill-defaults
  "Fill all default fields on an envelope."
  [env]
  (-> env
      ensure-event-id
      ensure-event-time
      ensure-causal-root
      ensure-session-id
      ensure-delivery-mode))

(defn- ^:async assign-seq!
  "Atomically increment and return the next ledger/seq from the counters collection."
  [db]
  (let [counters (db/collection db COUNTERS_COLLECTION)
        result (await (.findOneAndUpdate
                        ^js counters
                        #js {"_id" LEDGER_SEQ_KEY}
                        #js {"$inc" #js {"seq" 1}}
                        #js {"upsert" true "returnDocument" "after"}))
        val (.-value ^js result)]
    (when val (.-seq ^js val))))

(defn- normalize-envelope
  "Coerce envelope to CLJS map, fill defaults, then validate."
  [envelope]
  (let [env (cond
              (map? envelope) envelope
              (instance? js/Object envelope) (db/to-clj envelope)
              :else envelope)
        env (fill-defaults env)
        validation (schema/validate-envelope env)]
    (when-not (:valid validation)
      (throw (ex-info "Invalid envelope" {:errors (:errors validation)})))
    env))

(defn- build-doc
  "Assoc seq, timestamps, and TTL onto an envelope."
  [env seq-num ttl-days]
  (let [now (now-iso)]
    (assoc env
           :ledger/seq seq-num
           :expiresAt (ttl-expiry ttl-days)
           :createdAt now
           :updatedAt now)))

(defn- ^:async insert-or-find-dup
  "Insert doc into coll. On duplicate key (11000), return existing doc."
  [coll doc event-id]
  (try
    (await (.insertOne ^js coll (db/to-js doc)))
    doc
    (catch :default e
      (if (= 11000 (.-code ^js e))
        (let [existing (await (.findOne ^js coll #js {"event/id" event-id}))]
          (db/to-clj existing))
        (throw e)))))

(defn- ^:async append-event-with-ttl
  "Append a single event with a pre-resolved TTL."
  [db envelope ttl-days]
  (let [env (normalize-envelope envelope)
        event-id (:event/id env)
        seq-num (await (assign-seq! db))
        doc (build-doc env seq-num ttl-days)
        coll (db/collection db db/LEDGER_COLLECTION)]
    (await (insert-or-find-dup coll doc event-id))))

(defn ^:async append-event
  "Append a single event to the ledger.
   Validates the envelope, assigns seq and timestamps, inserts into Mongo.
   Returns the full document with ledger/seq.
   Idempotent: duplicate event/id returns the existing document."
  [db envelope]
  (let [env (normalize-envelope envelope)
        event-type (:event/type env)
        ttl-days (await (ttl/resolve-ttl db event-type))]
    (await (append-event-with-ttl db envelope ttl-days))))

(defn ^:async append-events
  "Append multiple events to the ledger.
   Resolves TTLs in a single DB read for efficiency."
  [db envelopes]
  (let [normed (mapv normalize-envelope envelopes)
        event-types (mapv :event/type normed)
        ttl-map (await (ttl/resolve-ttl-batch db event-types))
        items (mapv (fn [env]
                      (let [event-type (:event/type env)
                            ttl-days (get ttl-map event-type ttl/DEFAULT_TTL_DAYS)]
                        {:envelope env :ttl-days ttl-days}))
                    normed)]
    (await (js/Promise.all
             (clj->js (mapv (fn [{:keys [envelope ttl-days]}]
                              (append-event-with-ttl db envelope ttl-days))
                            items))))))

(defn ^:async setup-indexes
  "Create the indexes for the event_ledger collection.
   Safe to call multiple times (idempotent)."
  [db]
  (let [coll (db/collection db db/LEDGER_COLLECTION)]
    (await (.createIndex ^js coll #js {"event/id" 1} #js {"unique" true}))
    (await (.createIndex ^js coll #js {"event/type" 1 "event/time" 1}))
    (await (.createIndex ^js coll #js {"causal/root" 1}))
    (await (.createIndex ^js coll #js {"session/id" 1}))
    (await (.createIndex ^js coll #js {"expiresAt" 1} #js {"expireAfterSeconds" 0}))))

(defn ^:export ^:async append-event-js
  "JS-compatible appendEvent."
  [db envelope]
  (db/to-js (await (append-event db envelope))))

(defn ^:export ^:async append-events-js
  "JS-compatible appendEvents."
  [db envelopes]
  (db/to-js (await (append-events db (mapv db/to-clj envelopes)))))

(defn ^:export ^:async setup-indexes-js
  "JS-compatible setupIndexes."
  [db]
  (await (setup-indexes db)))
