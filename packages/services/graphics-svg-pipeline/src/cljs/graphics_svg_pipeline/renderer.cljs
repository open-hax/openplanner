(ns graphics-svg-pipeline.renderer
  "SVG→PNG rendering via headless Chromium/Puppeteer.

   Keeps one browser process warm so repeated renders avoid cold-start cost.
   Uses puppeteer-core; configure via PUPPETEER_EXECUTABLE_PATH env var."
  (:require [clojure.string :as str]
            ["node:fs" :as fs]
            ["node:path" :as path]
            ["puppeteer-core" :as puppeteer-core]))

;; ============================================================================
;; Browser pool
;; ============================================================================

(defonce ^:private browser-atom (atom nil))
(defonce ^:private browser-promise-atom (atom nil))

(def ^:private chromium-candidate-paths
  ["/usr/bin/chromium"
   "/usr/bin/chromium-browser"
   "/usr/bin/google-chrome-stable"
   "/usr/bin/google-chrome"
   "/snap/bin/chromium"])

(defn- env-value
  "Read a non-blank env var value, or nil."
  [k]
  (let [v (aget js/process.env k)]
    (when (and (some? v) (not (str/blank? (str v))))
      (str v))))

(defn- existing-file?
  "Return true if path exists on disk."
  [p]
  (try
    (.existsSync fs p)
    (catch :default _false)))

