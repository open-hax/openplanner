(ns promethean.event-ledger.watcher
  "Change stream watcher infrastructure for the event ledger.
   Provides watchLedger (persistent), watchOnce (temporary), and lifecycle management."
  (:require
    [promethean.event-ledger.db :as db]))

(defonce ^:private watcher-registry
  (atom {}))

(defonce ^:private next-id
  (atom 0))

(defn- generate-watcher-id []
  (str "watcher-" (swap! next-id inc)))

(defn- build-pipeline
  "Build a Mongo change stream pipeline from a filter map."
  [filter]
  (let [match (cond-> {}
                (contains? filter :event/type)
                (assoc "fullDocument.event/type"
                       (if (vector? (:event/type filter))
                         {"$in" (:event/type filter)}
                         (:event/type filter)))

                (contains? filter :session/id)
                (assoc "fullDocument.session/id"
                       (:session/id filter))

                (contains? filter :causal/root)
                (assoc "fullDocument.causal/root"
                       (:causal/root filter)))]
    (when (seq match)
      [{"$match" match}])))

(defn- safe-close
  "Close a stream, ignoring errors (e.g. already closed)."
  [^js stream]
  (try
    (.close stream)
    (catch :default _)))

(defn- make-handle
  "Build a watcher handle and register it."
  [id stream filter]
  (let [closed (atom false)
        close! (fn []
                 (when-not @closed
                   (reset! closed true)
                   (safe-close stream)
                   (swap! watcher-registry dissoc id)))
        handle {:id id
                :stream stream
                :created-at (js/Date.)
                :filter filter
                :close! close!}]
    (swap! watcher-registry assoc id handle)
    handle))

(defn- wire-callback
  "Attach change and error handlers to a stream."
  [^js stream id callback]
  (.on stream "change"
       (fn [^js change]
         (try
           (callback (db/to-clj (.-fullDocument change)))
           (catch js/Error e
             (js/console.error (str "[watcher:" id "] callback error:") e)))))
  (.on stream "error"
       (fn [err]
         (js/console.error (str "[watcher:" id "] stream error:") err)
         (when-let [handle (get @watcher-registry id)]
           ((:close! handle))))))

(defn watch-ledger
  "Open a persistent change stream watcher on the event_ledger collection.
   Calls callback on each new event matching the filter.
   Returns a watcher handle with close() method."
  [db filter callback]
  (let [id (generate-watcher-id)
        coll (db/collection db db/LEDGER_COLLECTION)
        pipeline (build-pipeline filter)
        opts {"fullDocument" "updateLookup"}
        ^js stream (if pipeline
                     (db/watch coll pipeline opts)
                     (db/watch coll [] opts))]
    (wire-callback stream id callback)
    (make-handle id stream filter)))

(defn watch-once
  "Open a temporary watcher that resolves on first matching event or times out.
   Returns a Promise that resolves with the event or nil on timeout."
  [db filter timeout-ms]
  (let [timeout-ms (or timeout-ms 30000)]
    (js/Promise.
      (fn [resolve]
        (let [resolved (atom false)
              handle (atom nil)
              watcher (watch-ledger
                        db filter
                        (fn [event]
                          (when-not @resolved
                            (reset! resolved true)
                            ((:close! @handle))
                            (resolve event))))]
          (reset! handle watcher)
          (js/setTimeout
            (fn []
              (when-not @resolved
                (reset! resolved true)
                ((:close! @handle))
                (resolve nil)))
            timeout-ms))))))

(defn close-watcher
  "Close a specific watcher by id."
  [id]
  (when-let [handle (get @watcher-registry id)]
    ((:close! handle))))

(defn close-all-watchers
  "Close all active watchers."
  []
  (doseq [[_id handle] @watcher-registry]
    ((:close! handle)))
  (reset! watcher-registry {}))

(defn cleanup-stale-watchers
  "Close watchers older than max-age-ms (default 60s).
   Calls close! on each, which removes from registry."
  ([] (cleanup-stale-watchers 60000))
  ([max-age-ms]
   (let [now (.now js/Date)]
     (doseq [[_id handle] @watcher-registry]
       (when (> (- now (.getTime ^js (:created-at handle))) max-age-ms)
         ((:close! handle)))))))

(defn ^:export watch-ledger-js
  "JS-compatible watchLedger."
  [db filter callback]
  (let [filter (db/to-clj filter)
        handle (watch-ledger db filter callback)]
    #js {"id" (:id handle)
         "close" (:close! handle)}))

(defn ^:export watch-once-js
  "JS-compatible watchOnce."
  [db filter timeout-ms]
  (let [filter (db/to-clj filter)]
    (watch-once db filter timeout-ms)))

(defn ^:export close-watcher-js
  "JS-compatible closeWatcher."
  [id]
  (close-watcher id))

(defn ^:export close-all-watchers-js
  "JS-compatible closeAllWatchers."
  []
  (close-all-watchers))
