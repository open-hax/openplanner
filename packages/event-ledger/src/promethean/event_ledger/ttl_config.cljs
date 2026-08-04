(ns promethean.event-ledger.ttl-config
  "TTL configuration for the event ledger.
   Reads per-type overrides from the event_ttl_overrides collection.
   Falls back to DEFAULT_TTL_DAYS when no override matches."
  (:require
    [clojure.string :as str]
    [promethean.event-ledger.db :as db]))

(def TTL_COLLECTION "event_ttl_overrides")
(def DEFAULT_TTL_DAYS 30)

(defn- prefix-matches?
  "Check if event-type starts with any of the given prefixes."
  [event-type prefixes]
  (some #(str/starts-with? event-type %) prefixes))

(defn- override->ttl
  "Convert a TTL override document to {:prefixes [...] :ttl-days N}."
  [override]
  {:prefixes (vec (or (:prefixes override) []))
   :ttl-days (let [d (:ttl-days override)]
               (if (some? d) d DEFAULT_TTL_DAYS))})

(defn ^:async load-overrides
  "Load all TTL overrides from the database.
   Returns a vector of {:prefixes [...] :ttl-days N} maps."
  [db]
  (let [coll (db/collection db TTL_COLLECTION)
        docs (await (db/find-many coll {}))]
    (mapv override->ttl docs)))

(defn- resolve-from-overrides
  "Resolve TTL from a pre-loaded overrides list."
  [overrides event-type]
  (or
    (when event-type
      (some (fn [{:keys [prefixes ttl-days]}]
              (when (prefix-matches? event-type prefixes)
                ttl-days))
            overrides))
    DEFAULT_TTL_DAYS))

(defn ^:async resolve-ttl
  "Resolve the TTL in days for an event type.
   Checks overrides from the database, falls back to default."
  [db event-type]
  (let [overrides (await (load-overrides db))]
    (resolve-from-overrides overrides event-type)))

(defn ^:async resolve-ttl-batch
  "Resolve TTL for multiple event types in one DB read.
   Returns a map of event-type -> ttl-days."
  [db event-types]
  (let [overrides (await (load-overrides db))]
    (into {} (map (fn [t] [t (resolve-from-overrides overrides t)]) event-types))))
