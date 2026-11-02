(ns promethean.event-ledger.legacy-bridge
  "Legacy events collection bridge.
   Merges reads from event_ledger and legacy events collection.
   Deduplicates by event/id (ledger takes precedence)."
  (:require
    [promethean.event-ledger.db :as db]))

(def LEGACY_COLLECTION "events")
(def BRIDGE_FLAG_KEY "OPENPLANNER_EVENT_LEDGER_BRIDGE")
(def ^:private DEDUP-HEADROOM 20)

(defn bridge-enabled?
  "Check if the bridge is enabled via environment variable."
  []
  (= "true" (or (aget js/process.env BRIDGE_FLAG_KEY) "false")))

(defn- timestamp-compare
  "Compare two events by timestamp, then by event/id for stability."
  [a b]
  (let [ta (or (:event/time a) "")
        tb (or (:event/time b) "")
        cmp (compare ta tb)]
    (if (zero? cmp)
      (compare (:event/id a) (:event/id b))
      cmp)))

(defn- dedup-events
  "Deduplicate events by event/id. Ledger events take precedence."
  [ledger-events legacy-events]
  (let [by-id (into {} (map (fn [e] [(:event/id e) e]) ledger-events))]
    (vals
      (reduce (fn [acc e]
                (let [id (:event/id e)]
                  (if (contains? acc id)
                    acc
                    (assoc acc id e))))
              by-id
              legacy-events))))

(defn- merge-sort-page
  "Merge two sorted event vectors and return a page."
  [ledger-events legacy-events limit]
  (let [merged (dedup-events ledger-events legacy-events)
        sorted (sort timestamp-compare merged)]
    (vec (take limit sorted))))

(defn ^:async find-events-page
  "Find a page of events from a single collection after a cursor."
  [coll cursor limit]
  (let [query (if cursor
                #js {"$or" [#js {"event/time" #js {"$gt" (:event/time cursor)}}
                            #js {"event/time" (:event/time cursor)
                                 "event/id" #js {"$gt" (:event/id cursor)}}]}
                #js {})]
    (await (db/find-sorted coll query #js {"event/time" 1 "event/id" 1} limit))))

(defn ^:async merge-find-events
  "Merge-read events from both collections with cursor-based pagination.
   Fetches DEDUP-HEADROOM extra docs per collection to ensure dedup
   doesn't reduce the merged set below limit."
  [db cursor limit]
  (let [ledger-coll (db/collection db db/LEDGER_COLLECTION)
        legacy-coll (db/collection db LEGACY_COLLECTION)
        fetch-limit (+ limit DEDUP-HEADROOM)
        results (await (js/Promise.all
                         #js [(find-events-page ledger-coll cursor fetch-limit)
                              (find-events-page legacy-coll cursor fetch-limit)]))
        ledger-events (aget results 0)
        legacy-events (aget results 1)]
    (merge-sort-page ledger-events legacy-events limit)))

(defn ^:async find-event-by-id
  "Find a single event by ID. Checks ledger first, falls back to legacy."
  [db event-id]
  (let [ledger-coll (db/collection db db/LEDGER_COLLECTION)
        legacy-coll (db/collection db LEGACY_COLLECTION)
        ledger-doc (await (.findOne ^js ledger-coll #js {"event/id" event-id}))]
    (if (some? ledger-doc)
      (db/to-clj ledger-doc)
      (let [legacy-doc (await (.findOne ^js legacy-coll #js {"event/id" event-id}))]
        (when (some? legacy-doc)
          (db/to-clj legacy-doc))))))
