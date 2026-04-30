(ns openplanner.graph.claims.core-test
  (:require [cljs.test :refer [deftest is run-tests]]
            [openplanner.graph.claims.boundary :as boundary]
            [openplanner.graph.claims.core :as claims]
            [openplanner.graph.claims.policy :as policy]
            [openplanner.graph.claims.schema :as schema]))

(deftest pure-projection-only-accepts-supported-or-active-non-expired-claims
  (let [base {:claim-id "edge_claim:test"
              :source-node-id "node:a"
              :target-node-id "node:b"
              :relation-kind "depends_on"
              :direction :directed
              :scope {:project "devel"}
              :confidence 0.8
              :valid-until-ms nil}
        opts {:statuses claims/projectable-statuses
              :include-expired? false
              :now-ms 1000}]
    (is (nil? (claims/claim->projected-edge (assoc base :status :proposed) opts)))
    (is (= "depends_on" (:kind (claims/claim->projected-edge (assoc base :status :supported) opts))))
    (is (= "edge_claim:test" (:claim-id (claims/claim->projected-edge (assoc base :status :active) opts))))
    (is (nil? (claims/claim->projected-edge (assoc base :status :supported :valid-until-ms 999) opts)))
    (is (some? (claims/claim->projected-edge (assoc base :status :supported :valid-until-ms 999)
                                             (assoc opts :include-expired? true))))))

(deftest claim-id-canonicalizes-undirected-endpoints
  (let [left #js {:source_node_id "node:a"
                  :target_node_id "node:b"
                  :relation_kind "related_to"
                  :direction "undirected"
                  :scope #js {:project "devel"}}
        right #js {:source_node_id "node:b"
                   :target_node_id "node:a"
                   :relation_kind "related_to"
                   :direction "undirected"
                   :scope #js {:project "devel"}}]
    (is (= (boundary/build-edge-claim-id left)
           (boundary/build-edge-claim-id right)))
    (is (re-matches #"edge_claim:[a-f0-9]{24}" (boundary/build-edge-claim-id left)))))

(deftest boundary-projects-js-claims-with-explicit-coercion
  (let [claims #js [#js {:claim_id "edge_claim:one"
                         :source_node_id "node:a"
                         :target_node_id "node:b"
                         :relation_kind "supports"
                         :direction "directed"
                         :status "supported"
                         :confidence "0.75"
                         :valid_until "2099-01-01T00:00:00.000Z"
                         :scope #js {:project "devel"}}
                    #js {:claim_id "edge_claim:two"
                         :source_node_id "node:a"
                         :target_node_id "node:c"
                         :relation_kind "supports"
                         :direction "directed"
                         :status "proposed"
                         :confidence 0.2
                         :scope #js {:project "devel"}}]
        result (boundary/project-edge-claims-js claims #js {:now "2026-01-01T00:00:00.000Z"})
        edges (aget result "edges")
        stats (aget result "stats")
        first-edge (aget edges 0)]
    (is (= 2 (aget stats "claims")))
    (is (= 1 (aget stats "edges")))
    (is (= "edge_claim:one" (aget first-edge "claim_id")))
    (is (= "supported" (aget first-edge "status")))))

(deftest schema-explains-invalid-normalized-claims
  (let [claim {:claim-id "edge_claim:bad"
               :source-node-id "node:a"
               :target-node-id "node:a"
               :relation-kind "supports"
               :direction :directed
               :scope-json "{}"
               :status :supported
               :confidence 2}
        explanation (schema/explain-edge-claim claim)]
    (is (false? (:valid? explanation)))
    (is (= #{:self-edge-not-allowed :number-between-zero-and-one}
           (set (map :error (:errors explanation)))))))

(deftest policy-makes-data-decisions-from-normalized-claims
  (let [base {:claim-id "edge_claim:policy"
              :source-node-id "node:a"
              :target-node-id "node:b"
              :relation-kind "supports"
              :direction :directed
              :scope-json "{}"
              :scope {}
              :confidence 0.9}]
    (is (= :accept (:decision/kind (policy/evaluate-claim (assoc base :status :supported)))))
    (is (= :reject (:decision/kind (policy/evaluate-claim (assoc base :status :rejected)))))
    (is (= :defer (:decision/kind (policy/evaluate-claim (assoc base :status :proposed)))))
    (is (= :supersede (:decision/kind (policy/evaluate-claim (assoc base :status :superseded)))))))

(deftest boundary-exposes-validation-and-policy-decisions
  (let [claim #js {:claim_id "edge_claim:three"
                   :source_node_id "node:a"
                   :target_node_id "node:b"
                   :relation_kind "supports"
                   :direction "directed"
                   :status "supported"
                   :confidence 1}
        explanation (boundary/explain-edge-claim-js claim)
        decision (boundary/evaluate-edge-claim-js claim)]
    (is (true? (aget explanation "valid?")))
    (is (= "accept" (aget decision "kind")))
    (is (= "projectable-status" (aget decision "reason")))))

(defn -main []
  (let [result (run-tests 'openplanner.graph.claims.core-test)]
    (when (pos? (+ (:fail result) (:error result)))
      (js/process.exit 1))))
