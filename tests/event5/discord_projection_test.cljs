;; Run from repo root: OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/discord_projection_test.cljs
(ns discord-projection-test (:require [discord-projection :as p] [mongo-projection :as mp] [lossless-json :as lj]))
(def event {:id "discord:g:c:m" :source "discord" :source_ref {:project "lake"} :extra {:guild_id "g" :channel_id "c"}})
(defn check [name expected actual] (when-not (= expected actual) (throw (js/Error. (str name " expected " (pr-str expected) " got " (pr-str actual))))) (println "PASS" name))
(check "empty textless event" {:edges [] :topic-nodes []} (p/project event nil))
(check "explicit predecessor overrides lookup" "discord:g:c:earlier" (get-in (p/project (assoc-in event [:extra :previous_message_id] "earlier") "other") [:edges 0 :target_node_id]))
(check "already qualified predecessor" "discord:g:c:old" (get-in (p/project event "discord:g:c:old") [:edges 0 :target_node_id]))
(check "self predecessor suppressed" [] (:edges (p/project event (:id event))))
(check "topics trim and deduplicate" ["Orbit" "Second"] (mapv :label (:topic-nodes (p/project (assoc-in event [:extra :topics] [" Orbit " "Orbit" "" "Second"]) nil))))
(check "topic slug and data" ["topic:foo-bar" "Foo Bar"] (let [e (first (:edges (p/project (assoc-in event [:extra :topic] "Foo Bar") nil)))] [(:target_node_id e) (get-in e [:data :topic])]))
(check "text does not affect projection" (p/project event "old") (p/project (assoc event :text "hello") "old"))

(let [rows (mapv (fn [i] {:source_node_id (str "s" i) :target_node_id "t" :edge_kind "k" :data {:value i}}) (range 12))
      duplicate (assoc (first rows) :data {:value 99 :added true})
      ops (mp/edge-ops (conj rows duplicate) (js/Date. "2026-01-01T00:00:00Z"))]
  (check "more than eight dedup keys keep first insertion order" (mapv #(str "s" %) (range 12)) (mapv #(get-in % [:updateOne :filter :source_node_id]) ops))
  (check "duplicate edge merges later data as string-keyed boundary data" {"value" 99 "added" true} (get-in (first ops) [:updateOne :update :$set :data]))
  (check "merged edge data encodes to expected JS properties" {"value" 99 "added" true} (js->clj (lj/encode (get-in (first ops) [:updateOne :update :$set :data])))))
