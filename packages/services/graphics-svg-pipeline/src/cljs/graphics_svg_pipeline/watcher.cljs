(ns graphics-svg-pipeline.watcher
  "Chokidar-based file watcher for SVG pipeline.

   Watches two roots:
   1. GRAPHICS_DIR parent (devel/) — recursively, excluding inbox/
   2. INBOX_DIR — directly

   On add/change, atomically moves SVGs into GRAPHICS_DIR with dedup
   and collision handling."
  (:require [clojure.string :as str]))

(def fs (js/require "node:fs/promises"))
(def path (js/require "node:path"))
(def chokidar (js/require "chokidar"))
(def crypto (js/require "node:crypto"))

(def ^:private dedup-ttl-ms 5000)
(def ^:private dedup-set (js/Set.))
(def ^:private dedup-timers (js/Map.))

(defn- now-ms [] (.now js/Date))

(defn- sha256-hex
  "Compute SHA-256 hex digest of a UTF-8 string."
  [^string content]
  (-> (.createHash crypto "sha256")
      (.update content "utf8")
      (.digest "hex")))

(defn- add-to-dedup!
  "Add path to dedup set with TTL expiry."
  [^string file-path]
  (.add dedup-set file-path)
  (when-let [existing-timer (.get dedup-timers file-path)]
    (js/clearTimeout existing-timer))
  (.set dedup-timers file-path
        (js/setTimeout (fn []
                         (.delete dedup-set file-path)
                         (.delete dedup-timers file-path))
                       dedup-ttl-ms)))

(defn- dedup?
  "Returns true if path was recently processed (within TTL)."
  [^string file-path]
  (.has dedup-set file-path))

(defn resolve-target-path
  "Map a source file path to its target path under graphics-dir.

   - inbox files: strip inbox prefix
   - devel root files: strip devel prefix (parent of inbox-dir)
   - out-of-root: throws"
  [^string file-path ^string graphics-dir ^string inbox-dir]
  (let [devel-dir (.dirname path inbox-dir)]
    (cond
      (.startsWith file-path inbox-dir)
      (.join path graphics-dir (.relative path inbox-dir file-path))

      (.startsWith file-path devel-dir)
      (.join path graphics-dir (.relative path devel-dir file-path))

      :else
      (throw (js/Error. (str "File outside watch roots: " file-path))))))

(defn- file-exists?
  "Returns true if path exists (async)."
  [^string p]
  (-> (.access fs p)
      (.then (fn [] true))
      (.catch (fn [_] false))))

(defn- read-file-utf8
  "Read file as UTF-8 string. Returns nil on ENOENT."
  [^string p]
  (-> (.readFile fs p "utf8")
      (.catch (fn [err]
                (if (= (.-code err) "ENOENT")
                  nil
                  (throw err))))))

(defn- resolve-collision
  "If target exists with different content, append -v2, -v3, etc."
  [^string target-path ^string content]
  (-> (read-file-utf8 target-path)
      (.then (fn [existing]
               (if (or (nil? existing) (= existing content))
                 target-path
                 (let [ext (.extname path target-path)
                       base (.slice target-path 0 (- (.-length target-path) (.-length ext)))
                       try-version (fn try-version [n]
                                     (let [candidate (str base "-v" n ext)]
                                       (-> (file-exists? candidate)
                                           (.then (fn [exists?]
                                                    (if-not exists?
                                                      candidate
                                                      (-> (read-file-utf8 candidate)
                                                          (.then (fn [c]
                                                                   (if (= c content)
                                                                     candidate
                                                                     (try-version (inc n))))))))))))]
                   (try-version 2)))))))

(defn ^:async atomic-move
  "Atomically move src to dest. Falls back to copy+unlink on EXDEV."
  [^string src ^string dest]
  (try
    (await (.rename fs src dest))
    (catch :default err
      (if (= (.-code err) "EXDEV")
        (do (await (.copyFile fs src dest))
            (await (.unlink fs src)))
        (throw err)))))

(defn- ensure-dir!
  "Create directory recursively if it doesn't exist."
  [^string dir-path]
  (.mkdir fs dir-path #js {:recursive true}))

(defn- ^:async process-file!
  "Handle an add/change event: read, resolve target, move, emit event."
  [^string file-path ^string graphics-dir ^string inbox-dir emit-fn]
  (when-not (dedup? file-path)
    (add-to-dedup! file-path)
    (try
      (let [content (await (read-file-utf8 file-path))]
        (when content
          (let [target (resolve-target-path file-path graphics-dir inbox-dir)]
            (when-not (.startsWith target (.join path graphics-dir "renders"))
              (let [target-existed? (await (file-exists? target))
                    final-target (await (resolve-collision target content))
                    _ (await (ensure-dir! (.dirname path final-target)))
                    _ (await (atomic-move file-path final-target))]
                (emit-fn {:type (if target-existed? :svg/changed :svg/added)
                          :source file-path
                          :target final-target
                          :ts (now-ms)}))))))
      (catch :default err
        (when (not= (.-code err) "ENOENT")
          (.error js/console "[watcher] process-file error" err))))))


(defn- make-ignored-patterns
  "Build chokidar ignored array: dotfiles + non-SVG files."
  []
  #js [(re-pattern "(^|[\\/\\\\])\\.")  ;; dotfiles
       (re-pattern ".*((?!\\.svg$)).*$") ;; non-SVG
       ])

(defn- make-chokidar-opts
  "Base chokidar options."
  []
  #js {:ignoreInitial true
       :awaitWriteFinish #js {:stabilityThreshold 200
                              :pollInterval 50}
       :ignored (make-ignored-patterns)})

(defn- watch-root!
  "Create a chokidar watcher for a directory with given options."
  [^string dir opts emit-fn]
  (let [watcher (.watch chokidar dir opts)]
    (.on watcher "add" emit-fn)
    (.on watcher "change" emit-fn)
    (.on watcher "error"
         (fn [err]
           (.error js/console "[watcher] chokidar error" err)))
    watcher))

(defn start!
  "Start both file watchers. Returns a stop function.

   - devel-watcher: watches graphics-dir parent, excludes inbox
   - inbox-watcher: watches inbox-dir directly

   emit-fn receives event maps: {:type :svg/added|:svg/changed, :source, :target, :ts}"
  [^string graphics-dir ^string inbox-dir emit-fn]
  (let [devel-dir (.dirname path inbox-dir)
        devel-opts (make-chokidar-opts)
        inbox-opts (make-chokidar-opts)

        ;; Add inbox exclusion to devel watcher
        _ (aset devel-opts "ignored"
                (.concat (aget devel-opts "ignored")
                         #js [(re-pattern (str "^" (.replace inbox-dir #"[.*+?^${}()|[\\]\\\\]" "\\$&")))]))

        handle-file (fn [p] (process-file! (str p) graphics-dir inbox-dir emit-fn))

        devel-watcher (watch-root! devel-dir devel-opts handle-file)
        inbox-watcher (watch-root! inbox-dir inbox-opts handle-file)]

    (.log js/console "[watcher] started"
          #js {:devel-dir devel-dir
               :inbox-dir inbox-dir
               :graphics-dir graphics-dir})

    ;; Return stop function
    (fn []
      (.close devel-watcher)
      (.close inbox-watcher)
      (.clear dedup-timers)
      (.clear dedup-set)
      (.log js/console "[watcher] stopped"))))
