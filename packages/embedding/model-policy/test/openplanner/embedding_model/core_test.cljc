;; SPDX-License-Identifier: LGPL-3.0-or-later
(ns openplanner.embedding-model.core-test
  (:require [openplanner.embedding-model.core :as law]
            #?(:clj [clojure.test :refer [deftest is run-tests]]
               :cljs [cljs.test :refer [deftest is run-tests]])))

(deftest portable-trimming-and-entry-laws
  (is (= "x" (law/trimmed "\uFEFF\u00A0 x \u2029")))
  (is (= "\u200Bx\u200B" (law/trimmed "\u200Bx\u200B")))
  (is (= :json (law/parse-mode "{broken=x")))
  (is (= :pairs (law/parse-mode "[a=x]")))
  (is (= :empty (law/parse-mode "")))
  (is (= [["a" "b=c"] ["a" "last"] ["__proto__" "value"]]
         (law/valid-entries (law/pair-entries "a=b=c; =bad, a=last;__proto__=value;a="))))
  (is (= [["key" "v"]] (law/valid-entries [[" key " " v "] ["n" 3] ["empty" " "]]))))

(deftest explicit-scope-precedence-and-js-truthiness-facts
  (is (= [[0 "byProject"] [1 "bySource"] [2 "byKind"]] law/scope-order))
  (is (true? (law/present-model? true)))
  (doseq [fact [false nil 0 ""]] (is (false? (law/present-model? fact)))))

(defn -main [& _] (run-tests 'openplanner.embedding-model.core-test))
