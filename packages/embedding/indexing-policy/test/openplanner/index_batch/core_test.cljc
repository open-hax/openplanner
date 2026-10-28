;; SPDX-License-Identifier: LGPL-3.0-or-later
(ns openplanner.index-batch.core-test
  (:require [openplanner.index-batch.core :as law]
            #?(:clj [clojure.test :refer [deftest is run-tests]]
               :cljs [cljs.test :refer [deftest is run-tests]])))

(deftest token-estimation-from-native-string-facts
  (is (= 0 (law/token-estimate {:blank? true :chars 20 :words 0})))
  (is (= 2 (law/token-estimate {:blank? false :chars 4 :words 1})))
  (is (= 27 (law/token-estimate {:blank? false :chars 21 :words 20})))
  (is (= 33 (law/token-estimate {:blank? false :chars 129 :words 1}))))

(deftest immutable-batch-transitions-retain-oversize-items
  (is (= {:flush-before? false :state {:count 1 :tokens 100000}}
         (law/step law/initial-state {:next-tokens 100000 :token-overflow? true :item-limit? true})))
  (is (= {:flush-before? true :state {:count 1 :tokens 3}}
         (law/step {:count 7 :tokens 19} {:next-tokens 3 :token-overflow? true :item-limit? false})))
  (is (= {:flush-before? true :state {:count 1 :tokens 0}}
         (law/step {:count 1 :tokens 3} {:next-tokens 0 :token-overflow? false :item-limit? true})))
  (is (= {:flush-before? false :state {:count 3 :tokens 9}}
         (law/step {:count 2 :tokens 7} {:next-tokens 2 :token-overflow? false :item-limit? false})))
  (is (= {:max-batch-tokens 40000 :max-batch-items 256} law/defaults)))

(defn -main [& _] (run-tests 'openplanner.index-batch.core-test))
