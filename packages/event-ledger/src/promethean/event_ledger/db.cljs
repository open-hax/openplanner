(ns promethean.event-ledger.db
  "Database access helpers for the event ledger.
   Wraps MongoDB Node.js driver interop for CLJS consumption.")

(def LEDGER_COLLECTION "event_ledger")

(defn to-clj
  "Convert a JS object to a Clojure map with keyword keys."
  [obj]
  (js->clj obj :keywordize-keys true))

(defn to-js
  "Convert a Clojure map to a JS object."
  [m]
  (clj->js m))

(defn collection
  "Get a collection handle from a db instance."
  [^js db coll-name]
  (.collection db coll-name))

(defn ^:async find-many
  "Find multiple documents. Returns a vector."
  [^js coll query]
  (let [cursor (.find coll (if (map? query) (to-js query) query))
        arr (await (.toArray cursor))]
    (to-clj arr)))

(defn ^:async find-sorted
  "Find with sort and optional limit."
  [^js coll query sort-fields limit]
  (let [cursor (.sort (.find coll (if (map? query) (to-js query) query))
                      (if (map? sort-fields) (to-js sort-fields) sort-fields))
        limited (if limit (.limit cursor limit) cursor)
        arr (await (.toArray limited))]
    (to-clj arr)))

(defn watch
  "Open a change stream on a collection. Returns the stream."
  ([^js coll] (.watch coll))
  ([^js coll pipeline] (.watch coll (to-js pipeline)))
  ([^js coll pipeline opts] (.watch coll (to-js pipeline) (to-js opts))))