(defn- executable-path
  "Resolve Chromium executable path from env or well-known locations."
  []
  (or (env-value "PUPPETEER_EXECUTABLE_PATH")
      (some #(when (existing-file? %) %) chromium-candidate-paths)))

(defn- puppeteer-module
  "Handle ESM/CJS interop for puppeteer-core."
  []
  (or (.-default puppeteer-core) puppeteer-core))

(defn- launch-options
  "Build Puppeteer launch options object."
  []
  (let [opts #js {:args #js ["--no-sandbox"
                             "--disable-setuid-sandbox"]}]
    (when-let [p (executable-path)]
      (aset opts "executablePath" p))
    opts))

(defn- remember-browser!
  "Store launched browser and clear pending promise."
  [browser]
  (reset! browser-atom browser)
  (reset! browser-promise-atom nil)
  browser)

(defn- forget-launch!
  "Clear pending promise and rethrow."
  [err]
  (reset! browser-promise-atom nil)
  (throw err))

(defn ^:async launch-browser!
  "Launch a new Chromium instance."
  []
  (try
    (remember-browser! (await (.launch (puppeteer-module) (launch-options))))
    (catch :default err
      (forget-launch! err))))

(defn ^:async get-browser
  "Return the warm browser instance, launching if needed. Promise-deduped."
  []
  (cond
    @browser-atom
    @browser-atom

    @browser-promise-atom
    (await @browser-promise-atom)

    :else
    (let [launch-promise (launch-browser!)]
      (reset! browser-promise-atom launch-promise)
      (await launch-promise))))

(defn ^:async shutdown!
  "Close the warm Chromium browser, if present."
  []
  (if-let [browser @browser-atom]
    (do
      (reset! browser-atom nil)
      (reset! browser-promise-atom nil)
      (try
        (await (.close browser))
        true
        (catch :default err
          (.warn js/console "[renderer] failed to close Chromium" err)
          false)))
    true))

;; ============================================================================
;; Viewport extraction
;; ============================================================================

(defn extract-viewport
  "Parse SVG string to extract dimensions.
   Priority: viewBox > width/height attrs > default 600x300.
   Clamped to 4096x4096 to prevent OOM."
  [svg-string]
  (let [viewbox-match (re-find #"viewBox=[\"']([^\"']+)[\"']" svg-string)
        width-match   (re-find #"width=[\"'](\d+)" svg-string)
        height-match  (re-find #"height=[\"'](\d+)" svg-string)]
    (if viewbox-match
      (let [parts (str/split (nth viewbox-match 1) #"\s+")
            w (js/parseInt (nth parts 2 "600") 10)
            h (js/parseInt (nth parts 3 "300") 10)]
        {:width  (min 4096 w)
         :height (min 4096 h)})
      {:width  (min 4096 (or (some-> width-match second js/parseInt) 600))
       :height (min 4096 (or (some-> height-match second js/parseInt) 300))})))

;; ============================================================================
;; Output path mapping
;; ============================================================================

(defn render-output-path
  "Map an SVG input path to its PNG output path under graphics-dir/renders/.
   Preserves subdirectory structure relative to graphics-dir."
  [svg-path graphics-dir]
  (let [relative (path/relative graphics-dir svg-path)]
    (path/join graphics-dir "renders"
              (str/replace relative #"\.svg$" ".png"))))

;; ============================================================================
;; Render timeout
;; ============================================================================

(def ^:private render-timeout-ms
  "Maximum ms to wait for a single render."
  15000)

(def ^:private navigation-timeout-ms
  "Puppeteer page navigation timeout."
  10000)

(defn- timeout-promise
  "Return a promise that rejects after ms milliseconds."
  [ms label]
  (js/Promise.
   (fn [_reject]
     (js/setTimeout
      (fn [] (_reject (js/Error. (str "[renderer] " label " timed out after " ms "ms"))))
      ms))))

;; ============================================================================
;; SVG → PNG
;; ============================================================================

(defn- svg-document
  "Wrap SVG string in minimal HTML for Puppeteer setContent."
  [svg-string]
  (str "<!doctype html>"
       "<html><head><meta charset='utf-8'></head>"
       "<body style='margin:0;padding:0;background:transparent'>"
       svg-string
       "</body></html>"))

(defn- ensure-dir!
  "Create parent directories for a file path if needed."
  [file-path]
  (let [dir (path/dirname file-path)]
    (when-not (.existsSync fs dir)
      (.mkdirSync fs dir #js {:recursive true}))))

(defn ^:async browser-alive?
  "Return true if the browser is still responsive."
  [browser]
  (try
    (await (.pages browser))
    true
    (catch :default _false)))

(defn ^:async recover-browser!
  "Discard stale browser and relaunch."
  []
  (reset! browser-atom nil)
  (reset! browser-promise-atom nil)
  (await (get-browser)))

(defn ^:async svg->png
  "Render an SVG string to PNG Buffer via headless Chromium.
   Returns render metadata map."
  [svg-string svg-path graphics-dir]
  (let [start-ms (.now js/Date)
        viewport  (extract-viewport svg-string)
        width     (:width viewport)
        height    (:height viewport)
        out-path  (render-output-path svg-path graphics-dir)]
    (try
      (let [browser (await (get-browser))
            ;; Crash recovery: test browser liveness
            browser (if (await (browser-alive? browser))
                      browser
                      (await (recover-browser!)))
            page    (await (.newPage browser))]
        (try
          (.setDefaultNavigationTimeout page navigation-timeout-ms)
          (await (.setViewport page #js {:width width :height height}))
          (await (.setJavaScriptEnabled page false))
          (let [render-promise
                (.then
                 (.setContent page (svg-document svg-string) #js {:waitUntil "networkidle0"})
                 (fn []
                   (.then (.$ page "svg")
                          (fn [element]
                            (if element
                              (.screenshot element #js {:type "png" :omitBackground true})
                              (throw (js/Error. "No <svg> element found")))))))
                png-buffer (await (js/Promise.race
                                   #js [render-promise
                                        (timeout-promise render-timeout-ms "render")]))]
            (ensure-dir! out-path)
            (.writeFileSync fs out-path png-buffer)
            (let [elapsed (- (.now js/Date) start-ms)
                  stats   (.statSync fs out-path)]
              {:render/success?   true
               :render/input-path svg-path
               :render/output-path out-path
               :render/width      width
               :render/height     height
               :render/bytes      (.-size stats)
               :render/time-ms    elapsed}))
          (finally
            (.close page))))
      (catch :default err
        {:render/success? false
         :render/error    (.-message err)}))))
