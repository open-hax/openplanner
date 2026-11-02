(ns graphics-svg-pipeline.ledger
  "Event ledger integration for the graphics SVG pipeline.

   Dual storage strategy:
   - MongoDB (primary): uses @promethean-os/event-ledger appendEvent
   - EDN files (best-effort): appends events to Graphics/meta/**/*.edn

   Write order: MongoDB first (idempotent via event/id), EDN second
   (log failure but never rollback MongoDB).

   TTL asymmetry: MongoDB events have TTL (default 30 days, configurable
   per event type). EDN files have no expiration — they accumulate events
   that MongoDB has already purged. This is intentional: EDN files are a
   permanent git-traceable audit log."
  (:require
    ["node:crypto" :as crypto]
   ["node:fs" :as fs]
   ["node:path" :as path]
    [clojure.edn :as edn]
    [clojure.string :as str]
    [promethean.event-ledger.core :as ledger]))

(defn asset-uuid
  "Compute a deterministic UUID from a relative path using SHA-256.
   Returns a 36-character hex string (truncated to UUID-length)."
  [relative-path]
  (-> (crypto/createHash "sha256")
      (.update relative-path)
      (.digest "hex")
      (.slice 0 36)))

(defn- meta-path
  "Compute the EDN meta file path for a given relative SVG path.
   Graphics/foo.svg -> Graphics/meta/foo.svg.edn
   Graphics/seals/bar.svg -> Graphics/meta/seals/bar.svg.edn
   Graphics/.unrenderable/foo.svg -> Graphics/.unrenderable/foo.svg.errors.edn"
  [relative-path]
  (let [dir (path/dirname relative-path)
        base (path/basename relative-path)]
    (if (str/includes? dir ".unrenderable")
      (path/join dir (str base ".errors.edn"))
      (let [meta-dir (path/join dir "meta")]
        (path/join meta-dir (str base ".edn"))))))

(defn- ensure-dir!
  "Recursively create directories for the given file path."
  [file-path]
  (let [dir (path/dirname file-path)]
    (fs/mkdirSync dir #js {:recursive true})))

(defn- event->edn-str
  "Convert an event map to an EDN string suitable for appending."
  [event]
  (pr-str event))

(defn- append-edn!
  "Append an event to an EDN file. Best-effort: logs errors but does not throw."
  [file-path event]
  (try
    (ensure-dir! file-path)
    (let [edn-str (event->edn-str event)]
      (fs/appendFileSync file-path (str edn-str "\n") "utf8"))
    (catch :default err
      (.warn js/console "[graphics-svg-pipeline] EDN append failed"
             #js {:path file-path :error (.-message err)}))))

(defn- ^:async last-event-id-from-mongo
  "Query MongoDB for the most recent event with the given causal/root.
   Returns the event/id string, or nil if no events exist."
  [db causal-root]
  (try
    (let [coll (.collection db "event_ledger")
          cursor (.find coll #js {"causal/root" causal-root})
          sorted (.sort cursor #js {"event/time" -1})
          limited (.limit sorted 1)
          result (await (.toArray limited))]
      (when (pos? (.-length result))
        (aget (aget result 0) "event/id")))
    (catch :default err
      (.warn js/console "[graphics-svg-pipeline] last-event-id mongo query failed"
             (clj->js {:causal/root causal-root :error (.-message err)}))
      nil)))

(defn- last-event-id-from-edn
  "Parse the last S-expression from an EDN file to extract its event/id.
   Returns the event/id string, or nil if file doesn't exist or is empty."
  [file-path]
  (try
    (when (fs/existsSync file-path)
      (let [content (fs/readFileSync file-path "utf8")
            lines (str/split-lines (str/trim content))]
        (when (pos? (count lines))
          (let [last-line (last lines)
                parsed (edn/read-string last-line)]
            (:event/id parsed)))))
    (catch :default err
      (.warn js/console "[graphics-svg-pipeline] last-event-id EDN parse failed"
             #js {:path file-path :error (.-message err)})
      nil)))

(defn ^:async last-event-id
  "Query for the most recent event ID with the given causal/root.
   Tries MongoDB first, falls back to parsing the EDN file."
  [db causal-root & [{:keys [edn-path]}]]
  (or
    (await (last-event-id-from-mongo db causal-root))
    (when edn-path
      (last-event-id-from-edn edn-path))))

(def event-types
  "All valid event types for the graphics SVG pipeline."
  #{"graphics.svg.discovered"
    "graphics.svg.moved"
    "graphics.svg.validated"
    "graphics.svg.rendered"
    "graphics.svg.render_failed"
    "graphics.svg.quarantined"
    "graphics.svg.description"
    "graphics.svg.review"
    "graphics.svg.labels"
    "graphics.svg.kind"
    "graphics.svg.quality_score"
    "graphics.svg.notified"
    "graphics.svg.review_complete"})

(defn ^:async append-event!
  "Append an event to the graphics SVG ledger.

   Steps:
   1. Compute deterministic causal/root from relative-path
   2. Resolve causal/parent from last event (MongoDB or EDN)
   3. Call appendEvent on MongoDB (primary storage)
   4. Append to EDN file (best-effort, never rolls back MongoDB)

   Options:
   - :graphics-dir — base directory for Graphics/ (default: process.cwd())

   Returns the MongoDB ledger event."
   [db event-type relative-path payload & [{:keys [graphics-dir]}]]
   (let [base-dir (or graphics-dir (js/process.cwd))
         root-uuid (asset-uuid relative-path)
         edn-file (path/join base-dir (meta-path relative-path))
         parent-id (await (last-event-id db root-uuid {:edn-path edn-file}))
         envelope (cond-> {:event/type event-type
                           :causal/root root-uuid
                           :event/from {:actor-id "graphics-svg-pipeline"
                                        :actor-kind "service"}
                           :payload payload}
                    parent-id (assoc :causal/parent parent-id))
         mongo-result (try
                        (await (ledger/append-event db envelope))
                        (catch :default err
                          (.warn js/console "[graphics-svg-pipeline] MongoDB appendEvent failed"
                                 (clj->js {:causal/root root-uuid :error (.-message err)}))
                          nil))
         edn-envelope (or mongo-result
                          (assoc envelope
                            :event/id (asset-uuid (str root-uuid ":" (js/Date.now)))
                            :event/time (js/Date.now)))]
     (append-edn! edn-file edn-envelope)
     mongo-result))

(defn ^:async read-events
  "Read all events for a causal/root from the EDN file.
   Returns a vector of event maps, or empty vector if file doesn't exist."
  [relative-path & [{:keys [graphics-dir]}]]
  (let [base-dir (or graphics-dir (js/process.cwd))
        edn-file (path/join base-dir (meta-path relative-path))]
    (try
      (when (fs/existsSync edn-file)
        (let [content (fs/readFileSync edn-file "utf8")
              lines (str/split-lines (str/trim content))]
          (into []
            (comp
              (map str/trim)
              (remove str/blank?)
              (map edn/read-string))
            lines)))
      (catch :default err
        (.warn js/console "[graphics-svg-pipeline] read-events failed"
               #js {:path edn-file :error (.-message err)})
        []))))
