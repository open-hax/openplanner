(ns promethean.records.edn.js-boundary-test
  {:clj-kondo/config '{:linters {:unresolved-symbol {:exclude [await]}}}}
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
      (is (every? #(and (string? %) (seq %))
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

(defn- ^:async reject-unreadable-payload []
  (let [dir (await (fs/mkdtemp (path/join (os/tmpdir) "edn-invalid-")))
        mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)]
    (try
      (let [outcome (try (await ((aget admission "append-event!")
                                      #js {"event/type" "invalid" :payload #js {:nested (fn [])}}))
                         :accepted
                         (catch :default _ :rejected))
            batch-outcome (try (await ((aget admission "append-events!")
                                            #js [#js {"event/type" "valid"}
                                                 #js {"event/type" "invalid" :payload #js {:nested (fn [])}}]))
                               :accepted
                               (catch :default _ :rejected))
            events (await ((aget admission "query-events") #js {}))]
        (is (= :rejected outcome) "unreadable nested value must be rejected")
        (is (= :rejected batch-outcome) "invalid batch must be rejected before writing")
        (is (= 0 (alength events))))
      (finally (await (fs/rm dir #js {:recursive true :force true}))))))

(deftest rejects-unreadable-payload-test
  (async done
    (-> (reject-unreadable-payload)
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str (.-stack err))) (done))))))

(defn- append-promise [admission event]
  ((aget admission "append-event!") event))

(defn- ^:async exercise-undefined [dir]
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)
        promise (append-promise admission #js {"event/type" "invalid" :payload #js {:nested js/undefined}})]
    (is (instance? js/Promise promise))
    (is (= :rejected (try (await promise) :accepted (catch :default _ :rejected))))
    (is (= 0 (alength (await ((aget admission "query-events") #js {})))))))

(deftest undefined-promise-test
  (async done
    (-> (fs/mkdtemp (path/join (os/tmpdir) "edn-undefined-"))
        (.then (fn [dir]
                 (-> (exercise-undefined dir)
                     (.finally #(fs/rm dir #js {:recursive true :force true})))))
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str err)) (done))))))

(defn- ^:async exercise-prototype-key [dir]
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)
        event (js/JSON.parse "{\"event/type\":\"test\",\"payload\":{\"__proto__\":{\"value\":1}}}")
        appended (await ((aget admission "append-event!") event))
        events (await ((aget admission "query-events") #js {}))]
    (is (true? (.call (.-hasOwnProperty js/Object.prototype) (aget appended "payload") "__proto__")))
    (is (true? (.call (.-hasOwnProperty js/Object.prototype) (aget (aget events 0) "payload") "__proto__")))))

(deftest prototype-key-round-trip-test
  (async done
    (-> (fs/mkdtemp (path/join (os/tmpdir) "edn-prototype-"))
        (.then (fn [dir]
                 (-> (exercise-prototype-key dir)
                     (.finally #(fs/rm dir #js {:recursive true :force true})))))
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str err)) (done))))))

(defn- ^:async exercise-unsupported [dir]
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)
        sparse (js/Array. 2)
        cases #js [js/NaN (js/Date.) sparse]]
    (doseq [value (array-seq cases)]
      (is (= :rejected
             (try (await ((aget admission "append-event!")
                          #js {"event/type" "test" :payload #js {:value value}}))
                  :accepted (catch :default _ :rejected)))))
    (is (= 0 (alength (await ((aget admission "query-events") #js {})))))))

(deftest unsupported-values-test
  (async done
    (-> (fs/mkdtemp (path/join (os/tmpdir) "edn-values-"))
        (.then (fn [dir]
                 (-> (exercise-unsupported dir)
                     (.finally #(fs/rm dir #js {:recursive true :force true})))))
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str err)) (done))))))

(defn- ^:async exercise-arbitrary-keys [dir]
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)
        payload (js/JSON.parse "{\"a b\":1,\"\":2,\"/foo\":3,\"constructor\":4}")
        event ((aget mod "makeEnvelope") "test" payload)
        appended (await ((aget admission "append-event!") event))
        events (await ((aget admission "query-events") #js {}))]
    (is (= (js/JSON.stringify payload) (js/JSON.stringify (aget appended "payload"))))
    (is (= (js/JSON.stringify payload) (js/JSON.stringify (aget (aget events 0) "payload"))))))

(deftest arbitrary-keys-test
  (async done
    (-> (fs/mkdtemp (path/join (os/tmpdir) "edn-keys-"))
        (.then (fn [dir]
                 (-> (exercise-arbitrary-keys dir)
                     (.finally #(fs/rm dir #js {:recursive true :force true})))))
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str err)) (done))))))

(defn- ^:async exercise-invalid-shapes [dir]
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)]
    (doseq [[method value] [["append-events!" nil]
                            ["append-events!" #js {}]
                            ["append-events!" #js [nil]]
                            ["append-event!" #js {:payload #js {}}]]]
      (is (= :rejected (try (await ((aget admission method) value))
                            :accepted (catch :default _ :rejected)))))
    (is (= 0 (alength (await ((aget admission "query-events") #js {})))))))

(deftest invalid-shapes-test
  (async done
    (-> (fs/mkdtemp (path/join (os/tmpdir) "edn-shapes-"))
        (.then (fn [dir]
                 (-> (exercise-invalid-shapes dir)
                     (.finally #(fs/rm dir #js {:recursive true :force true})))))
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str err)) (done))))))

(defn- ^:async exercise-nested-filter [dir]
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)
        event #js {"event/type" "test" "event/from" #js {"actor-id" "a" "actor-kind" "x"}
                   :payload #js {:x 1}}]
    (is (true? (aget ((aget mod "validateEnvelope") event) "valid")))
    (await ((aget admission "append-event!") event))
    (is (= 1 (alength (await ((aget admission "query-events") #js {:payload #js {:x 1}})))))))

(deftest nested-filter-test
  (async done
    (-> (fs/mkdtemp (path/join (os/tmpdir) "edn-filter-"))
        (.then (fn [dir]
                 (-> (exercise-nested-filter dir)
                     (.finally #(fs/rm dir #js {:recursive true :force true})))))
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str err)) (done))))))

(deftest make-envelope-rejects-unsupported-test
  (let [mod (js/require (path/resolve "dist/index.js"))]
    (is (thrown? js/Error ((aget mod "makeEnvelope") "test" #js {:nested (js/Date.)})))))

(defn- ^:async exercise-legacy-filter [dir]
  (await (fs/writeFile (path/join dir "ledger.edn") "{:event/type \"old\" :payload {:x 1}}\n"))
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)]
    (await ((aget admission "append-event!") #js {"event/type" "new" :payload #js {:x 1}}))
    (is (= 2 (alength (await ((aget admission "query-events") #js {:payload #js {:x 1}})))))))

(deftest legacy-filter-test
  (async done
    (-> (fs/mkdtemp (path/join (os/tmpdir) "edn-legacy-"))
        (.then (fn [dir]
                 (-> (exercise-legacy-filter dir)
                     (.finally #(fs/rm dir #js {:recursive true :force true})))))
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str err)) (done))))))

(deftest validate-invalid-input-test
  (let [mod (js/require (path/resolve "dist/index.js"))
        validate (aget mod "validateEnvelope")]
    (doseq [value [nil 42 "hi" #js [] #js {"event/type" "x" :payload #js {:x (js/Date.)}}]]
      (is (false? (aget (validate value) "valid"))))))

(defn- ^:async exercise-invalid-filter [dir]
  (let [mod (js/require (path/resolve "dist/index.js"))
        admission ((aget mod "createEdnEventAdmission") dir)
        filter-spec #js {:payload (js/Date.)}]
    (is (= :rejected (try (await ((aget admission "query-events") filter-spec))
                          :accepted (catch :default _ :rejected))))
    (is (thrown? js/Error ((aget admission "watch-events") filter-spec (fn [_]))))))

(deftest invalid-filter-test
  (async done
    (-> (fs/mkdtemp (path/join (os/tmpdir) "edn-invalid-filter-"))
        (.then (fn [dir]
                 (-> (exercise-invalid-filter dir)
                     (.finally #(fs/rm dir #js {:recursive true :force true})))))
        (.then (fn [] (done)))
        (.catch (fn [err] (is false (str err)) (done))))))
