(ns openplanner.stores.cache-test
  (:require [cljs.test :as t :refer [async deftest is run-tests]]
            [openplanner.stores.cache.boundary :as boundary]
            [openplanner.stores.cache.schema :as schema]))

(defmethod t/report [:cljs.test/default :summary] [m]
  (println "\nRan" (:test m) "tests containing" (+ (:pass m) (:fail m) (:error m)) "assertions.")
  (println (:fail m) "failures," (:error m) "errors.")
  (when (pos? (+ (:fail m) (:error m)))
    (.exit js/process 1)))

(defn- p->
  [p f]
  (.then (js/Promise.resolve p) f))

(deftest cache-entry-and-projection-envelope-schema-test
  (let [entry (schema/cache-entry {:key "sessions:recent"
                                   :value {:rows []}
                                   :ttl-ms 1000
                                   :now-ms 10})
        envelope (schema/projection-envelope {:name "openplanner.sessions/session-index"
                                              :version 1
                                              :source-store "mongo"
                                              :source-collection "events"
                                              :source-key "project:devel"
                                              :watermark "events:123"
                                              :value {:sessions []}})]
    (is (= "sessions:recent" (:cache/key entry)))
    (is (= 1010 (:cache/expires-at-ms entry)))
    (is (true? (:valid? (schema/explain-cache-entry entry))))
    (is (= "mongo" (:projection/source-store envelope)))
    (is (true? (:valid? (schema/explain-projection-envelope envelope))))
    (is (false? (:valid? (schema/explain-projection-envelope (dissoc envelope :projection/source-key)))))))

(deftest boundary-schema-functions-return-js-objects-test
  (let [entry (boundary/cache-entry-js #js {:key "k" :value "v" :ttlMs 5 :nowMs 1})
        envelope (boundary/projection-envelope-js #js {:name "n"
                                                       :sourceStore "mongo"
                                                       :sourceKey "id:1"
                                                       :value #js {:ok true}})]
    (is (= "k" (aget entry "cache/key")))
    (is (= 6 (aget entry "cache/expires-at-ms")))
    (is (= "mongo" (aget envelope "projection/source-store")))
    (is (true? (aget (boundary/explain-projection-envelope-js envelope) "valid")))))

(deftest memory-lru-cache-ttl-and-eviction-test
  (let [cache (boundary/create-memory-lru-cache #js {:maxEntries 1 :defaultTtlMs 5})]
    (boundary/cache-put-js cache "a" "A")
    (is (= "A" (boundary/cache-get-js cache "a")))
    (boundary/cache-put-js cache "b" "B")
    (is (nil? (boundary/cache-get-js cache "a")))
    (is (= "B" (boundary/cache-get-js cache "b")))
    (js/Atomics.wait (js/Int32Array. (js/SharedArrayBuffer. 4)) 0 0 8)
    (is (nil? (boundary/cache-get-js cache "b")))))

(deftest layered-cache-promotes-lower-layer-hit-test
  (async done
    (let [hot (boundary/create-memory-lru-cache #js {:maxEntries 2})
          warm (boundary/create-memory-lru-cache #js {:maxEntries 2})
          layered (boundary/create-layered-cache #js [hot warm])]
      (boundary/cache-put-js warm "k" "v")
      (-> (boundary/cache-get-js layered "k")
          (p-> (fn [value]
                 (is (= "v" value))
                 (is (= "v" (boundary/cache-get-js hot "k")))
                 (done)))
          (.catch (fn [err]
                    (is false (str "layered cache failed: " err))
                    (done)))))))

(deftest lmdb-cache-adapter-expires-and-touches-test
  (let [store (atom {})
        db #js {:get (fn [k] (get @store k))
                :put (fn [k v]
                       (swap! store assoc k v)
                       true)
                :remove (fn [k]
                          (let [present? (contains? @store k)]
                            (swap! store dissoc k)
                            present?))}
        cache (boundary/create-lmdb-cache #js {:db db :prefix "l:" :defaultTtlMs 5})]
    (is (true? (boundary/cache-put-js cache "a" "A")))
    (is (= "A" (boundary/cache-get-js cache "a")))
    (is (true? (boundary/cache-touch-js cache "a" 20)))
    (is (= "A" (boundary/cache-get-js cache "a")))
    (js/Atomics.wait (js/Int32Array. (js/SharedArrayBuffer. 4)) 0 0 25)
    (is (nil? (boundary/cache-get-js cache "a")))))

(defn -main []
  (run-tests 'openplanner.stores.cache-test))
