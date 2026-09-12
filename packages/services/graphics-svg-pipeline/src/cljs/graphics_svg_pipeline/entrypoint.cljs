(ns graphics-svg-pipeline.entrypoint
  "shadow-cljs module entrypoint for the graphics-svg-pipeline service.

   Lifecycle:
   - shadow-cljs calls `init` on process start.
   - `stop-before-load!` / `start-after-load!` handle shadow-cljs hot-reload.
   - PM2 ready signal is sent after all subsystems are initialized."
  (:require [clojure.string :as str]
            [graphics-svg-pipeline.config :as config]
            [graphics-svg-pipeline.mcp-server :as mcp-server]))

(def ^:private !state
  "Mutable process-level state for hot-reload lifecycle."
  (atom nil))

(defn- notify-ready!
  "Send PM2 ready signal via process.send('ready')."
  []
  (let [send-fn (aget js/process "send")]
    (cond
      (fn? send-fn)
      (try
        (.call send-fn js/process "ready")
        (.log js/console "[graphics-svg-pipeline] sent pm2 ready signal")
        true
        (catch :default err
          (.warn js/console "[graphics-svg-pipeline] failed to send pm2 ready signal" err)
          false))

      :else
      (do
        (.log js/console "[graphics-svg-pipeline] process.send unavailable; skipping pm2 ready signal")
        false))))

(defn- ^:async connect-mongo!
  "Connect to MongoDB. Placeholder — will wire event-ledger store."
  [cfg]
  (.log js/console "[graphics-svg-pipeline] mongo connect placeholder"
        #js {:mongo-uri (:mongo-uri cfg)})
  ;; TODO: wire @promethean-os/event-ledger MongoStore
  nil)

(defn- start-watcher!
  "Start the filesystem watcher. Placeholder — will use chokidar."
  [cfg]
  (.log js/console "[graphics-svg-pipeline] watcher start placeholder"
        #js {:graphics-dir (:graphics-dir cfg)
             :inbox-dir (:inbox-dir cfg)})
  ;; TODO: chokidar watch on inbox-dir for new SVG files
  nil)

(defn- ^:async start-mcp-server!
  "Start the MCP server."
  [cfg]
  (await (mcp-server/start!)))

(defn ^:async init
  "shadow-cljs :init-fn. Parses config, connects MongoDB, starts watcher,
   starts MCP server, and sends PM2 ready signal."
  []
  (let [cfg (config/cfg)]
    (.log js/console "[graphics-svg-pipeline] starting"
          #js {:mongo-uri (:mongo-uri cfg)
               :mcp-port (:mcp-port cfg)
               :graphics-dir (:graphics-dir cfg)})
    (try
      (await (connect-mongo! cfg))
      (start-watcher! cfg)
      (start-mcp-server! cfg)
      (reset! !state {:cfg cfg})
      (notify-ready!)
      (catch :default err
        (.error js/console "[graphics-svg-pipeline] startup failed" err)
        (js/process.exit 1)))))

(defn ^:async stop-before-load!
  "shadow-cljs :before-load-async. Tears down watchers and servers before hot-reload."
  [done]
  (.log js/console "[graphics-svg-pipeline] hot-reload: stopping")
  (try
    (await (mcp-server/stop!))
    (catch :default err
      (.warn js/console "[graphics-svg-pipeline] hot-reload stop error" err)))
  (reset! !state nil)
  (done))

(defn ^:async start-after-load!
  "shadow-cljs :after-load-async. Restarts watchers and servers after hot-reload."
  [done]
  (.log js/console "[graphics-svg-pipeline] hot-reload: restarting")
  (let [cfg (config/cfg)]
    (try
      (await (connect-mongo! cfg))
      (start-watcher! cfg)
      (start-mcp-server! cfg)
      (reset! !state {:cfg cfg})
      (.log js/console "[graphics-svg-pipeline] hot-reload: restart complete")
      (catch :default err
        (.error js/console "[graphics-svg-pipeline] hot-reload restart failed" err))
      (finally (done)))))
