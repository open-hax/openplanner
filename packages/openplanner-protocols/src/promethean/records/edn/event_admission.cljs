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
  (str (pr-str event) "\n"))

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

(defn- ^:async read-file-for-watch [file-path callback filter-spec]
  (let [watcher (.watch fs file-path)
        pred (when (seq filter-spec)
               (fn [event]
                 (every? (fn [[k v]] (= (get event k) v)) filter-spec)))]
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

  (append-events! [this envelopes]
    (-> ((:acquire! mutex))
        (.then (fn [_]
                 (let [results (atom [])]
                   (-> (reduce
                         (fn [acc env]
                           (.then acc
                             (fn [_]
                               ;; Enrich once so the persisted line and the
                               ;; returned envelope share the same generated
                               ;; ids/timestamps/causal-root/session-id.
                               (let [enriched (ensure-defaults env)]
                                 (-> (append-to-file! file-path (event->edn-str enriched))
                                     (.then (fn [_]
                                              (swap! results conj enriched))))))))
                         (js/Promise.resolve nil)
                         envelopes)
                       (.then (fn [_] (clj->js @results)))))))
        (.finally (fn [] ((:release! mutex))))))

  (query-events [_ filter-spec]
    (-> (read-events file-path)
        (.then (fn [events]
                 (if (empty? filter-spec)
                   events
                   (let [pred (fn [event]
                                (every? (fn [[k v]]
                                          (= (get event k) v))
                                        filter-spec))]
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
