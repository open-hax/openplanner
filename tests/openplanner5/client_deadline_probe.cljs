;; Isolated client-side deadline probe using a synthetic stalled TCP listener.
(ns openplanner5.client-deadline-probe)
(def failures (atom 0))
(defn check! [label pred]
  (if pred (println "PASS" label) (do (swap! failures inc) (println "FAIL" label))))
(defn execute-query [mongo server sockets client-ref]
  (let [port (.-port (.address server)) uri (str "mongodb://127.0.0.1:" port "/?directConnection=true")
        client (new (.-MongoClient mongo) uri #js {:serverSelectionTimeoutMS 10000 :connectTimeoutMS 10000 :socketTimeoutMS 10000})
        start (js/Date.now)
        options (if (= "abort" (.-OPENPLANNER_PROBE_MODE js/process.env))
                  #js {:signal (js/AbortSignal.timeout 150)}
                  #js {:timeoutMS 150 :timeoutMode "cursorLifetime"})]
    (reset! client-ref client)
    (-> (.toArray (.find (.collection (.db client "isolated") "probe") #js {} options))
        (.then (fn [_] (check! "stalled query rejects" false)))
        (.catch (fn [err] (let [elapsed (- (js/Date.now) start)]
                            (println "STALLED QUERY elapsed-ms" elapsed "error-name" (.-name err))
                            (check! "stalled query uses client deadline" (< elapsed 3000))
                            (check! "stalled listener accepted a connection" (pos? (count @sockets)))))))))
(defn run-probe [modules]
  (let [net (aget modules 0) mongo (aget modules 1) sockets (atom [])
        server (.createServer net (fn [socket] (swap! sockets conj socket))) client-ref (atom nil)]
    (-> (js/Promise. (fn [resolve reject] (.once server "error" reject) (.listen server #js {:host "127.0.0.1" :port 0} resolve)))
        (.then (fn [] (execute-query mongo server sockets client-ref)))
        (.finally (fn [] (doseq [socket @sockets] (.destroy socket))
                    (-> (if @client-ref (.close @client-ref) (js/Promise.resolve))
                        (.then (fn [] (js/Promise. (fn [resolve] (.close server resolve)))))
                        (.then (fn [] (println "STALLED FIXTURE closed")))))))))
(-> (js/Promise.all #js [(js/import "node:net") (js/import "mongodb")])
    (.then run-probe)
    (.then (fn [] (when (pos? @failures) (set! (.-exitCode js/process) 1))))
    (.catch (fn [err] (js/console.error err) (set! (.-exitCode js/process) 2))))
