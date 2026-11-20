(ns promethean.records.edn.js-boundary-test
  (:require [cljs.test :refer-macros [deftest is async]]
            ["fs/promises" :as fs]
            ["os" :as os]
            ["path" :as path]))

(defn- ^:async exercise-boundary [dir]
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)
        envelope ((aget mod "makeEnvelope") "test" #js {:value 1})]
    (is (true? (.-valid ((aget mod "validateEnvelope") envelope))))
    (let [results (await (js/Promise.all
                          #js [((aget admission "append-event!") envelope)
                               ((aget admission "append-events!")
                                #js [#js {"event/type" "batch-a"}
                                     #js {"event/type" "batch-b"}])]))
          single (aget results 0)
          batch (aget results 1)
          events (await ((aget admission "query-events") #js {}))
          filtered (await ((aget admission "query-events") #js {"event/type" "batch-a"}))
          watcher ((aget admission "watch-events") #js {} (fn [_]))]
      (is (= 2 (alength batch)))
      (is (= 3 (alength events)))
      (is (= 3 (count (set (map #(aget % "event/id") (array-seq events))))))
      (is (every? #(and (string? %) (not (empty? %)))
                  (map #(aget % "event/id") (array-seq events))))
      (is (= (set (map #(aget % "event/id") (array-seq events)))
             (set (map #(aget % "event/id") (cons single (array-seq batch))))))
      (is (= 1 (alength filtered)))
      (is (fn? (.-close watcher)))
      (.close watcher))))

(defn- ^:async run-boundary []
  (let [dir (await (fs/mkdtemp (path/join (os/tmpdir) "edn-admission-")))]
    (try
      (await (exercise-boundary dir))
      (finally (await (fs/rm dir #js {:recursive true :force true}))))))

(deftest compiled-js-boundary-test
  (async done
    (-> (run-boundary)
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str "JS boundary failed: " err)) (done))))))
