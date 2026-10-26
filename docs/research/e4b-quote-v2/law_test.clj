;; SPDX-License-Identifier: GPL-3.0-or-later
(ns law-test
  (:require [clojure.test :refer [deftest is run-tests]]))
(load-file (str (.getParent (java.io.File. *file*)) "/src/research/e4b_quote_law.cljc"))
(require '[research.e4b-quote-law :as law])

(def sample
  {:id "synthetic" :split "development" :category "lyrics" :query "Find the cited phrase"
   :sources (mapv (fn [n] {:id (str "s" n) :text "the same spine remains"
                           :text-sha256 "foreign-adapter-verifies-hash"}) (range 5))
   :gold-parent-ids ["s0"] :gold-span "same spine"
   :condition-order ["baseline" "extract-first"]})
(def fixture
  {:schema law/protocol :model-digest law/model-digest :hashes-verified true
   :cases (mapv (fn [n] (assoc sample :id (str "c" n)
                              :split (if (< n 4) "development" "validation"))) (range 8))})
(def complete
  {:status "completed" :done true :elapsed-ms 1000 :first-visible-ms 500
   :response {:source_id "s0" :evidence "the same spine" :answer "Supported"}})
(def host
  {:owned-worker true :read-only-models true :shared-server-models 0
   :available-bytes (* 16 1024 1024 1024) :model-bytes 9608350718 :load1 1 :logical-cpus 8})

(deftest locked-and-unverified-fixtures-are-denied
  (is (:admit (law/fixture-admission fixture)))
  (is (false? (:admit (law/fixture-admission (assoc fixture :hashes-verified false)))))
  (is (false? (:admit (law/fixture-admission (assoc-in fixture [:cases 0 :split] "locked_test")))))
  (is (false? (:admit (law/fixture-admission (assoc-in fixture [:cases 0 :id] "c1")))))
  (is (false? (:admit (law/fixture-admission (assoc fixture :model-digest "drift")))))
  (is (false? (:admit (law/fixture-admission (assoc-in fixture [:cases 0 :condition-order]
                                                    ["baseline" "baseline"]))))))

(deftest resource-guard-fails-closed
  (is (:admit (law/local-admission host)))
  (doseq [bad [(assoc host :available-bytes (* 2 1024 1024 1024))
               (assoc host :shared-server-models 1) (assoc host :shared-server-models nil)
               (assoc host :owned-worker false) (assoc host :read-only-models false)
               (assoc host :load1 5) (assoc host :model-bytes -1)
               (assoc host :available-bytes ##NaN) (assoc host :available-bytes ##Inf)]]
    (is (false? (:admit (law/local-admission bad)))))
  (is (false? (:cloud-allocation-permitted (law/local-admission host)))))

(deftest prompt-only-intervention
  (let [a (law/request "baseline" "frozen user JSON")
        b (law/request "extract-first" "frozen user JSON")]
    (is (= (dissoc a :messages) (dissoc b :messages)))
    (is (= (second (:messages a)) (second (:messages b))))
    (is (not= (first (:messages a)) (first (:messages b))))
    (is (= 256 (get-in a [:options :num_predict])))
    (is (= 0 (get-in a [:options :num_gpu])))
    (is (thrown? Exception (law/request "adaptive-new-prompt" "frozen")))))

(deftest exact-quote-source-and-anchor-are-distinct
  (let [result (law/score sample complete)]
    (is (:quality-scored result))
    (is (:gold-source-selected result))
    (is (:exact-source-quote result))
    (is (:anchor-in-quote result))
    (is (:joint-grounded-quote result)))
  (let [result (law/score sample (assoc-in complete [:response :source_id] "s1"))]
    (is (:exact-source-quote result))
    (is (false? (:gold-source-selected result)))
    (is (false? (:joint-grounded-quote result))))
  (let [result (law/score sample (assoc-in complete [:response :evidence] "the same...spine"))]
    (is (false? (:exact-source-quote result)))
    (is (false? (:joint-grounded-quote result)))))

(deftest incomplete-or-late-output-is-not-answer-quality
  (doseq [transport [(assoc complete :status "timeout") (assoc complete :done false)
                     (assoc complete :elapsed-ms 20001) (assoc complete :response {})
                     (assoc-in complete [:response :answer] "")
                     (assoc-in complete [:response :evidence] 42)
                     (assoc complete :first-visible-ms 1001)]]
    (let [result (law/score sample transport)]
      (is (false? (:quality-scored result)))
      (is (not (contains? result :gold-source-selected))))))

(deftest abstention-and-context-availability-are-reported-separately
  (let [result (law/score sample (assoc complete :response
                                       {:source_id nil :evidence "" :answer "Insufficient evidence"}))]
    (is (:quality-scored result))
    (is (:abstained result))
    (is (:gold-support-visible result))
    (is (false? (:joint-grounded-quote result))))
  (let [missing (assoc sample :gold-parent-ids ["not-in-context"])
        result (law/score missing complete)]
    (is (false? (:gold-support-visible result)))
    (is (false? (:gold-source-selected result)))
    (is (:exact-source-quote result))))

(deftest contradictory-null-source-objects-are-not-abstentions
  (doseq [response [{:source_id nil :evidence "the same spine" :answer "Insufficient evidence"}
                    {:source_id nil :evidence "" :answer "I found a supported affirmative answer"}
                    {:source_id "" :evidence "" :answer "Insufficient evidence"}]]
    (let [result (law/score sample (assoc complete :response response))]
      (is (false? (:response-valid result)))
      (is (false? (:quality-scored result)))
      (is (not (contains? result :abstained))))))

(deftest whitespace-is-not-a-content-bearing-quotation
  (doseq [blank ["        " "\n\n\n\n\n\n\n\n"]]
    (let [case (update sample :sources
                       (fn [sources] (mapv #(assoc % :text (str "same spine" blank "remains")) sources)))
          result (law/score case (assoc-in complete [:response :evidence] blank))]
      (is (:quality-scored result))
      (is (false? (:exact-source-quote result)))
      (is (false? (:joint-grounded-quote result))))))

(deftest bounded-transport-policy-does-not-grant-execution
  (is (= law/deadline-ms (:deadline-ms law/transport-bounds)))
  (is (= [11434] (:forbidden-ports law/transport-bounds)))
  (is (= "127.0.0.1" (:host law/transport-bounds)))
  (is (<= (:max-line-bytes law/transport-bounds) (:max-response-bytes law/transport-bounds)))
  (is (<= (:max-visible-bytes law/transport-bounds) (:max-response-bytes law/transport-bounds))))

(let [result (run-tests)]
  (System/exit (if (zero? (+ (:fail result) (:error result))) 0 1)))
