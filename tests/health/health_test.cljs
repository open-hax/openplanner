(ns health-test)

(def failures (atom []))
(defn check [label actual expected]
  (when-not (= expected actual)
    (swap! failures conj [label expected actual])))

(defn app-fixture [ping]
  (let [handler (atom nil)
        collection #js {:collectionName "test" :indexExists (fn [_] (js/Promise.resolve true))}
        model #js {:getModel (fn [& _] "model")
                   :getEmbeddingFunction (fn [& _] #js {:generate (fn [_] (js/Promise.resolve #js []))})}
        app #js {:get (fn [_ f] (reset! handler f))
                 :mongo #js {:db #js {:command ping}
                            :hotVectors collection :compactVectors collection
                            :graphLayoutOverrides collection}
                 :embeddingRuntime #js {:hot model :compact model}}]
    {:app app :handler handler}))

(defn invoke [handler query]
  (let [status (atom nil)
        reply #js {:code (fn [n] (reset! status n))}]
    (-> (handler #js {:query (clj->js query)} reply)
        (.then (fn [body] {:status @status :body (js->clj body :keywordize-keys true)})))))

(defn load-route [default timeout suffix]
  (set! (.. js/process -env -OPENPLANNER_HEALTH_DEEP_DEFAULT) default)
  (set! (.. js/process -env -OPENPLANNER_HEALTH_MONGO_TIMEOUT_MS) timeout)
  (js/import (str "../../src/routes/v1/health.ts?" suffix)))

(defn query-cases [mod]
  (let [{:keys [app handler]} (app-fixture (fn [_] (js/Promise.resolve #js {})))]
    (-> ((.-healthRoutes mod) app)
        (.then (fn []
          (js/Promise.all
            (clj->js (for [[q expected] [[{} "deep"] [{:deep "false"} "shallow"]
                                           [{:deep "0"} "shallow"] [{:deep "true"} "deep"]
                                           [{:deep "1"} "deep"]]]
                       (-> (invoke @handler q)
                           (.then (fn [result]
                             (check (str q " status") (:status result) 200)
                             (check (str q " mode") (get-in result [:body :mode]) expected))))))))))))

(defn timeout-case [mod]
  (let [{:keys [app handler]} (app-fixture (fn [_] (js/Promise. (fn [_ _]))))
        start (.now js/Date)]
    (-> ((.-healthRoutes mod) app)
        (.then (fn [] (invoke @handler {})))
        (.then (fn [result]
          (check "invalid timeout status" (:status result) 503)
          (check "invalid timeout error" (get-in result [:body :dependencies :mongo :error])
                 "mongodb ping timed out after 1500ms")
          (check "timeout did not fire immediately" (>= (- (.now js/Date) start) 1300) true))))))

(-> (load-route "true" "bad" "default-true")
    (.then query-cases)
    (.then (fn [] (load-route "false" "bad" "invalid-timeout")))
    (.then timeout-case)
    (.then (fn []
      (if (seq @failures)
        (do (doseq [f @failures] (println "FAIL" (pr-str f))) (set! (.-exitCode js/process) 1))
        (println "health route: 13 checks passed"))))
    (.catch (fn [e] (println e) (set! (.-exitCode js/process) 1))))
