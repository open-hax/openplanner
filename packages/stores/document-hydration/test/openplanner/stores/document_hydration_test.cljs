(ns openplanner.stores.document-hydration-test
  (:require [cljs.test :as t :refer [async deftest is run-tests]]
            [openplanner.stores.document-hydration :as hydration]))

(defmethod t/report [:cljs.test/default :summary] [m]
  (println "\nRan" (:test m) "tests containing" (+ (:pass m) (:fail m) (:error m)) "assertions.")
  (println (:fail m) "failures," (:error m) "errors.")
  (when (pos? (+ (:fail m) (:error m)))
    (.exit js/process 1)))

(defn- p->
  [p f]
  (.then (js/Promise.resolve p) f))

(deftest document-source-ref-and-hydration-test
  (let [row #js {:id "doc-1"
                 :kind "code"
                 :project "devel"
                 :message "example"
                 :text ""
                 :extra #js {:source_path "org/example/core.cljs"
                             :migration_2 #js {:text_hash_sha256 "abc123"}}}]
    (is (true? (hydration/document-needs-hydration row)))
    (is (= "openplanner:source:devel:abc123" (hydration/document-cache-key row)))
    (let [result (hydration/hydrate-document-row row "source text")
          hydrated-row (.-row result)
          doc (hydration/row-to-document hydrated-row)]
      (is (true? (.-hydrated result)))
      (is (= "source text" (.-text hydrated-row)))
      (is (= "source text" (.-content doc)))
      (is (= "code" (.-kind doc))))))

(deftest memory-lru-cache-ttl-and-eviction-test
  (let [cache (hydration/create-memory-lru-cache #js {:maxEntries 1 :defaultTtlMs 5})]
    (hydration/cache-put-js cache "a" "A")
    (is (= "A" (hydration/cache-get-js cache "a")))
    (hydration/cache-put-js cache "b" "B")
    (is (nil? (hydration/cache-get-js cache "a")))
    (is (= "B" (hydration/cache-get-js cache "b")))
    (js/Atomics.wait (js/Int32Array. (js/SharedArrayBuffer. 4)) 0 0 8)
    (is (nil? (hydration/cache-get-js cache "b")))))

(deftest layered-cache-promotes-lower-layer-hit-test
  (async done
    (let [hot (hydration/create-memory-lru-cache #js {:maxEntries 2})
          warm (hydration/create-memory-lru-cache #js {:maxEntries 2})
          layered (hydration/create-layered-cache #js [hot warm])]
      (hydration/cache-put-js warm "k" "v")
      (-> (hydration/cache-get-js layered "k")
          (p-> (fn [value]
                 (is (= "v" value))
                 (is (= "v" (hydration/cache-get-js hot "k")))
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
        cache (hydration/create-lmdb-cache #js {:db db :prefix "l:" :defaultTtlMs 5})]
    (is (true? (hydration/cache-put-js cache "a" "A")))
    (is (= "A" (hydration/cache-get-js cache "a")))
    (is (true? (hydration/cache-touch-js cache "a" 20)))
    (is (= "A" (hydration/cache-get-js cache "a")))
    (js/Atomics.wait (js/Int32Array. (js/SharedArrayBuffer. 4)) 0 0 25)
    (is (nil? (hydration/cache-get-js cache "a")))))

(defn -main []
  (run-tests 'openplanner.stores.document-hydration-test))
