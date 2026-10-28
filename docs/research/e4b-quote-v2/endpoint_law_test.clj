;; SPDX-License-Identifier: GPL-3.0-or-later
(ns endpoint-law-test
  (:require [clojure.test :refer [deftest is run-tests]]))
(load-file (str (.getParent (java.io.File. *file*)) "/src/research/e4b_endpoint_law.cljc"))
(require '[research.e4b-endpoint-law :as law])
(def nonce (apply str (repeat 32 "a")))
(def invocation (apply str (repeat 32 "b")))
(def unit (str "knoxx-e4b-fixture-" nonce ".service"))
(def group (str "/user.slice/user-1000.slice/user@1000.service/app.slice/" unit))
(def manager {:LoadState "loaded" :ActiveState "active" :SubState "running"
              :query-unit unit :Description (str "Knoxx synthetic lifecycle fixture " nonce)
              :InvocationID invocation :MainPID 1234 :ControlGroup group})
(def facts {:lease {:nonce nonce :invocation invocation} :before manager :after manager :port 23456
            :process {:source "/proc" :pid 1234 :start-ticks 100 :stable-identity true :stable-sockets true
                      :requester-uid 1000 :uids [1000 1000 1000 1000] :cgroup group
                      :network-namespace "net:[456]" :requester-network-namespace "net:[456]"
                      :socket-inodes [789]
                      :listeners [{:address "127.0.0.1" :port 23456 :state "LISTEN" :inode 789}]}})
(defn admitted? [input] (:ownership-evidence-consistent (law/decision input)))

(deftest complete-evidence-only-grants-synthetic-preflight
  (is (true? (admitted? facts)))
  (is (= {:ownership-evidence-consistent true :scope "synthetic lifecycle preflight only"
          :atomic-connect-ownership false :adversarial-same-uid-boundary false
          :model-execution false :production-adoption false :cloud-allocation false}
         (law/decision facts))))

(deftest every-required-fact-is-fail-closed
  (doseq [key (keys facts)] (is (false? (admitted? (dissoc facts key))) (str key)))
  (doseq [key (keys (:process facts))]
    (is (false? (admitted? (update facts :process dissoc key))) (str key)))
  (doseq [key (keys manager)]
    (is (false? (admitted? (-> facts (update :before dissoc key) (update :after dissoc key)))) (str key))))

(deftest stale-manager-and-lease-evidence-is-denied
  (doseq [input [(assoc-in facts [:after :InvocationID] nonce)
                 (assoc-in facts [:lease :invocation] nonce)
                 (assoc-in facts [:lease :nonce] invocation)
                 (assoc-in facts [:after :MainPID] 999)
                 (assoc-in facts [:before :MainPID] 999)
                 (-> facts (assoc-in [:before :SubState] "exited") (assoc-in [:after :SubState] "exited"))]]
    (is (false? (admitted? input)))))

(deftest process-and-endpoint-mismatch-is-denied
  (doseq [[key value] [[:source "fixture"] [:stable-identity false] [:stable-sockets false] [:start-ticks 0]
                      [:requester-uid 0] [:uids [1000 0 1000 1000]] [:cgroup "/other"]
                      [:network-namespace ""] [:requester-network-namespace "net:[999]"]
                      [:socket-inodes [1]] [:socket-inodes 789] [:socket-inodes [0]]
                      [:socket-inodes (vec (repeat 257 789))] [:listeners []]
                      [:listeners [{:address "0.0.0.0" :port 23456 :state "LISTEN" :inode 789}]]
                      [:listeners [{:address "127.0.0.1" :port 23457 :state "LISTEN" :inode 789}]]
                      [:listeners [{:address "127.0.0.1" :port 23456 :state "ESTABLISHED" :inode 789}]]
                      [:listeners [{:address "127.0.0.1" :port 23456 :state "LISTEN" :inode 0}]]]]
    (is (false? (admitted? (assoc-in facts [:process key] value))) (str key)))
  (is (false? (admitted? (assoc-in facts [:process :listeners]
                                 (vec (repeat 2 (first (get-in facts [:process :listeners]))))))))
  (doseq [port [0 80 11434 65536 "23456" nil]]
    (is (false? (admitted? (assoc facts :port port)))))

)


(deftest fixture-request-never-grants-model-authority
  (let [decision (law/fixture-request-decision {:initial facts :current facts})]
    (is (true? (:fixture-request-allowed decision)))
    (is (= {:fixture "e4b-managed-listener-v1"} (:body decision)))
    (doseq [key [:model-execution :cloud-allocation :production-adoption
                :atomic-connect-ownership :exclusive-socket-ownership]]
      (is (false? (get decision key)))))
  (doseq [changed [(assoc facts :port 11434) (assoc-in facts [:lease :invocation] nonce)
                   (assoc-in facts [:process :start-ticks] 101)
                   (assoc-in facts [:process :listeners 0 :inode] 790) nil]]
    (is (false? (:fixture-request-allowed
                  (law/fixture-request-decision {:initial facts :current changed}))))))

(run-tests 'endpoint-law-test)
