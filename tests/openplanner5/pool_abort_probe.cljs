;; Isolated in-flight cancellation and shared pool recovery experiment.
(ns openplanner5.pool-abort-probe)
(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "openplanner5_pool_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(defn check! [label expected actual]
  (if (= expected actual) (println "PASS" label)
      (do (swap! failures inc) (println "FAIL" label "expected" (pr-str expected) "got" (pr-str actual)))))
(defn burst-test [collection pool-events started-count]
  (letfn [(cycle! [cycle]
            (if (= cycle 3) (do (println "POOL FINAL EVENTS" (pr-str @pool-events)) (js/Promise.resolve nil))
              (let [before @started-count
                    tasks (mapv (fn [_] (.toArray (.aggregate collection #js [#js {:$addFields #js {:delay #js {:$function #js {:body "function() { sleep(3000); return 1; }" :args #js [] :lang "js"}}}}] #js {:signal (js/AbortSignal.timeout 200)}))) (range 4))]
                (-> (js/Promise.allSettled (clj->js tasks))
                    (.then (fn [results] (let [statuses (mapv #(.-status %) (vec results))]
                      (println "BURST cycle" cycle "server-started" (- @started-count before) "statuses" (pr-str statuses))
                      (check! (str "cycle " cycle " four operations abort") ["rejected" "rejected" "rejected" "rejected"] statuses)
                      (js/Promise.all (clj->js (mapv (fn [_] (.findOne collection #js {:_id "fixture"})) (range 4)))))))
                    (.then (fn [docs] (check! (str "cycle " cycle " pool handles four recovery reads") [1 1 1 1] (mapv #(.-value %) (vec docs)))
                             (cycle! (inc cycle))))))))]
    (cycle! 0)))

(defn run-test [mongo]
  (let [client (new (.-MongoClient mongo) (str uri "/?directConnection=true") #js {:maxPoolSize 2 :monitorCommands true :serverSelectionTimeoutMS 5000})
        db (.db client db-name) collection (.collection db "probe") pool-events (atom []) started (atom nil) started-count (atom 0)
        started-promise (js/Promise. (fn [resolve _] (reset! started resolve)))
        controller (js/AbortController.)]
    (.on client "connectionClosed" (fn [e] (swap! pool-events conj [:closed (.-reason e)])))
    (.on client "connectionReady" (fn [_] (swap! pool-events conj [:ready])))
    (.on client "commandStarted" (fn [e] (when (= "aggregate" (.-commandName e)) (swap! started-count inc) (@started))))
    (-> (.connect client)
        (.then (fn [] (.insertOne collection #js {:_id "fixture" :value 1})))
        (.then (fn []
                 (let [start (js/Date.now)
                       cursor (.aggregate collection #js [#js {:$addFields #js {:delay #js {:$function #js {:body "function() { sleep(3000); return 1; }" :args #js [] :lang "js"}}}}] #js {:signal (.-signal controller)})
                       slow (-> (.toArray cursor) (.then (fn [_] {:outcome :resolved :elapsed (- (js/Date.now) start)}))
                                (.catch (fn [err] {:outcome :rejected :message (.-message err) :elapsed (- (js/Date.now) start)})))]
                   (-> started-promise
                       (.then (fn [] (js/setTimeout #(.abort controller (js/Error. "synthetic in-flight abort")) 200)
                                (js/Promise.all #js [slow (.command db #js {:ping 1})])))
                       (.then (fn [results]
                                (let [result (aget results 0) ping (aget results 1)]
                                  (println "IN-FLIGHT RESULT" (pr-str result) "pool-events" (pr-str @pool-events))
                                  (check! "slow command aborted" :rejected (:outcome result))
                                  (check! "abort reason preserved" "synthetic in-flight abort" (:message result))
                                  (check! "concurrent ping succeeds" 1 (.-ok ping))
                                  (check! "abort returns promptly" true (< (:elapsed result) 2500))
                                  (.findOne collection #js {:_id "fixture"}))))
                       (.then (fn [doc] (check! "shared pool recovers for follow-up read" 1 (.-value doc))
                                (burst-test collection pool-events started-count)))))))
        (.finally (fn [] (-> (.dropDatabase db) (.then (fn [dropped] (println "Database dropped:" db-name dropped) (.close client)))))))))
(if-not (and uri (re-matches #"mongodb://127\.0\.0\.1:[0-9]+/?" uri))
  (do (js/console.error "OPENPLANNER_E2E_MONGO_URI must name disposable loopback MongoDB") (set! (.-exitCode js/process) 2))
  (-> (js/import "mongodb") (.then run-test)
      (.then (fn [] (when (pos? @failures) (set! (.-exitCode js/process) 1))))
      (.catch (fn [err] (js/console.error err) (set! (.-exitCode js/process) 2)))))
