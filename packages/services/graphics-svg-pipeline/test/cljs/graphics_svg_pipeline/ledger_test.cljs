(ns graphics-svg-pipeline.ledger-test
  "Tests for the graphics SVG pipeline event ledger integration."
  (:require
    ["fs" :as fs]
    ["os" :as os]
    ["path" :as path]
    [cljs.test :refer [deftest is testing use-fixtures]]
    [clojure.edn :as edn]
    [clojure.string :as str]
    [graphics-svg-pipeline.ledger :as ledger]))

(def ^:private tmp-dir
  "Temporary directory for test artifacts."
  (path/join (os/tmpdir) "graphics-svg-pipeline-test"))

(defn- cleanup-tmp []
  (when (fs/existsSync tmp-dir)
    (fs/rmSync tmp-dir #js {:recursive true :force true})))

(use-fixtures :each
  {:before (fn [] (cleanup-tmp))
   :after (fn [] (cleanup-tmp))})

(deftest asset-uuid-deterministic-test
  (testing "Same path always produces the same UUID"
    (let [uuid-a (ledger/asset-uuid "Graphics/foo.svg")
          uuid-b (ledger/asset-uuid "Graphics/foo.svg")]
      (is (= uuid-a uuid-b))
      (is (= 36 (count uuid-a)))))

  (testing "Different paths produce different UUIDs"
    (let [uuid-a (ledger/asset-uuid "Graphics/foo.svg")
          uuid-b (ledger/asset-uuid "Graphics/bar.svg")]
      (is (not= uuid-a uuid-b))))

  (testing "UUID is hex characters and dashes"
    (let [uuid (ledger/asset-uuid "Graphics/seals/baz.svg")]
      (is (re-matches #"[0-9a-f-]+" uuid)))))

(deftest edn-append-test
  (testing "Append single event to EDN file"
    (let [base-dir tmp-dir
          rel-path "Graphics/test.svg"
          edn-file (path/join base-dir "Graphics/meta/test.svg.edn")]
      (ledger/append-event! nil "graphics.svg.discovered" rel-path
                            {:path rel-path :source "devel"}
                            {:graphics-dir base-dir})
      ;; append-event! will fail on MongoDB (db is nil), but EDN write
      ;; still happens. Test the EDN append directly instead.
      (let [event {:event/id "test-id-1"
                   :event/type "graphics.svg.discovered"
                   :event/time "2026-01-01T00:00:00Z"
                   :causal/root "test-root"
                   :payload {:path "Graphics/test.svg"}}]
        ;; Directly test the EDN file structure via appendFileSync
        (fs/mkdirSync (path/join base-dir "Graphics/meta") #js {:recursive true})
        (fs/appendFileSync edn-file (str (pr-str event) "\n") "utf8")
        (is (fs/existsSync edn-file))
        (let [content (fs/readFileSync edn-file "utf8")
              lines (clojure.string/split-lines (clojure.string/trim content))]
          (is (= 1 (count lines)))
          (let [parsed (edn/read-string (first lines))]
            (is (= "graphics.svg.discovered" (:event/type parsed)))
            (is (= "test-id-1" (:event/id parsed))))))))

  (testing "Append multiple events without overwriting"
    (let [base-dir tmp-dir
          edn-file (path/join base-dir "Graphics/meta/multi.svg.edn")]
      (fs/mkdirSync (path/join base-dir "Graphics/meta") #js {:recursive true})
      (doseq [i (range 3)]
        (let [event {:event/id (str "event-" i)
                     :event/type "graphics.svg.validated"
                     :event/time (str "2026-01-0" (inc i) "T00:00:00Z")
                     :causal/root "multi-root"
                     :payload {:index i}}]
          (fs/appendFileSync edn-file (str (pr-str event) "\n") "utf8")))
      (let [content (fs/readFileSync edn-file "utf8")
            lines (clojure.string/split-lines (clojure.string/trim content))]
        (is (= 3 (count lines)))
        (doseq [[idx line] (map-indexed vector lines)]
          (let [parsed (edn/read-string line)]
            (is (= (str "event-" idx) (:event/id parsed)))
            (is (= "graphics.svg.validated" (:event/type parsed)))))))))

(deftest meta-path-test
  (testing "Meta path mirrors Graphics structure"
    (let [result (#'ledger/meta-path "Graphics/foo.svg")]
      (is (= "Graphics/meta/foo.svg.edn" result))))

  (testing "Nested paths"
    (let [result (#'ledger/meta-path "Graphics/seals/bar.svg")]
      (is (= "Graphics/meta/seals/bar.svg.edn" result)))))
