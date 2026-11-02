(ns graphics-svg-pipeline.quarantine
  "Quarantine logic for invalid SVGs.

   Moves rejected SVGs to GRAPHICS_DIR/.unrenderable/ and writes
   machine-readable .errors.edn alongside each file."
  (:require [clojure.string :as str]
            ["node:fs" :as fs]
            ["node:path" :as path]))

(defn- ensure-dir!
  "Ensure `dir` exists (recursive mkdirSync)."
  [dir]
  (.mkdirSync fs dir #js {:recursive true}))

(defn- quarantine-dir
  "Return the .unrenderable directory under `graphics-dir`."
  [graphics-dir]
  (path/join graphics-dir ".unrenderable"))

(defn quarantine-svg!
  "Move an SVG file to the quarantine directory and write an errors EDN file.
   Returns the quarantine path. Side-effecting."
  [graphics-dir filename svg-content validation-result]
  (let [q-dir (quarantine-dir graphics-dir)
        dest (path/join q-dir filename)
        errors-path (str dest ".errors.edn")]
    (ensure-dir! q-dir)
    ;; Write SVG to quarantine
    (.writeFileSync fs dest (str svg-content) "utf-8")
    ;; Write errors EDN
    (let [edn-str (pr-str {:filename filename
                           :errors (:errors validation-result)
                           :quarantined-at (js/Date.)})]
      (.writeFileSync fs errors-path edn-str "utf-8"))
    dest))
