(ns metrics-refresh-interval-test
  (:require [promesa.core :as p]))

;; Exercise the actual route with mock Fastify and Mongo collections. This is
;; route-level coverage, not an HTTP/Mongo end-to-end test.
(def cases [[nil 60000] ["garbage" 60000] ["Infinity" 60000]
            ["-Infinity" 60000] ["1" 5000] ["12000" 12000]
            ["9999999" 600000]])
(def now (atom 1000000))
(def failures (atom 0))
(def original-now (.-now js/Date))
(def route (or (.. js/process -env -METRICS_ROUTE) "src/routes/v1/metrics.ts"))

(defn run-case [[input interval]]
  (if (nil? input)
    (js-delete (.-env js/process) "OPENPLANNER_METRICS_MONGO_REFRESH_MS")
    (aset (.-env js/process) "OPENPLANNER_METRICS_MONGO_REFRESH_MS" input))
  (let [calls (atom 0)
        handlers (atom {})
        collection #js {:countDocuments (fn [] (js/Promise.resolve (swap! calls inc)))}
        mongo #js {:events collection :compacted collection :hotVectors collection :compactVectors collection}
        app #js {:mongo mongo :get (fn [path handler] (swap! handlers assoc path handler))}]
    (p/let [module (js/import (str "../" route "?case=" (js/encodeURIComponent (str input))))
            _ ((.-metricsRoutes module) app)
            _ ((get @handlers "/metrics/json"))
            initial @calls
            _ (swap! now + (dec interval))
            _ ((get @handlers "/metrics/json"))
            cached @calls
            _ (swap! now inc)
            _ ((get @handlers "/metrics/json"))]
      (let [actual [initial cached @calls]]
        (if (= [4 4 8] actual)
          (println "PASS" (pr-str input) actual)
          (do (swap! failures inc) (println "FAIL" (pr-str input) "expected [4 4 8], got" actual))))
      (swap! now + 1000000))))

(aset js/Date "now" (fn [] @now))
(-> (reduce (fn [promise item] (p/then promise (fn [] (run-case item))))
            (js/Promise.resolve) cases)
    (p/then (fn []
              (aset js/Date "now" original-now)
              (println "Cases:" (count cases) "Failures:" @failures)
              (when (pos? @failures) (set! (.-exitCode js/process) 1))))
    (p/catch (fn [error]
               (aset js/Date "now" original-now)
               (println "Harness error:" error)
               (set! (.-exitCode js/process) 1))))
