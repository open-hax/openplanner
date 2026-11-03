;; Isolated test-only Fastify and Mongo adapters. Not a production entry point.
(ns openplanner.routes.graph-connections
  (:require [clojure.string :as str]
            [clojure.walk :as walk]
            [openplanner.graph.connections :as domain :refer [truthy? js-or js-string in-order allowed? collect-seeds merge-edges render-result]]))

(def known-external-fields
  #{"_id" "first" "last" "id" "extra" "node_id" "user_id" "username" "author" "label" "message" "text" "preview"
    "guild_id" "channel_id" "message_id" "session" "ts" "source_node_id" "target_node_id" "edge_kind" "layer" "data" "handle"
    "query" "q" "lakes" "max_nodes" "maxNodes" "seed_node_ids" "seedNodeIds" "include_desktop" "includeDesktop"})
(defn foreign->data [x]
  (walk/postwalk (fn [v]
                   (cond (instance? js/Date v) (domain/->BsonDate (.toISOString v))
                         (= "ObjectId" (some-> v .-_bsontype))
                         (domain/->BsonObjectId (.toHexString v) {:buffer (js->clj (.toJSON (.-buffer v)))})
                         (some-> v .-_bsontype)
                         (domain/->BsonSpecial (js->clj (js/JSON.parse (js/JSON.stringify v)))
                                               (js->clj (js/JSON.parse (js/JSON.stringify (js/Object.assign #js {} v))))
                                               (js/String v))
                         (map? v) (into {} (map (fn [[k value]] [(if (and (string? k) (contains? known-external-fields k)) (keyword k) k) value]) v))
                         :else v))
                 (js->clj x)))

(defn data->foreign [x] (clj->js (walk/postwalk #(if (or (domain/bson-date? %) (domain/bson-object-id? %) (domain/bson-special? %)) (:value %) %) x)))
(defn mongo-rows [cursor] (-> (.toArray cursor) (.then foreign->data)))
(defn db-find [collection query] (.find collection (data->foreign query)))
(defn request-config [req]
  (let [b (foreign->data (.-body req)) q (cond (string? (:query b)) (str/trim (:query b)) (string? (:q b)) (str/trim (:q b)) :else "")
        lakes (if (and (vector? (:lakes b)) (seq (:lakes b))) (:lakes b) ["discord" "bluesky" "desktop" "web" "topic"])
        n (js/Number (data->foreign (if (some? (:max_nodes b)) (:max_nodes b) (if (some? (:maxNodes b)) (:maxNodes b) 250))))
        seeds (if (some? (:seed_node_ids b)) (:seed_node_ids b) (if (some? (:seedNodeIds b)) (:seedNodeIds b) []))]
    {:query q :lakes lakes :max-nodes (min 1000 (max 1 n)) :seeds (if (vector? seeds) seeds [])
     :desktop? (and (not= false (:include_desktop b)) (not= false (:includeDesktop b)))}))
(defn seed-fallback [mongo cfg]
  (let [events (.-events mongo) q (:query cfg) n (:max-nodes cfg)]
    (if (seq q)
      (let [escaped (.replace q (js/RegExp. (.-source #"[.*+?^${}()|\[\]\\]") "g") "\\$&")]
        (-> (mongo-rows (.limit (.find events (data->foreign {:$or [{:message {:$regex escaped :$options "i"}} {:text {:$regex escaped :$options "i"}}]}) #js {:projection #js {:id 1 :extra.node_id 1}}) 25))
            (.then #(collect-seeds cfg % (fn [r] (js-string (js-or (get-in r [:extra :node_id]) (:id r)))) n))
            (.catch (fn [_] []))))
      (-> (mongo-rows (.limit (.sort (.find events (data->foreign {:kind {:$in ["discord.message" "graph.node" "discord.reaction"]}}) #js {:projection #js {:id 1 :extra.node_id 1}}) #js {:ts -1}) 30))
          (.then #(collect-seeds cfg % (fn [r] (js-string (js-or (get-in r [:extra :node_id]) (:id r)))) n))))))
(defn explicit-seeds [cfg]
  (loop [remaining (seq (:seeds cfg)) result []]
    (if (or (nil? remaining) (>= (count result) (:max-nodes cfg))) result
      (let [id (first remaining)]
        (recur (next remaining) (if (allowed? cfg id) (in-order (conj result id)) result))))))
(defn find-seeds [mongo cfg]
  (let [seeds (explicit-seeds cfg) q (:query cfg)]
    (if (seq seeds) (js/Promise.resolve seeds)
      (if (seq q)
        (-> (mongo-rows (.limit (.sort (.find (.-graphNodeEmbeddings mongo) (data->foreign {:$text {:$search q}})
                                              #js {:projection #js {:node_id 1 :score #js {:$meta "textScore"}}})
                                        #js {:score #js {:$meta "textScore"}}) 25))
            (.then #(collect-seeds cfg % (fn [r] (when (truthy? (:node_id r)) (js-string (:node_id r)))) (:max-nodes cfg)))
            (.catch (fn [_] []))
            (.then (fn [hits] (if (seq hits) hits (seed-fallback mongo cfg)))))
        (seed-fallback mongo cfg)))))
(defn slice-ids [ids n]
  (let [n (if (js/Number.isNaN n) 0 (js/Math.trunc n))]
    (subvec ids 0 (max 0 (min (count ids) n)))))
(defn traverse [mongo cfg seeds]
  (letfn [(step [hop visited frontier edges]
            (if (or (= hop 2) (empty? frontier) (>= (count visited) (:max-nodes cfg)))
              (js/Promise.resolve {:ids (slice-ids visited (:max-nodes cfg)) :at-cap (>= (count visited) (:max-nodes cfg)) :edges edges})
              (-> (mongo-rows (.limit (db-find (.-graphEdges mongo) {:$or [{:source_node_id {:$in frontier}} {:target_node_id {:$in frontier}}]}) 500))
                  (.then (fn [rows]
                           (let [next-ids (reduce (fn [acc row]
                                                    (reduce (fn [a id] (if (and (allowed? cfg id) (not (some #{id} a)) (< (count a) (:max-nodes cfg))) (conj a id) a))
                                                            acc [(js-string (:source_node_id row)) (js-string (:target_node_id row))])) visited rows)
                                 frontier2 (subvec next-ids (count visited))]
                             (step (inc hop) next-ids frontier2 (merge-edges edges rows))))))))]
    (let [initial (slice-ids seeds (:max-nodes cfg))] (step 0 initial initial []))))
(defn supplement-cap [mongo _cfg state signal]
  (if (and (seq (:ids state)) (:at-cap state))
    (-> (mongo-rows (.maxTimeMS (.limit (.find (.-graphEdges mongo) (data->foreign {:source_node_id {:$in (:ids state)} :target_node_id {:$in (:ids state)}}) #js {:signal signal}) 500) 1000))
        (.then #(update state :edges merge-edges %)))
    (js/Promise.resolve state)))
(defn hydrate [mongo ids]
  (let [events (.-events mongo)
        safe (fn [q] (-> (mongo-rows (db-find events q)) (.catch (fn [_] []))))]
    (-> (js/Promise.all #js [(safe {:id {:$in ids}}) (safe {:extra.node_id {:$in ids}})])
        (.then (fn [rows]
                 (reduce (fn [m doc] (cond-> m (truthy? (:id doc)) (assoc (js-string (:id doc)) doc)
                                           (truthy? (get-in doc [:extra :node_id])) (assoc (js-string (get-in doc [:extra :node_id])) doc)))
                         {} (map-indexed (fn [i doc] (assoc doc :openplanner.routes.graph-connections/identity i)) (concat (aget rows 0) (aget rows 1)))))))))
(defn find-authors [mongo state docs signal]
  (let [sources (->> (:edges state)
                     (filter #(contains? #{"mentions_bluesky_user" "mentions_bluesky_post"} (:kind %)))
                     (map :source) distinct
                     (remove (fn [source] (let [doc (get docs source)] (truthy? (js-or (get-in doc [:extra :user_id]) (:author doc)))))) vec)
        edges (.-graphEdges mongo)]
    (if (empty? sources) (js/Promise.resolve [])
      ;; Group keeps only the first and last sorted target per source: equality means
      ;; one distinct author; inequality proves ambiguity without truncating rows.
      (-> (mongo-rows (.aggregate edges (data->foreign [{:$match {:source_node_id {:$in sources} :edge_kind "authored_by" :target_node_id #"^discord:user:"}}
                                                        {:$sort {:source_node_id 1 :target_node_id 1}}
                                                        {:$group {:_id "$source_node_id" :first {:$first "$target_node_id"} :last {:$last "$target_node_id"}}}])
                                 #js {:maxTimeMS 1000 :collation #js {:locale "simple"} :signal signal}))
          (.then (fn [groups] (vec (mapcat (fn [g] (map (fn [target] {:source_node_id (:_id g) :target_node_id target})
                                                        (distinct [(:first g) (:last g)]))) groups))))))))

(defn transient-read-error? [err]
  (or (contains? #{"MongoNetworkError" "MongoNetworkTimeoutError" "MongoServerSelectionError"} (.-name err))
      (contains? #{6 7 89 91} (.-code err))
      (and (fn? (.-hasErrorLabel err)) (.hasErrorLabel err "RetryableReadError"))))
(defn supplemental-or [req promise-fn fallback]
  (let [attempt (fn [] (-> (js/Promise.resolve nil) (.then promise-fn)))]
    (-> (attempt)
        (.catch (fn [err]
                  (if (transient-read-error? err)
                    (do (.warn (.-log req) #js {:err err} "transient graph correction read failed; retrying once") (attempt))
                    (js/Promise.reject err))))
        (.catch (fn [err] (.warn (.-log req) #js {:err err} "graph correction unavailable; retaining reference behavior") fallback)))))

(defn handler [req _reply]
  (let [cfg (request-config req) mongo (.. req -server -mongo)]
    (-> (find-seeds mongo cfg)
        (.then #(traverse mongo cfg %))
        (.then (fn [state] (let [signal (js/AbortSignal.timeout 1000)] (supplemental-or req #(supplement-cap mongo cfg state signal) state))))
        (.then (fn [state]
                 (-> (hydrate mongo (:ids state))
                     (.then (fn [docs]
                              (-> (let [signal (js/AbortSignal.timeout 1000)] (supplemental-or req #(find-authors mongo state docs signal) []))
                                  (.then (fn [authors] (data->foreign (render-result cfg state docs authors)))))))))))))
