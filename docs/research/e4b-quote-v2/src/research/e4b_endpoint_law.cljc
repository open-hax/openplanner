;; SPDX-License-Identifier: GPL-3.0-or-later
(ns research.e4b-endpoint-law
  (:require [clojure.string :as str]))

(def bounds {:max-file-bytes 1048576 :max-fds 256 :port-min 1024 :port-max 65535
             :forbidden-ports [11434]})

(defn nonce? [value]
  (and (string? value) (boolean (re-matches #"[0-9a-f]{32}" value))))
(defn positive-int? [value] (and (integer? value) (pos? value)))
(defn port? [value]
  (and (integer? value) (<= (:port-min bounds) value (:port-max bounds))
       (not (contains? (set (:forbidden-ports bounds)) value))))

;; This profile only examines the already qualified synthetic lifecycle seam.
;; Model endpoints need a separately reviewed launch/cache/backend profile.
(defn decision [{:keys [lease before after process port]}]
  (let [{:keys [nonce invocation]} lease
        unit (str "knoxx-e4b-fixture-" nonce ".service")
        description (str "Knoxx synthetic lifecycle fixture " nonce)
        pid (:pid process)
        stable-manager? (and (map? before) (= before after)
                             (= "loaded" (:LoadState before))
                             (= "active" (:ActiveState before))
                             (= "running" (:SubState before))
                             (= unit (:query-unit before))
                             (= description (:Description before))
                             (= invocation (:InvocationID before))
                             (= pid (:MainPID before)))
        process? (and (map? process) (= "/proc" (:source process))
                      (positive-int? pid) (positive-int? (:start-ticks process))
                      (true? (:stable-identity process)) (true? (:stable-sockets process))
                      (positive-int? (:requester-uid process))
                      (= [(:requester-uid process) (:requester-uid process)
                          (:requester-uid process) (:requester-uid process)] (:uids process))
                      (string? (:network-namespace process))
                      (boolean (re-matches #"net:\[[1-9][0-9]*\]" (:network-namespace process)))
                      (= (:network-namespace process) (:requester-network-namespace process))
                      (string? (:cgroup process))
                      (= (:cgroup process) (:ControlGroup before))
                      (str/starts-with? (:cgroup process)
                                        (str "/user.slice/user-" (:requester-uid process)
                                             ".slice/user@" (:requester-uid process) ".service/"))
                      (not (str/includes? (:cgroup process) "\n"))
                      (str/ends-with? (:cgroup process) (str "/" unit)))
        listener? (and (vector? (:listeners process))
                       (= 1 (count (:listeners process)))
                       (vector? (:socket-inodes process))
                       (<= (count (:socket-inodes process)) (:max-fds bounds))
                       (every? positive-int? (:socket-inodes process))
                       (let [listener (first (:listeners process))]
                         (and (= "127.0.0.1" (:address listener))
                              (= port (:port listener))
                              (= "LISTEN" (:state listener))
                              (positive-int? (:inode listener))
                              (contains? (set (:socket-inodes process)) (:inode listener)))))
        consistent? (and (nonce? nonce) (nonce? invocation) (port? port)
                         stable-manager? process? listener?)]
    {:ownership-evidence-consistent (boolean consistent?)
     :scope "synthetic lifecycle preflight only"
     :atomic-connect-ownership false :adversarial-same-uid-boundary false
     :model-execution false :production-adoption false :cloud-allocation false}))


;; This only authorizes one fixed synthetic body through the fixture path.
;; Two individually consistent snapshots must agree; this remains preflight,
;; not an atomic socket capability or a grant to load/execute a model.
(def fixture-marker "e4b-managed-listener-v1")
(defn fixture-request-decision [{:keys [initial current]}]
  {:fixture-request-allowed
   (boolean (and (:ownership-evidence-consistent (decision initial))
                 (:ownership-evidence-consistent (decision current))
                 (= initial current)))
   :body {:fixture fixture-marker}
   :model-execution false :cloud-allocation false :production-adoption false
   :atomic-connect-ownership false :exclusive-socket-ownership false})
