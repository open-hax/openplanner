(ns graphics-svg-pipeline.mcp-server
  "MCP server exposing 7 tools for SVG review via Streamable HTTP transport."
  (:require [clojure.string :as str]
            [graphics-svg-pipeline.config :as config]
            [graphics-svg-pipeline.ledger :as ledger]
            ["@modelcontextprotocol/sdk/server/mcp.js" :refer [McpServer]]
            ["@modelcontextprotocol/sdk/server/streamableHttp.js" :refer [StreamableHTTPServerTransport]]
            ["node:fs/promises" :as fsp]
            ["node:path" :as path]
            ["node:http" :as http]
            ["zod" :refer [z]]))

(defonce ^:private server-state* (atom nil))

(def ^:private required-review-types
  #{"graphics.svg.description"
    "graphics.svg.review"
    "graphics.svg.labels"
    "graphics.svg.kind"
    "graphics.svg.quality_score"})

(defn- env [k default]
  (or (aget js/process.env k) default))

(defn- safe-path
  "Resolve a relative path against graphics-dir. Reject paths that escape."
  [graphics-dir relative-path]
  (when (or (str/blank? relative-path)
            (str/includes? relative-path "..")
            (str/starts-with? relative-path "/"))
    (throw (js/Error. (str "Invalid path: " relative-path))))
  (let [resolved (path/resolve graphics-dir relative-path)]
    (when-not (str/starts-with? resolved (path/resolve graphics-dir))
      (throw (js/Error. (str "Path escapes graphics directory: " relative-path))))
    resolved))

