;; Isolated graph domain. Mongo/Fastify adapters live in graph-port.
(ns openplanner.graph.connections
  (:require [clojure.string :as str] [clojure.walk :as walk]))

(defrecord BsonDate [value])
(defrecord BsonObjectId [value spread])
(defrecord BsonSpecial [value spread string-value])
(defn bson-special? [value] (instance? BsonSpecial value))
(defn bson-object-id? [value] (instance? BsonObjectId value))
(defn bson-date? [value] (instance? BsonDate value))
(defn js-string [value]
  (cond (bson-object-id? value) (:value value)
        (bson-date? value) (.toString (js/Date. (:value value)))
        (bson-special? value) (:string-value value)
        :else (js/String (clj->js (walk/postwalk (fn [v] (cond (bson-object-id? v) (:value v)
                                                                 (bson-date? v) (js/Date. (:value v))
                                                                 (bson-special? v) (:string-value v) :else v)) value)))))
(defn truthy? [v] (js/Boolean v))
(defn js-or [& values] (or (first (filter truthy? values)) (last values)))
(defn in-order [xs] (vec (distinct xs)))
(defn lake-of [id]
  (when-not (string? id)
    (throw (js/TypeError. (if (nil? id) "Cannot read properties of null (reading 'startsWith')" "id.startsWith is not a function"))))
  (cond (str/starts-with? id "view:compact:") "view"
        (some #(str/starts-with? id (str % ":")) ["devel" "web" "bluesky" "knoxx-session" "discord" "topic" "desktop"])
        (first (filter #(str/starts-with? id (str % ":")) ["devel" "web" "bluesky" "knoxx-session" "discord" "topic" "desktop"]))
        (some #(str/starts-with? id %) ["window:" "workspace:" "app:"]) "desktop" :else "other"))
(defn node-type [id]
  (or (some (fn [[prefix kind]] (when (str/starts-with? id prefix) kind))
            [["view:compact:" "compact_view"] ["discord:user:" "discord.user"] ["discord:channel:" "discord.channel"]
             ["discord:guild:" "discord.guild"] ["discord:reaction:" "discord.reaction"] ["discord:attachment:" "discord.attachment"]
             ["discord:" "discord.message"] ["web:url:" "web.url"] ["topic:" "topic"] ["bluesky:user:" "bluesky.user"]
             ["bluesky:post:" "bluesky.post"] ["window:" "desktop.window"] ["desktop:window:" "desktop.window"]
             ["workspace:" "desktop.workspace"] ["desktop:workspace:" "desktop.workspace"] ["app:" "desktop.app"] ["desktop:app:" "desktop.app"]])
      (let [parts (js->clj (.split id ":"))] (if (>= (count parts) 2) (nth parts 1) "unknown"))))
(def centers {"discord.user" [-350 0] "topic" [0 0] "discord.guild" [0 -350] "discord.channel" [150 -250]
              "discord.message" [250 100] "discord.attachment" [350 250] "bluesky" [450 -100] "desktop" [-250 350] "web" [400 50] "other" [-100 -100]})
(defn styling [kind]
  (cond (= kind "discord.user") [18 [0.35 0.65 1 1]] (= kind "topic") [22 [1 0.75 0.2 1]]
        (= kind "discord.guild") [24 [0.45 0.4 0.95 1]] (= kind "discord.channel") [14 [0.3 0.5 0.85 0.9]]
        (= kind "discord.message") [9 [0.7 0.75 0.8 0.8]] (= kind "discord.attachment") [12 [0.95 0.35 0.55 1]]
        (str/starts-with? kind "bluesky.") [16 [0.1 0.7 1 1]] (str/starts-with? kind "desktop.") [15 [0.2 0.9 0.6 1]]
        :else [10 [0.5 0.6 0.7 0.9]]))
(defn edge-color [kind]
  (cond (= kind "mentions_topic") [1 0.75 0.2 0.7] (contains? #{"authored_by" "mentions_user"} kind) [0.35 0.65 1 0.7]
        (= kind "preceded_by") [0.6 0.6 0.7 0.4] (= kind "has_attachment") [0.95 0.35 0.55 0.7]
        (str/includes? kind "bluesky") [0.1 0.7 1 0.7] (or (str/includes? kind "window") (str/includes? kind "desktop")) [0.2 0.9 0.6 0.7]
        :else [0.4 0.45 0.5 0.5]))
(defn allowed? [cfg id] (let [lake (lake-of id)] (and (some #{lake} (:lakes cfg)) (or (not= lake "desktop") (:desktop? cfg)))))
(defn collect-seeds [cfg rows node-fn limit-n]
  (loop [remaining (seq rows) acc []]
    (if (nil? remaining) acc
      (let [id (node-fn (first remaining))]
        (if (and id (allowed? cfg id))
          (let [next-acc (in-order (conj acc id))]
            (if (>= (count next-acc) limit-n) next-acc (recur (next remaining) next-acc)))
          (recur (next remaining) acc))))))

(defn row-edge [r] {:source (js-string (:source_node_id r)) :target (js-string (:target_node_id r)) :kind (js-string (js-or (:edge_kind r) "edge")) :layer (:layer r) :data (:data r)})
(defn edge-id [e] (str (:source e) "||" (:target e) "||" (:kind e)))
(defn merge-edges [edges rows]
  (first (reduce (fn [[acc seen] row]
                   (let [e (row-edge row) key (edge-id e)]
                     (if (contains? seen key) [acc seen] [(conj acc e) (conj seen key)])))
                 [edges (set (map edge-id edges))] rows)))
(defn iso [value] (.toISOString (js/Date. (if (bson-date? value) (:value value) value))))
(defn format-nodes [ids docs]
  (let [counters (atom {}) timeframe (atom []) bridges (atom {}) bridge-order (atom [])]
    {:nodes (mapv (fn [id]
                    (let [doc (get docs id) extra (if (nil? (:extra doc)) {} (:extra doc)) kind (node-type id) lake (lake-of id)
                          label (js-or (:label extra) (:message doc) id) text (js-or (:text doc) (:preview extra) "")
                          guild (js-or (:guild_id extra) (:session doc) "") channel (js-or (:channel_id extra) "")
                          mid (js-or (:message_id extra) (.pop (.split id ":")) "")
                          permalink (when (and (= kind "discord.message") (truthy? guild) (truthy? channel) (truthy? mid))
                                      (str "https://discord.com/channels/" (js-string guild) "/" (js-string channel) "/" (js-string mid)))
                          _ (when (and (= kind "discord.message") (truthy? (:ts doc)))
                              (swap! timeframe conj {:id id :ts (iso (:ts doc)) :permalink (or permalink "")}))
                          _ (when (= kind "discord.user")
                              (let [uid (js-or (:user_id extra) (str/replace id #"^discord:user:" ""))
                                    bridge-key (if (or (map? uid) (vector? uid)) [:object (:openplanner.routes.graph-connections/identity doc)] uid)]
                                (when-not (contains? @bridges bridge-key)
                                  (swap! bridge-order conj bridge-key)
                                  (swap! bridges assoc bridge-key {:userId uid :label (js-string label) :guilds [] :channels [] :blueskyProfiles [] :messageCount 0}))))
                          cluster (cond (or (= lake "bluesky") (str/starts-with? kind "bluesky.")) "bluesky"
                                        (or (= lake "desktop") (str/starts-with? kind "desktop.")) "desktop"
                                        (= kind "web.url") "web" (contains? centers kind) kind :else "other")
                          [cx cy] (get centers cluster) counter (get @counters cluster 0) _ (swap! counters update cluster (fnil inc 0))
                          angle (* counter 2.399963) radius (+ 25 (* (js/Math.sqrt counter) 28))
                          [size color] (styling kind) data (cond-> {:nodeType kind :lake lake :text text :permalink permalink :extra extra}
                                                        (truthy? (:ts doc)) (assoc :ts (iso (:ts doc)))
                                                        (truthy? (js-or (:author doc) (:username extra))) (assoc :author (js-or (:author doc) (:username extra))))]
                      {:id id :label (js-string label) :kind kind :lake lake :x (js/Math.round (+ cx (* (js/Math.cos angle) radius)))
                       :y (js/Math.round (+ cy (* (js/Math.sin angle) radius))) :sizePx size :color color :data data})) ids)
     :bridges @bridges :bridge-order @bridge-order :timeframe (when (seq @timeframe)
       (reduce (fn [{:keys [earliest latest] :as range} row]
                 (cond-> range (neg? (compare (:ts row) (:ts earliest))) (assoc :earliest row)
                               (pos? (compare (:ts row) (:ts latest))) (assoc :latest row)))
               {:earliest (first @timeframe) :latest (first @timeframe)} (rest @timeframe)))}))
(defn add-distinct [xs value] (if (some #{value} xs) xs (conj xs value)))
(defn apply-bridge-edge [bridges e]
  (let [kind (:kind e) s (:source e) t (:target e) user-node (cond (str/starts-with? s "discord:user:") s (str/starts-with? t "discord:user:") t :else nil)
        uid (when user-node (str/replace user-node #"^discord:user:" "")) data (:data e)]
    (if (and uid (contains? bridges uid) (contains? #{"in_guild" "authored_by" "mentions_user"} kind))
      (update bridges uid (fn [b] (cond-> b (truthy? (:guild_id data)) (update :guilds add-distinct (js-string (:guild_id data)))
                                        (truthy? (:channel_id data)) (update :channels add-distinct (js-string (:channel_id data)))
                                        (= kind "authored_by") (update :messageCount inc)))) bridges)))
(defn apply-profiles [bridges edges docs authors]
  (reduce (fn [out e]
            (if-not (contains? #{"mentions_bluesky_user" "mentions_bluesky_post"} (:kind e)) out
              (let [doc (get docs (:source e)) fallback (js-or (get-in doc [:extra :user_id]) (:author doc))
                    candidates (get authors (:source e)) author (if (truthy? fallback) (js-string fallback) (when (= 1 (count candidates)) (first candidates)))
                    handle (js-or (get-in e [:data :handle]) (str/replace (:target e) #"^bluesky:user:" ""))]
                (if (and author (truthy? handle) (contains? out author)) (update-in out [author :blueskyProfiles] add-distinct (js-string handle)) out)))) bridges edges))
(defn js-object-spread [value]
  (cond (bson-date? value) {}
        (bson-object-id? value) (:spread value)
        (bson-special? value) (:spread value)
        (map? value) value
        (vector? value) (reduce-kv (fn [out index item] (assoc out (keyword (str index)) item)) {} value)
        (string? value) (reduce (fn [out index] (assoc out (keyword (str index)) (.charAt value index))) {} (range (.-length value)))
        :else {}))
(defn render-result [cfg state docs author-rows]
  (let [ids (:ids state) selected (set ids) all-edges (:edges state) {:keys [nodes bridges bridge-order timeframe]} (format-nodes ids docs)
        authors (reduce (fn [m row] (let [target (:target_node_id row)] (if (and (string? target) (str/starts-with? target "discord:user:"))
                                                                          (update m (:source_node_id row) (fnil conj #{}) (subs target 13)) m))) {} author-rows)
        bridge-map (apply-profiles (reduce apply-bridge-edge bridges all-edges) all-edges docs authors)
        formatted (->> (map bridge-map bridge-order) (map #(assoc % :isCrossGuild (> (count (:guilds %)) 1) :isBlueskyConnected (boolean (seq (:blueskyProfiles %)))))
                       (sort-by (fn [b] [(- (count (:guilds b))) (- (:messageCount b))])) vec)
        visible (->> all-edges (filter #(and (selected (:source %)) (selected (:target %))))
                     (mapv (fn [e] {:source (:source e) :target (:target e) :kind (:kind e) :color (edge-color (:kind e))
                                     :data (merge {:kind (:kind e) :layer (:layer e)} (js-object-spread (:data e)))})))]
    {:query (when (seq (:query cfg)) (:query cfg)) :nodes nodes :edges visible
     :stats {:totalNodes (count nodes) :totalEdges (count visible) :peopleBridgesCount (count formatted) :peopleBridges (vec (take 20 formatted)) :timeframe timeframe}}))
