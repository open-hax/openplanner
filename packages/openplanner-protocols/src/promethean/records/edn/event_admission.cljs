(ns promethean.records.edn.event-admission
  "EDN file-backed implementation of EventAdmission protocol.
   Append-only EDN file, one event per line. No MongoDB dependency.
   Uses an async mutex for concurrent write safety."
  (:require [promethean.openplanner-protocols :as protocols]
            [cljs.reader :as reader]
            ["fs" :as fs]
            ["fs/promises" :as fsp]
            ["path" :as path]))

;; ---------------------------------------------------------------------------
;; Helpers
;; ---------------------------------------------------------------------------

(defn- now-iso [] (.toISOString (js/Date.)))

(defn- ensure-defaults [env]
  (cond-> env
    (not (:event/id env)) (assoc :event/id (str (random-uuid)))
    (not (:event/time env)) (assoc :event/time (now-iso))
    (not (:causal/root env)) (assoc :causal/root (str (random-uuid)))
    (not (:session/id env)) (assoc :session/id (str (random-uuid)))
    (not (:delivery/mode env)) (assoc :delivery/mode "tell")))

(defn- event->edn-str [event]
  (when-not (:valid (protocols/validate-envelope event))
    (throw (js/Error. "Invalid event envelope")))
  (let [encoded (pr-str event)
        decoded (try (reader/read-string encoded)
                     (catch :default _ ::unreadable))]
    (when-not (= event decoded)
      (throw (js/Error. "Event must round-trip through EDN")))
    (str encoded "\n")))

(defn- parse-edn-line [line]
  (try
    (reader/read-string line)
    (catch :default err
      (js/console.warn "[edn-event-admission] failed to parse EDN line:" (pr-str line) err)
      nil)))

;; ---------------------------------------------------------------------------
;; Async Mutex (simple atom-based lock with queue)
;; ---------------------------------------------------------------------------

(defn- create-mutex []
  (let [state (atom {:locked false :queue []})]
    {:acquire! (fn []
                 (js/Promise.
                   (fn [resolve _reject]
                     (let [resolve-now? (atom false)]
                       (swap! state
                         (fn [s]
                           (if (:locked s)
                             ;; Already locked — enqueue this resolver
                             (update s :queue conj resolve)
                             ;; Not locked — acquire immediately
                             (do (reset! resolve-now? true)
                                 (assoc s :locked true)))))
                       ;; Resolve outside swap to avoid races
                       (when @resolve-now?
                         (resolve))))))

     :release! (fn []
                 (let [next-fn (atom nil)]
                   (swap! state (fn [s]
                                  (if (empty? (:queue s))
                                    (assoc s :locked false)
                                    (let [next (first (:queue s))]
                                      (reset! next-fn next)
                                      (assoc s :queue (vec (rest (:queue s))))))))
                   (when @next-fn (@next-fn))))}))

;; ---------------------------------------------------------------------------
;; File operations
;; ---------------------------------------------------------------------------

(defn- ^:async read-events [file-path]
  (try
    (let [content (await (fsp/readFile file-path "utf8"))
          lines (-> content (.split "\n") (js->clj))]
      (->> lines
           (mapv parse-edn-line)
           (filterv some?)))
    (catch :default e
      (if (= "ENOENT" (.-code e))
        []
        (throw e)))))

(defn- ^:async append-to-file! [file-path event-str]
  (await (fsp/appendFile file-path event-str "utf8")))

(defn- comparable-value [value]
  (cond
    (map? value) (reduce-kv (fn [m k v]
                              (assoc m (if (keyword? k) (subs (str k) 1) (str k))
                                     (comparable-value v))) {} value)
    (sequential? value) (mapv comparable-value value)
    :else value))

(defn- matches-filter? [event filter-spec]
  (every? (fn [[k v]] (= (comparable-value (get event k)) (comparable-value v)))
          filter-spec))

(defn- read-file-for-watch [file-path callback filter-spec]
  (let [watcher (.watch fs file-path)
        pred (when (seq filter-spec)
               (fn [event] (matches-filter? event filter-spec)))]
    (.on watcher "change"
         (fn [_event-type _filename]
           (-> (read-events file-path)
               (.then (fn [events]
                        (when (seq events)
                          (let [last-event (last events)]
                            (when (or (nil? pred) (pred last-event))
                              (callback last-event))))))
               (.catch (fn [e] (js/console.error "EDN watch error:" e))))))
    {:id (str (random-uuid))
     :close! (fn [] (.close watcher))}))

