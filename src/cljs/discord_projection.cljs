(ns discord-projection
  (:require [clojure.string :as str] [boundary-values :as bv]))

;; A partial, pure projection building block. The caller must supply the result
;; of the existing channel/timestamp predecessor lookup when no explicit id is
;; present. These records are not Mongo writes and this namespace is not wired
;; to the serving application.
(defn- normalized [x]
  (when (some? x) (str/trim (bv/js-string x))))

(defn- slug [s]
  (let [v (-> s str/lower-case (str/replace #"[^a-z0-9]+" "-")
              (str/replace #"^-+|-+$" ""))
        v (subs v 0 (min 96 (count v)))]
    (if (empty? v) "label" v)))

(defn project [event predecessor-id]
  (let [{:keys [id source extra]} event
        guild (or (normalized (:guild_id extra)) (normalized (get-in event [:source_ref :session])) "")
        channel (or (normalized (:channel_id extra)) "")
        previous (let [x (normalized (:previous_message_id extra))]
                   (if (seq x) x (or (normalized predecessor-id) "")))
        common {:source_node_id id :project (get-in event [:source_ref :project]) :source source}
        base-data {:channel_id channel :guild_id guild}
        predecessor (when (and (seq previous) (not= previous id))
                      [(merge common {:target_node_id (if (str/starts-with? previous "discord:") previous (str "discord:" guild ":" channel ":" previous))
                                      :edge_kind "preceded_by" :layer "conversational"
                                      :data (assoc base-data :previous_message_id previous)})])
        raw-topics (cond (vector? (:topics extra)) (:topics extra)
                         (string? (:topic extra)) [(:topic extra)] :else [])
        topics (->> raw-topics (map #(or (normalized %) "")) (remove empty?) distinct)
        topic-edges (mapv (fn [topic] (merge common {:target_node_id (str "topic:" (slug topic))
                                                     :edge_kind "mentions_topic" :layer "semantic"
                                                     :data (assoc base-data :topic topic)})) topics)
        topic-nodes (mapv (fn [topic] {:node_id (str "topic:" (slug topic)) :node_kind "topic" :label topic :preview (str "Topic: " topic) :project "topic"}) topics)]
    {:edges (into (vec predecessor) topic-edges) :topic-nodes topic-nodes}))

(defn guild-channel [event]
  (let [extra (:extra event) project (get-in event [:source_ref :project]) timestamp (bv/date (:ts event))
        guild (or (normalized (:guild_id extra)) (normalized (get-in event [:source_ref :session])) "")
        guild-name (or (normalized (:guild_name extra)) "") channel (or (normalized (:channel_id extra)) "")
        channel-name (or (normalized (:channel_name extra)) "")
        common {:project project :source (:source event) :updated_at timestamp}
        guild-id (str "discord:guild:" guild) channel-id (str "discord:channel:" channel)
        guild-label (if (seq guild-name) guild-name (str "server:" guild))
        channel-label (str "#" (if (seq channel-name) channel-name channel))
        guild-preview (str "Discord server " guild-label " [" guild "]")
        channel-preview (str "Discord channel " channel-label (when (seq guild-name) (str " in " guild-name)) " [" channel "]")
        channel-data {:channel_id channel :channel_name (not-empty channel-name) :guild_id guild :guild_name (not-empty guild-name)}]
    {:nodes (cond-> []
              (seq guild) (conj {:id (str "graph.node:" guild-id) :ts timestamp :project project :node-id guild-id :node-kind "discord.guild" :label guild-label :preview guild-preview :extra {:guild_id guild :guild_name (not-empty guild-name)}})
              (seq channel) (conj {:id (str "graph.node:" channel-id) :ts timestamp :project project :node-id channel-id :node-kind "discord.channel" :label channel-label :preview channel-preview :extra channel-data}))
     :edges (cond-> []
              (seq guild) (conj (merge common {:source_node_id (:id event) :target_node_id guild-id :edge_kind "in_guild" :layer "structural" :data {:guild_id guild :guild_name (not-empty guild-name) :channel_id (not-empty channel)}}))
              (seq channel) (conj (merge common {:source_node_id (:id event) :target_node_id channel-id :edge_kind "in_channel" :layer "structural" :data channel-data}))
              (and (seq guild) (seq channel)) (conj (merge common {:source_node_id channel-id :target_node_id guild-id :edge_kind "channel_in_guild" :layer "structural" :data channel-data})))}))

(defn urls-and-bluesky [event]
  (let [extra (:extra event) timestamp (bv/date (:ts event)) project (get-in event [:source_ref :project])
        guild (or (normalized (:guild_id extra)) (normalized (get-in event [:source_ref :session])) "")
        channel (or (normalized (:channel_id extra)) "")
        preview (if (string? (:text event)) (str/trim (:text event)) "")
        found (map #(str/replace % #"[.,;:!?]+$" "") (re-seq #"https?://[^\s<>\"')\]]+" preview))
        raw (concat (when (vector? (:urls extra)) (:urls extra)) (when (vector? (:attachments extra)) (map :url (:attachments extra))) (when (vector? (:embeds extra)) (map :url (:embeds extra))) found)
        urls (->> raw (map #(or (normalized %) "")) (remove empty?) distinct)
        common {:project project :source (:source event) :updated_at timestamp}
        node (fn [id kind label preview project attrs embed?] {:id (str "graph.node:" id) :ts timestamp :project project :node-id id :node-kind kind :label label :preview preview :extra attrs :embed? embed?})]
    (reduce (fn [{:keys [nodes edges]} url]
              (let [web-id (str "web:url:" url) match (re-find #"(?i)bsky\.app/profile/([^/\s?#]+)(?:/post/([^/\s?#]+))?" url)
                    handle (second match) rkey (nth match 2 nil) user-id (str "bluesky:user:" handle) post-id (str "bluesky:post:" handle ":" rkey)
                    web-node (node web-id "web.url" url url "web" {:url url :source_event_id (:id event)} false)
                    web-edge (merge common {:source_node_id (:id event) :target_node_id web-id :edge_kind "mentions_web_url" :layer "citation" :data {:url url :channel_id channel :guild_id guild}})
                    user-node (when handle (node user-id "bluesky.user" (str "@" handle) (str "Bluesky user @" handle) "bluesky" {:handle handle} true))
                    post-node (when rkey (node post-id "bluesky.post" (str "Bluesky post by @" handle) (str "Bluesky post by @" handle " [" rkey "]") "bluesky" {:handle handle :rkey rkey :url url} false))
                    bsky-edges (cond rkey [(merge common {:source_node_id (:id event) :target_node_id post-id :edge_kind "mentions_bluesky_post" :layer "social" :data {:handle handle :rkey rkey :url url}})
                                            (merge common {:source_node_id post-id :target_node_id user-id :edge_kind "authored_by" :layer "social" :project "bluesky" :data {:handle handle}})]
                                     handle [(merge common {:source_node_id (:id event) :target_node_id user-id :edge_kind "mentions_bluesky_user" :layer "social" :data {:handle handle :url url}})] :else [])]
                {:nodes (cond-> (conj nodes web-node) user-node (conj user-node) post-node (conj post-node))
                 :edges (into (conj edges web-edge) bsky-edges)})) {:nodes [] :edges []} urls)))

(defn author-mentions-reply [event]
  (let [extra (:extra event) meta (:meta event) ts (bv/date (:ts event)) project (get-in event [:source_ref :project])
        norm #(if (nil? %) "" (str/trim (bv/js-string %)))
        uid (norm (:author_id meta)) username (norm (:author_username meta)) global (norm (:author_global_name meta)) author (when-not (nil? (:author meta)) (bv/js-string (:author meta)))
        label (or (not-empty global) (not-empty username) author uid) guild (or (normalized (:guild_id extra)) (normalized (get-in event [:source_ref :session])) "")
        guild-name (or (normalized (:guild_name extra)) "") channel (or (normalized (:channel_id extra)) "")
        common {:project project :source (:source event) :updated_at ts}
        user-id (str "discord:user:" uid)
        text (str "Discord user " (if (seq label) label uid) (when (and (seq username) (not= username label)) (str " (@" username ")")) " [" uid "]")
        has-author (and (seq uid) (not= uid "unknown"))
        author-node (when has-author {:id (str "graph.node:" user-id) :ts ts :project project :node-id user-id :node-kind "discord.user" :label (if (seq label) label uid) :preview text :extra {:user_id uid :username (not-empty username) :global_name (not-empty global) :guild_id guild :guild_name (not-empty guild-name)}})
        author-edge (when has-author (merge common {:source_node_id (:id event) :target_node_id user-id :edge_kind "authored_by" :layer "social" :data {:user_id uid :author (if (seq label) label uid) :channel_id channel :guild_id guild :guild_name (not-empty guild-name)}}))
        preview (if (string? (:text event)) (str/trim (:text event)) "")
        users (->> (concat (when (vector? (:mentions extra)) (:mentions extra)) (map second (re-seq #"<@!?(\d+)>" preview))) (map norm) (remove empty?) distinct)
        channels (->> (concat (when (vector? (:mention_channels extra)) (:mention_channels extra)) (map second (re-seq #"<#(\d+)>" preview))) (map norm) (remove empty?) distinct)
        reply (let [v (:reply_to_message_id extra)] (if (nil? v) (norm (get-in extra [:reply_to :message_id])) (norm v)))
        mention-edges (concat (map #(merge common {:source_node_id (:id event) :target_node_id (str "discord:user:" %) :edge_kind "mentions_user" :layer "social" :data {:mentioned_user_id % :channel_id channel :guild_id guild}}) users)
                              (map #(merge common {:source_node_id (:id event) :target_node_id (str "discord:channel:" %) :edge_kind "mentions_channel" :layer "structural" :data {:mentioned_channel_id % :channel_id channel :guild_id guild}}) channels)
                              (when (seq reply) [(merge common {:source_node_id (:id event) :target_node_id (str "discord:" guild ":" channel ":" reply) :edge_kind "replies_to" :layer "conversational" :data {:reply_to_message_id reply :channel_id channel :guild_id guild}})]))]
    {:author-nodes (if author-node [author-node] []) :author-edges (if author-edge [author-edge] []) :other-edges (vec mention-edges)}))

(defn reaction [event]
  (let [extra (:extra event) norm #(if (nil? %) "" (str/trim (bv/js-string %)))
        uid (norm (:user_id extra)) mid (norm (:message_id extra))
        emoji (let [v (:emoji extra)] (if (nil? v) (if (nil? (:emoji_name extra)) "reaction" (norm (:emoji_name extra))) (norm v)))
        guild (norm (:guild_id extra)) channel (norm (:channel_id extra)) id (str "discord:reaction:" (bv/js-string (:id event)))
        ts (bv/date (:ts event)) project (get-in event [:source_ref :project]) common {:project project :source (:source event) :updated_at ts}]
    {:nodes [{:id (str "graph.node:" id) :ts ts :project project :node-id id :node-kind "discord.reaction" :label (str "Reaction " emoji) :preview (str "Reaction " emoji " on message " mid " by " uid) :extra {:emoji emoji :user_id uid :message_id mid :channel_id channel :guild_id guild} :embed? false}]
     :edges (cond-> []
              (seq mid) (conj (merge common {:source_node_id id :target_node_id (if (str/starts-with? mid "discord:") mid (str "discord:" guild ":" channel ":" mid)) :edge_kind "reacted_to" :layer "conversational" :data {:emoji emoji :user_id uid :channel_id channel :guild_id guild}}))
              (seq uid) (conj (merge common {:source_node_id (str "discord:user:" uid) :target_node_id id :edge_kind "reacted_with" :layer "social" :data {:emoji emoji :message_id mid}})))}))
