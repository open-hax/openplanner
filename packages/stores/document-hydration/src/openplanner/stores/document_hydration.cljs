(ns openplanner.stores.document-hydration
  (:require [clojure.string :as str]))

(def document-kinds #{"docs" "code" "config" "data"})

(defprotocol CacheStore
  (cache-get [this k])
  (cache-put! [this k v opts])
  (cache-evict! [this k])
  (cache-touch! [this k opts])
  (cache-cleanup! [this])
  (cache-stats [this]))

(defn- now-ms [] (.now js/Date))

(defn- obj?
  [x]
  (and (some? x) (= "object" (goog/typeOf x)) (not (array? x))))

(defn- jget
  [obj k]
  (when (obj? obj)
    (aget obj k)))

(defn- jassoc!
  [obj k v]
  (aset obj k v)
  obj)

(defn- clone-obj
  [obj]
  (js/Object.assign #js {} obj))

(defn- nonblank
  [v]
  (let [s (some-> v str str/trim)]
    (when-not (str/blank? s) s)))

(defn- parse-extra
  [row]
  (let [extra (jget row "extra")]
    (cond
      (obj? extra) extra
      (string? extra) (try (js/JSON.parse extra) (catch :default _ #js {}))
      :else #js {})))

(defn- metadata
  [extra]
  (let [m (jget extra "metadata")]
    (if (obj? m) m #js {})))

(defn- normalize-visibility
  [v]
  (let [s (str v)]
    (if (contains? #{"review" "public" "archived"} s) s "internal")))

(defn- public-kind
  [v]
  (let [k (str v)]
    (if (contains? document-kinds k) k "docs")))

(defn- source-ref-map
  [row]
  (let [extra (parse-extra row)
        meta (metadata extra)
        source-path (or (nonblank (jget extra "source_path"))
                        (nonblank (jget extra "path"))
                        (nonblank (jget meta "path"))
                        (nonblank (jget meta "file_id")))
        url (or (nonblank (jget extra "url"))
                (nonblank (jget meta "url")))
        hostname (or (nonblank (jget extra "hostname"))
                     (nonblank (jget meta "hostname")))
        lake (or (nonblank (jget row "project"))
                 (nonblank (jget extra "lake"))
                 (nonblank (jget meta "lake")))
        content-hash (or (nonblank (jget extra "content_hash"))
                         (nonblank (jget meta "content_hash"))
                         (nonblank (jget (jget extra "migration_2") "text_hash_sha256")))]
    (when (or source-path url hostname)
      {:sourcePath source-path
       :url url
       :hostname hostname
       :lake lake
       :contentHash content-hash
       :cacheKey (str "openplanner:source:"
                      (or lake "unknown") ":"
                      (or content-hash source-path url hostname "unknown"))})))

(defn document-source-ref
  [row]
  (some-> (source-ref-map row) clj->js))

(defn document-cache-key
  [row]
  (some-> (source-ref-map row) :cacheKey))

(defn document-needs-hydration
  [row]
  (let [text (jget row "text")]
    (and (or (nil? text) (str/blank? (str text)))
         (boolean (source-ref-map row)))))

(defn hydrate-document-row
  [row source-text]
  (let [hydrated? (and (document-needs-hydration row)
                       (not (str/blank? (str (or source-text "")))))
        next-row (clone-obj row)
        source-ref (source-ref-map row)]
    (when hydrated?
      (jassoc! next-row "text" (str source-text)))
    #js {:row next-row
         :hydrated hydrated?
         :sourceRef (clj->js source-ref)}))

(defn row-to-document
  [row]
  (let [extra (parse-extra row)
        meta (metadata extra)
        ts (jget row "ts")]
    #js {:id (str (or (jget row "id") ""))
         :title (str (or (jget extra "title") (jget row "message") (jget row "id") ""))
         :content (str (or (jget row "text") ""))
         :project (str (or (jget row "project") "devel"))
         :kind (public-kind (jget row "kind"))
         :visibility (normalize-visibility (jget extra "visibility"))
         :source (some-> (jget row "source") str)
         :sourcePath (some-> (jget extra "source_path") str)
         :domain (some-> (jget extra "domain") str)
         :language (or (some-> (jget extra "language") str) "en")
         :createdBy (some-> (jget extra "created_by") str)
         :publishedBy (some-> (jget extra "published_by") str)
         :publishedAt (if (some? (jget extra "published_at")) (str (jget extra "published_at")) nil)
         :aiDrafted (boolean (jget extra "ai_drafted"))
         :aiModel (if (some? (jget extra "ai_model")) (str (jget extra "ai_model")) nil)
         :aiPromptHash (if (some? (jget extra "ai_prompt_hash")) (str (jget extra "ai_prompt_hash")) nil)
         :metadata meta
         :ts (if (some? ts) (str ts) (.toISOString (js/Date.)))}))

(deftype MemoryLruCache [state max-entries default-ttl-ms]
  CacheStore
  (cache-get [_ k]
    (let [entry (get @state k)
          now (now-ms)]
      (cond
        (nil? entry) nil
        (and (:expiresAt entry) (< (:expiresAt entry) now))
        (do (swap! state dissoc k) nil)
        :else
        (do (swap! state assoc k (assoc entry :touchedAt now))
            (:value entry)))))

  (cache-put! [_ k v opts]
    (let [ttl-ms (or (:ttlMs opts) default-ttl-ms)
          now (now-ms)
          expires-at (when (pos? ttl-ms) (+ now ttl-ms))]
      (swap! state assoc k {:value v :createdAt now :touchedAt now :expiresAt expires-at})
      (when (> (count @state) max-entries)
        (let [victims (->> @state
                           (sort-by (comp :touchedAt val))
                           (take (- (count @state) max-entries))
                           (map key))]
          (swap! state #(apply dissoc % victims))))
      true))

  (cache-evict! [_ k]
    (let [present? (contains? @state k)]
      (swap! state dissoc k)
      present?))

  (cache-touch! [_ k opts]
    (let [entry (get @state k)]
      (if-not entry
        false
        (let [ttl-ms (or (:ttlMs opts) default-ttl-ms)
              now (now-ms)]
          (swap! state assoc k (cond-> (assoc entry :touchedAt now)
                                 (pos? ttl-ms) (assoc :expiresAt (+ now ttl-ms))))
          true))))

  (cache-cleanup! [_]
    (let [before (count @state)
          now (now-ms)]
      (swap! state (fn [m]
                     (into {} (remove (fn [[_ entry]]
                                        (and (:expiresAt entry) (< (:expiresAt entry) now)))
                                      m))))
      (- before (count @state))))

  (cache-stats [_]
    {:size (count @state)
     :maxEntries max-entries
     :defaultTtlMs default-ttl-ms}))

(defn create-memory-lru-cache
  ([] (create-memory-lru-cache nil))
  ([opts]
   (let [opts (if (obj? opts) (js->clj opts :keywordize-keys true) (or opts {}))]
     (MemoryLruCache. (atom {})
                      (long (or (:maxEntries opts) 512))
                      (long (or (:defaultTtlMs opts) (* 5 60 60 1000)))))))

(defn cache-get-js [cache k] (cache-get cache k))
(defn cache-put-js
  ([cache k v] (cache-put-js cache k v nil))
  ([cache k v ttl-ms]
   (cache-put! cache k v (cond-> {} ttl-ms (assoc :ttlMs ttl-ms)))))
(defn cache-evict-js [cache k] (cache-evict! cache k))
(defn cache-touch-js
  ([cache k] (cache-touch-js cache k nil))
  ([cache k ttl-ms]
   (cache-touch! cache k (cond-> {} ttl-ms (assoc :ttlMs ttl-ms)))))
(defn cache-cleanup-js [cache] (cache-cleanup! cache))
(defn cache-stats-js [cache] (clj->js (cache-stats cache)))
