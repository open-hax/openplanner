(ns graphics-svg-pipeline.config
  "Environment variable parsing for the graphics-svg-pipeline service.

   Reads configuration from process.env at startup. No file-based config;
   this namespace is intentionally env-only."
  (:require [clojure.string :as str]))

(defn- env
  "Read a single env var with a default fallback."
  [k default]
  (or (aget js/process.env k) default))

(defn- env-int
  "Parse an env var as an integer, falling back to default on NaN."
  [k default]
  (let [raw (aget js/process.env k)
        parsed (js/parseInt (str (or raw "")) 10)]
    (if (js/Number.isFinite parsed)
      parsed
      default)))

(defn cfg
  "Read graphics-svg-pipeline runtime configuration from environment variables.

   Returns a map with all service config keys."
  []
  {:mongo-uri              (env "MONGO_URI" "mongodb://localhost:27017/graphics")
   :mcp-port               (env-int "MCP_PORT" 3000)
   :graphics-dir           (env "GRAPHICS_DIR" "/tmp/graphics")
   :inbox-dir              (env "INBOX_DIR" "/tmp/graphics/inbox")
   :puppeteer-executable-path (env "PUPPETEER_EXECUTABLE_PATH" "/usr/bin/chromium")
   :knoxx-api-url          (env "KNOXX_API_URL" "http://localhost:8000")
   :knoxx-api-key          (env "KNOXX_API_KEY" "")})