;; ---------------------------------------------------------------------------
;; EdnFileEventAdmission record
;; ---------------------------------------------------------------------------

(defrecord EdnFileEventAdmission [file-path mutex]
  protocols/EventAdmission

  (append-event! [_ envelope]
    (let [env (ensure-defaults envelope)
          event-str (event->edn-str env)]
      ;; `mutex` is the Clojure map returned by `create-mutex`, so call its
      ;; :acquire!/:release! fns directly — JS interop (.acquire!) would look for a
      ;; non-existent `acquire_BANG_` property and the append would never run.
      (-> ((:acquire! mutex))
          (.then (fn [_]
                   (-> (append-to-file! file-path event-str)
                       (.then (fn [_] env)))))
          (.finally (fn [] ((:release! mutex)))))))

  (append-events! [_ envelopes]
    ;; Validate every event before the first write so an invalid later item
    ;; cannot leave a partially admitted batch.
    (let [prepared (mapv (fn [env]
                           (let [event (ensure-defaults env)]
                             {:event event :line (event->edn-str event)}))
                         envelopes)]
      (-> ((:acquire! mutex))
          (.then (fn [_]
                   (-> (reduce (fn [acc {:keys [line]}]
                                 (.then acc (fn [_] (append-to-file! file-path line))))
                               (js/Promise.resolve nil)
                               prepared)
                       (.then (fn [_] (mapv :event prepared))))))
          (.finally (fn [] ((:release! mutex)))))))

  (query-events [_ filter-spec]
    (-> (read-events file-path)
        (.then (fn [events]
                 (if (empty? filter-spec)
                   events
                   (let [pred (fn [event] (matches-filter? event filter-spec))]
                     (filterv pred events)))))))

  (watch-events [_ filter-spec callback]
    (read-file-for-watch file-path callback filter-spec)))

;; ---------------------------------------------------------------------------
;; Factory
;; ---------------------------------------------------------------------------

(defn ^:export create-edn-event-admission
  "Create an EDN file-backed EventAdmission instance.
   ledger-path should be a directory; events are stored in ledger.edn inside it."
  [ledger-dir]
  (let [file-path (path/join ledger-dir "ledger.edn")]
    ;; Synchronous mkdir keeps this factory non-async (callers use the return
    ;; value as the admission instance, not a promise) and avoids a race where
    ;; the first append fires before the directory exists.
    (.mkdirSync fs ledger-dir #js {:recursive true})
    ;; Touch ledger.edn so a caller can `watch-events` before the first append —
    ;; `fs.watch` throws ENOENT on a non-existent target. Opening with the "a"
    ;; flag creates the file when missing without truncating an existing ledger.
    (.closeSync fs (.openSync fs file-path "a"))
    (->EdnFileEventAdmission file-path (create-mutex))))


(defn- normalize-envelope [value batch?]
  (protocols/reject-unsupported! value (js/WeakSet.))
  (let [data (protocols/normalize-js value)]
    (if batch?
      (if (vector? data)
        (mapv protocols/normalize-event data)
        (throw (js/Error. "Batch must be an array")))
      (protocols/normalize-event data))))

(defn- append-js! [admission operation value batch?]
  ;; Defer conversion and validation so errors reject the advertised Promise.
  (-> (js/Promise.resolve nil)
      (.then (fn [_] (operation admission (normalize-envelope value batch?))))
      (.then protocols/to-js)))

(defn- normalize-filter [value]
  (protocols/reject-unsupported! value (js/WeakSet.))
  (protocols/normalize-event (protocols/normalize-js value)))

(defn ^:export create-edn-event-admission-js [ledger-dir]
  (let [admission (create-edn-event-admission ledger-dir)]
    #js {"append-event!" (fn [envelope]
                            (append-js! admission protocols/append-event! envelope false))
         "append-events!" (fn [envelopes]
                             (append-js! admission protocols/append-events! envelopes true))
         "query-events" (fn [filter-spec]
                           (-> (js/Promise.resolve nil)
                               (.then (fn [_] (protocols/query-events admission (normalize-filter filter-spec))))
                               (.then protocols/to-js)))
         "watch-events" (fn [filter-spec callback]
                           (let [handle (protocols/watch-events admission (normalize-filter filter-spec)
                                                                 #(callback (protocols/to-js %)))]
                             #js {"close" (:close! handle)}))}))