(defn ^:async check-completion
  "Check if all 5 required review event types exist for a causal_root."
  [causal-root graphics-dir]
  (let [events (await (ledger/read-events causal-root {:graphics-dir graphics-dir}))
        present (into #{} (map :event/type) events)
        missing (into [] (remove present) required-review-types)]
    {:complete? (empty? missing)
     :missing missing}))

(defn- handle-submit
  "Common handler for submit tools. Appends event, checks completion."
  [event-type graphics-dir causal-root relative-path payload]
  (-> (ledger/append-event! nil event-type relative-path payload {:graphics-dir graphics-dir})
      (.then
        (fn [_]
          (-> (check-completion causal-root graphics-dir)
              (.then
                (fn [status]
                  (if (:complete? status)
                    #js {:content #js [#js {:type "text" :text "ok - review complete"}]}
                    #js {:content #js [#js {:type "text" :text "ok"}]}))))))
      (.catch
        (fn [err]
          #js {:content #js [#js {:type "text" :text (str "Error: " (.-message err))}]
               :isError true}))))

(defn- register-tools!
  "Register all 7 MCP tools on the server."
  [^js server graphics-dir]
  (let [str-schema (.string z)
        num-schema (.number z)
        causal-root-schema str-schema
        path-schema str-schema
        desc-schema (-> z (.string) (.min 1))
        verdict-schema (-> z (.enum #js ["approve" "request_changes"]))
        labels-schema (-> z (.array str-schema) (.min 1))
        kind-schema (-> z (.enum #js ["seal" "logo" "cert" "badge" "meter" "icon" "diagram" "other"]))
        score-schema (-> z (.number) (.int) (.min 1) (.max 10))]

  (.registerTool server "view_svg_raw"
    #js {:title "View SVG Raw"
         :description "Read and return the raw SVG source content"
         :inputSchema #js {:path str-schema}}
    (fn [params]
      (let [p (aget params "path")
            abs (safe-path graphics-dir p)]
        (-> (fsp/readFile abs "utf8")
            (.then (fn [content] #js {:content #js [#js {:type "text" :text content}]}))
            (.catch (fn [err] #js {:content #js [#js {:type "text" :text (str "Error: " (.-message err))}] :isError true}))))))
  (.registerTool server "view_rendered"
    #js {:title "View Rendered PNG"
         :description "Read the rendered PNG and return as base64 data URI"
         :inputSchema #js {:path str-schema}}
    (fn [params]
      (let [p (aget params "path")
            render-path (str/replace (safe-path graphics-dir p) #"\.svg$" ".png")]
        (-> (fsp/readFile render-path)
            (.then (fn [buf] (let [b64 (.toString buf "base64")] #js {:content #js [#js {:type "image" :data b64 :mimeType "image/png"}]})))
            (.catch (fn [err] #js {:content #js [#js {:type "text" :text (str "Error: " (.-message err))}] :isError true}))))))
  (.registerTool server "submit_description"
    #js {:title "Submit Description"
         :description "Submit a text description of the SVG"
         :inputSchema #js {:causal_root causal-root-schema :path path-schema :description desc-schema}}
    (fn [params]
      (let [cr (aget params "causal_root") p (aget params "path") desc (aget params "description")]
        (handle-submit "graphics.svg.description" graphics-dir cr p {:path p :description desc}))))
  (.registerTool server "submit_review"
    #js {:title "Submit Review"
         :description "Submit a review verdict (approve or request_changes)"
         :inputSchema #js {:causal_root causal-root-schema :path path-schema :verdict verdict-schema :comments str-schema}}
    (fn [params]
      (let [cr (aget params "causal_root") p (aget params "path") v (aget params "verdict") c (aget params "comments")]
        (handle-submit "graphics.svg.review" graphics-dir cr p {:path p :verdict v :comments c}))))
  (.registerTool server "submit_labels"
    #js {:title "Submit Labels"
         :description "Submit classification labels for the SVG"
         :inputSchema #js {:causal_root causal-root-schema :path path-schema :labels labels-schema}}
    (fn [params]
      (let [cr (aget params "causal_root") p (aget params "path") labels (vec (array-seq (aget params "labels")))]
        (handle-submit "graphics.svg.labels" graphics-dir cr p {:path p :labels labels}))))
  (.registerTool server "submit_kind"
    #js {:title "Submit Kind"
         :description "Submit the asset kind"
         :inputSchema #js {:causal_root causal-root-schema :path path-schema :kind kind-schema}}
    (fn [params]
      (let [cr (aget params "causal_root") p (aget params "path") k (aget params "kind")]
        (handle-submit "graphics.svg.kind" graphics-dir cr p {:path p :kind k}))))
  (.registerTool server "submit_quality_score"
    #js {:title "Submit Quality Score"
         :description "Submit a quality score from 1 (worst) to 10 (best)"
         :inputSchema #js {:causal_root causal-root-schema :path path-schema :score score-schema}}
    (fn [params]
      (let [cr (aget params "causal_root") p (aget params "path") s (aget params "score")]
        (handle-submit "graphics.svg.quality_score" graphics-dir cr p {:path p :score s}))))))

(defn- transport-handle-request! [^js transport req res]
  (.handleRequest transport req res))

(defn- create-http-handler
  "Create HTTP request handler for MCP Streamable HTTP + health endpoint."
  [graphics-dir token]
  (fn [^js req ^js res]
    (let [url (.-url req) method (.-method req)]
      (cond
        (and (= method "GET") (= url "/health"))
        (do (.writeHead res 200 #js {"Content-Type" "application/json"})
            (.end res (js/JSON.stringify #js {:status "ok" :tools 7})))

        (and (= method "POST") (= url "/mcp"))
        (let [auth-header (or (aget (.-headers req) "authorization") "")
              match (.match auth-header (js/RegExp. "^Bearer\\s+(.+)$" "i"))]
          (if (and match (= (str/trim (aget match 1)) token))
            (let [server (new McpServer #js {:name "graphics-svg-pipeline" :version "0.1.0"})
                  transport (new StreamableHTTPServerTransport #js {:sessionIdGenerator js/undefined})]
              (register-tools! server graphics-dir)
              (-> (.connect server transport)
                  (.then (fn [_] (transport-handle-request! transport req res)))
                  (.catch (fn [err]
                            (.writeHead res 500 #js {"Content-Type" "application/json"})
                            (.end res (js/JSON.stringify #js {:error (.-message err)}))))))
            (do (.writeHead res 401 #js {"WWW-Authenticate" "Bearer" "Content-Type" "text/plain"})
                (.end res "Unauthorized"))))

        :else
        (do (.writeHead res 404 #js {"Content-Type" "text/plain"})
            (.end res "Not Found"))))))

(defn ^:async start!
  "Start the MCP HTTP server. Returns the server instance."
  []
  (let [cfg (config/cfg)
        port (:mcp-port cfg)
        host "127.0.0.1"
        graphics-dir (:graphics-dir cfg)
        token (env "GRAPHICS_MCP_TOKEN" "")
        handler (create-http-handler graphics-dir token)
        srv (http/createServer handler)]
    (when (str/blank? token)
      (.warn js/console "[graphics-svg-pipeline] GRAPHICS_MCP_TOKEN not set"))
    (js/Promise.
      (fn [resolve reject]
        (.on srv "error" reject)
        (.listen srv port host
          (fn []
            (.removeListener srv "error" reject)
            (.log js/console "[graphics-svg-pipeline] MCP server listening"
                  #js {:host host :port port :tools 7})
            (reset! server-state* srv)
            (resolve srv)))))))

(defn ^:async stop!
  "Stop the MCP HTTP server."
  []
  (when-let [srv @server-state*]
    (-> (.close srv)
        (.then (fn [_]
                 (.log js/console "[graphics-svg-pipeline] MCP server stopped")
                 (reset! server-state* nil)))
        (.catch (fn [err]
                  (.warn js/console "[graphics-svg-pipeline] MCP server stop error" err)
                  (reset! server-state* nil))))))
