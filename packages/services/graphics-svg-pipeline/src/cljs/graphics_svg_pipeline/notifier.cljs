(ns graphics-svg-pipeline.notifier
  "Session notifier for incomplete SVG reviews.

   After each MCP submit tool call, checks which of the 5 required review
   event types are present for a causal_root. If any are missing, dispatches
   a notification via knoxx's event dispatch API.

   Debounce: checks for a graphics.svg.notified event within the last 30s
   before sending. Persists debounce state in the ledger.

   Periodic re-check: start-recheck-loop! scans for incomplete reviews
   every 60s and notifies if debounce allows."
  (:require [clojure.string :as str]
            [graphics-svg-pipeline.config :as config]
            [graphics-svg-pipeline.ledger :as ledger]
            ["node:https" :as https]
            ["node:http" :as http]))

(def ^:private required-review-types
  #{"graphics.svg.description"
    "graphics.svg.review"
    "graphics.svg.labels"
    "graphics.svg.kind"
    "graphics.svg.quality_score"})

(def ^:private debounce-ms 30000)

(defonce ^:private recheck-timer* (atom nil))

(defn- env [k default]
  (or (aget js/process.env k) default))

(defn- format-missing-message
  "Format a human-readable incomplete review message."
  [path present-types missing-types]
  (let [status (fn [t] (if (contains? present-types t) "  ✓ " "  ✗ "))
        names {"graphics.svg.description" "description"
               "graphics.svg.review" "review"
               "graphics.svg.labels" "labels"
               "graphics.svg.kind" "kind"
               "graphics.svg.quality_score" "quality_score"}
        lines (map (fn [t] (str (status t) (get names t t))) (sort required-review-types))
        missing-names (map #(get names % %) missing-types)
        tool-names (map #(str "mcp.graphics-svg-pipeline.submit_" (get names % %)) missing-types)]
    (str "Review incomplete for " path ".\n\n"
         "Submitted:\n" (str/join "\n" lines) "\n\n"
         "Missing: " (str/join ", " missing-names) ". "
         "Use " (str/join " and " tool-names) " to complete the review.")))

(defn- ^:async dispatch-notification!
  "Send notification via knoxx event dispatch API."
  [config causal-root path missing-fields session-id conversation-id]
  (let [api-url (:knoxx-api-url config)
        api-key (:knoxx-api-key config)
        present (clojure.set/difference required-review-types (set missing-fields))
        message (format-missing-message path present (set missing-fields))
        body {:event_type "graphics.svg.review_incomplete"
              :source "graphics-svg-pipeline"
              :target_actor "chat_primary"
              :text message
              :metadata {:causal_root causal-root
                         :missing_fields missing-fields}}
        body-with-session (cond-> body
                            session-id (assoc :target_session session-id)
                            conversation-id (assoc :target_conversation conversation-id))
        url (js/URL. (str api-url "/api/admin/config/events/dispatch"))
        is-https (= (.-protocol url) "https:")
        transport (if is-https https http)
        body-str (js/JSON.stringify (clj->js body-with-session))
        opts #js {:hostname (.-hostname url)
                  :port (or (.-port url) (if is-https 443 80))
                  :path (.-pathname url)
                  :method "POST"
                  :headers #js {"Content-Type" "application/json"
                                "Content-Length" (.-length body-str)
                                "X-API-Key" api-key}}]
    (js/Promise.
      (fn [resolve reject]
        (let [req (.request transport opts
                    (fn [res]
                      (let [status (.-statusCode res)]
                        (if (and (>= status 200) (< status 300))
                          (resolve true)
                          (reject (js/Error. (str "HTTP " status)))))))]
          (.on req "error" reject)
          (.write req body-str)
          (.end req))))))

(defn ^:async check-and-notify!
  "Check completion for a causal_root and notify if incomplete.
   Returns true if notification was sent, false if skipped."
  [graphics-dir causal-root path & [{:keys [session-id conversation-id]}]]
  (let [cfg (config/cfg)
        events (await (ledger/read-events causal-root {:graphics-dir graphics-dir}))
        present-types (into #{} (map :event/type) events)
        missing (into [] (remove present-types) required-review-types)]
    (if (empty? missing)
      false
      ;; Check debounce: was a notified event sent within the last 30s?
      (let [now (js/Date.)
            recent-notify (some (fn [e]
                                  (when (= "graphics.svg.notified" (:event/type e))
                                    (let [t (js/Date. (:event/time e))]
                                      (when (< (- now t) debounce-ms) true))))
                                events)]
        (if recent-notify
          false
          (do
            ;; Record the notification in the ledger
            (await (ledger/append-event! nil "graphics.svg.notified" path
                    {:path path :missing_fields missing}
                    {:graphics-dir graphics-dir}))
            ;; Dispatch to knoxx
            (try
              (await (dispatch-notification! cfg causal-root path missing session-id conversation-id))
              (.log js/console "[notifier] sent incomplete review notification"
                    #js {:causal/root causal-root :missing (clj->js missing)})
              true
              (catch :default err
                (.warn js/console "[notifier] failed to dispatch notification" err)
                false))))))))

(defn ^:async scan-incomplete!
  "Scan for SVGs that have been rendered but not fully reviewed.
   Returns a vector of {:causal-root :path :missing} maps."
  [graphics-dir]
  (let [meta-dir (str graphics-dir "/meta")
        fs (js/require "node:fs")]
    ;; For now, return empty — full scan requires iterating all .edn files
    ;; which is expensive. The re-check loop will be wired when the
    ;; pipeline is fully integrated.
    #js []))

(defn start-recheck-loop!
  "Start a periodic re-check loop that scans for incomplete reviews
   every 60 seconds. Returns the timer ID."
  [graphics-dir]
  (let [timer (js/setInterval
                (fn []
                  (-> (scan-incomplete! graphics-dir)
                      (.then (fn [incomplete]
                               (doseq [{:keys [causal-root path missing]} incomplete]
                                 (check-and-notify! graphics-dir causal-root path))))
                      (.catch (fn [err]
                                (.warn js/console "[notifier] re-check error" err)))))
                60000)]
    (reset! recheck-timer* timer)
    (.log js/console "[notifier] started re-check loop (60s interval)")
    timer))

(defn stop-recheck-loop!
  "Stop the periodic re-check loop."
  []
  (when-let [timer @recheck-timer*]
    (js/clearInterval timer)
    (reset! recheck-timer* nil)
    (.log js/console "[notifier] stopped re-check loop")))
