;; Run from repo root: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/proto_boundary_mongo.cljs
(ns proto-boundary-mongo (:require [mongo-projection :as mp] [lossless-json :as lj]))
(def uri (.-OPENPLANNER_E2E_MONGO_URI js/process.env))
(def db-name (str "op5_proto_" (.replaceAll (str (random-uuid)) "-" "")))
(def failures (atom 0))
(defn check! [label expected actual]
  (if (= expected actual) (println "PASS" label) (do (swap! failures inc) (println "FAIL" label "expected" (pr-str expected) "got" (pr-str actual)))))
(defn run [mods]
  (let [client (new (.-MongoClient (aget mods 0)) (str uri "/?directConnection=true")) db (.db client db-name)
        ref (.collection db "reference_edges") cand (.collection db "candidate_edges") nodes (.collection db "candidate_nodes")
        raw (js/JSON.parse "{\"__proto__\":{\"flag\":true},\"nested\":{\"__proto__\":{\"inner\":2}}}")
        normalized (js->clj raw) now (js/Date. "2026-01-01T00:00:00Z")
        row1 {:source_node_id "p||q" :target_node_id "r" :edge_kind "e" :data normalized :updated_at now}
        row2 {:source_node_id "p" :target_node_id "q||r" :edge_kind "e" :data {"tail" 2} :updated_at now}
        exact1 {:source_node_id "exact" :target_node_id "target" :edge_kind "k" :data {:value 0} :updated_at now}
        exact2 (assoc exact1 :data {:value 99 :added true})
        node {:id "graph.node:proto" :ts now :project nil :node-id "proto" :node-kind "note" :label "P" :preview "P" :extra {} :foreign-extra normalized}]
    (-> (.connect client)
        (.then (fn [] ((.-upsertGraphEdges (aget mods 1)) ref (lj/encode [row1 row2]))))
        (.then (fn [] (mp/write! nodes cand [node] [row1 row2] now)))
        (.then (fn [] (js/Promise.all #js [(.findOne ref #js {:_id "p||q||r||e"}) (.findOne cand #js {:_id "p||q||r||e"}) (.findOne nodes #js {:id "graph.node:proto"})])))
        (.then (fn [xs] (let [reference (js->clj (.-data (aget xs 0))) candidate (js->clj (.-data (aget xs 1))) node-extra (js->clj (.-extra (aget xs 2)))]
                          (check! "direct Mongo edge merge matches reference" reference candidate)
                          (check! "own proto retained in edge data" {"flag" true} (get candidate "__proto__"))
                          (check! "nested proto retained in node data" {"inner" 2} (get-in node-extra ["nested" "__proto__"])))))
        (.then (fn [] ((.-upsertGraphEdges (aget mods 1)) ref (lj/encode [exact1 exact2]))))
        (.then (fn [] (mp/write! nodes cand [] [exact1 exact2] now)))
        (.then (fn [] (js/Promise.all #js [(.findOne ref #js {:_id "exact||target||k"}) (.findOne cand #js {:_id "exact||target||k"})])))
        (.then (fn [xs] (let [ref-data (.-data (aget xs 0)) candidate-data (.-data (aget xs 1))]
                          (check! "keyword input merges to expected string-keyed Mongo data" {"value" 99 "added" true} (js->clj ref-data))
                          (check! "candidate raw Mongo JSON equals reference" (js/JSON.stringify ref-data) (js/JSON.stringify candidate-data))
                          (check! "candidate string-keyed Clojure data equals reference" (js->clj ref-data) (js->clj candidate-data)))))
        (.finally (fn [] (-> (.dropDatabase db) (.then (fn [v] (println "Database dropped:" db-name v) (.close client)))))))))
(if-not (and uri (re-matches #"mongodb://127\.0\.0\.1:[0-9]+/?" uri))
  (do (js/console.error "disposable loopback Mongo URI required") (set! (.-exitCode js/process) 2))
  (-> (js/Promise.all #js [(js/import "mongodb") (js/import "../../src/lib/mongodb.ts")])
      (.then run)
      (.then (fn [] (when (pos? @failures) (set! (.-exitCode js/process) 1))))
      (.catch (fn [err] (js/console.error err) (set! (.-exitCode js/process) 2)))))
