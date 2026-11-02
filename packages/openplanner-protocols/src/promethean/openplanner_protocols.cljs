(ns promethean.openplanner-protocols
  "CLJS protocols for OpenPlanner system domains.
   Each protocol describes how clients interact with a system domain.
   Implementations back onto Mongo change streams, Socket.IO, or REST.

   Protocols use the event ledger envelope as their message shape."
  (:require [malli.core :as m]
            [malli.error :as me]))

;; ---------------------------------------------------------------------------
;; Envelope schema (canonical shape for all events)
;; Mirror of event-ledger/schema.cljs — keep in sync.
;; TODO: Extract shared schema package if this drifts.
;; ---------------------------------------------------------------------------

(def ^:private from-to-schema
  [:map
   [:actor-id :string]
   [:actor-kind :string]
   [:actor-node {:optional true} :string]])

(def ^:private envelope-schema
  [:map
   [:event/id {:optional true} :string]
   [:event/type :string]
   [:event/time {:optional true} :string]
   [:event/from {:optional true} from-to-schema]
   [:event/to {:optional true} from-to-schema]
   [:causal/root {:optional true} :string]
   [:causal/parent {:optional true} :string]
   [:session/id {:optional true} :string]
   [:turn/id {:optional true} :string]
   [:delivery/mode {:optional true} [:enum "tell" "ask" "stream" "ack-required"]]
   [:delivery/id {:optional true} :string]
   [:payload {:optional true} :map]
   [:contracts {:optional true} [:vector :string]]
   [:expectations {:optional true} :map]])

(defn validate-envelope
  "Validate an envelope against the canonical schema.
   Returns {:valid true} or {:valid false :errors [...]}."
  [envelope]
  (if (m/validate envelope-schema envelope)
    {:valid true}
    {:valid false
     :errors (->> (me/humanize (m/explain envelope-schema envelope))
                  (mapcat (fn [[k vs]]
                            (map #(str (name k) ": " %) vs)))
                  vec)}))

(declare normalize-js normalize-event reject-unsupported!)

(defn ^:export validate-envelope-js
  "JS-compatible envelope validation."
  [envelope]
  (try
    (reject-unsupported! envelope (js/WeakSet.))
    (clj->js (validate-envelope (normalize-event (normalize-js envelope))))
    (catch :default _
      #js {:valid false :errors #js ["Unsupported or invalid envelope"]})))

;; ---------------------------------------------------------------------------
;; Event Admission — the core ingestion protocol
;; ---------------------------------------------------------------------------

(defprotocol EventAdmission
  "Protocol for admitting events to the ledger.
   Every system that writes events implements this."
  (append-event! [this envelope]
    "Append a single event to the ledger. Returns the stored document.")
  (append-events! [this envelopes]
    "Append multiple events. Returns vector of documents.")
  (query-events [this filter-spec]
    "Query events by filter. Returns vector of matching events.")
  (watch-events [this filter-spec callback]
    "Subscribe to events matching filter. callback receives a validated envelope map.
     Returns a handle with :close!."))

;; ---------------------------------------------------------------------------
;; Session Management
;; ---------------------------------------------------------------------------

(defprotocol SessionManagement
  "Protocol for managing actor sessions.
   Sessions track conversation context and causal chains."
  (create-session [this opts]
    "Create a new session. Returns session document.")
  (get-session [this session-id]
    "Retrieve a session by ID.")
  (update-session [this session-id updates]
    "Apply updates to a session.")
  (close-session [this session-id]
    "Close a session and clean up resources."))

;; ---------------------------------------------------------------------------
;; Document Storage
;; ---------------------------------------------------------------------------

(defprotocol DocumentStorage
  "Protocol for storing and retrieving documents.
   Documents are the durable artifacts produced by systems."
  (store-document [this doc]
    "Store a document. Returns the stored document with ID.")
  (get-document [this doc-id]
    "Retrieve a document by ID.")
  (query-documents [this query]
    "Query documents by filter. Returns vector of matches.")
  (archive-document [this doc-id]
    "Soft-delete a document by marking it archived."))

;; ---------------------------------------------------------------------------
;; Graph Operations
;; ---------------------------------------------------------------------------

(defprotocol GraphOperations
  "Protocol for graph node and edge operations.
   The graph is the semantic structure connecting concepts."
  (add-node [this node]
    "Add a node to the graph. Returns the node with ID.")
  (add-edge [this edge]
    "Add an edge between two nodes. Returns the edge with ID.")
  (query-neighbors [this node-id opts]
    "Query neighboring nodes. opts: {:direction :in|:out|:both :edge-types [...]}.")
  (traverse [this start opts]
    "Traverse the graph from start node. opts: {:depth N :edge-types [...]}."))

;; ---------------------------------------------------------------------------
;; Translation Management
;; ---------------------------------------------------------------------------

(defprotocol TranslationManagement
  "Protocol for managing translations between languages."
  (create-translation [this translation]
    "Create a translation segment. Returns the segment with ID.")
  (label-translation [this segment-id label]
    "Apply a quality/status label to a translation segment.")
  (batch-translate [this batch]
    "Submit a batch of segments for translation. Returns batch ID."))

;; ---------------------------------------------------------------------------
;; Label Management
;; ---------------------------------------------------------------------------

(defprotocol LabelManagement
  "Protocol for creating and querying labels."
  (create-label [this label]
    "Create a new label. Returns the label with ID.")
  (apply-label [this label-id target-id target-type]
    "Apply a label to a target (node, edge, document, etc.).")
  (query-by-label [this label-id opts]
    "Query all targets with a given label. opts: {:target-type [...]}."))

;; ---------------------------------------------------------------------------
;; User Management
;; ---------------------------------------------------------------------------

(defprotocol UserManagement
  "Protocol for user lifecycle operations.
   All operations emit events to the ledger; the auth system processes them."
  (create-user [this user-data]
    "Submit a user.create.request event. Returns a promise of the result event.")
  (authenticate [this credentials]
    "Submit a user.login.request event. Returns a promise of the result event.")
  (get-user [this user-id]
    "Retrieve a user from the projection collection.")
  (update-user [this user-id updates]
    "Submit a user.update.request event. Returns a promise of the result event."))

;; ---------------------------------------------------------------------------
;; Realtime Subscription (Socket.IO specific)
;; ---------------------------------------------------------------------------

(defprotocol RealtimeSubscription
  "Protocol for realtime subscriptions via Socket.IO.
   Web clients use this to subscribe to live updates."
  (subscribe [this room event-type callback]
    "Subscribe to events in a room. Returns subscription handle.")
  (unsubscribe [this handle]
    "Unsubscribe using the handle from subscribe.")
  (emit-to-room [this room event-type data]
    "Emit an event to all clients in a room."))

;; ---------------------------------------------------------------------------
;; Envelope helpers
;; ---------------------------------------------------------------------------

(defn make-envelope
  "Create a minimal event envelope with required fields."
  [event-type payload]
  {:event/type event-type
   :payload payload})

(defn ^:export init
  "Module init for ESM export; protocols are defined as protocol vars,
   no runtime state needed."
  [] {})

(defn to-js [value]
  (cond
    (map? value) (let [obj #js {}]
                   (doseq [[k v] value]
                     (js/Object.defineProperty obj (if (keyword? k) (subs (str k) 1) (str k))
                                               #js {:value (to-js v) :enumerable true :writable true :configurable true}))
                   obj)
    (sequential? value) (into-array (map to-js value))
    :else value))

(defn reject-unsupported! [value seen]
  (let [kind (goog/typeOf value)]
    (cond
      (undefined? value) (throw (js/Error. "Undefined is not supported"))
      (nil? value) nil
      (or (= kind "string") (= kind "boolean")) nil
      (= kind "number") (when-not (js/Number.isFinite value)
                            (throw (js/Error. "Non-finite number is not supported")))
      (or (= kind "object") (= kind "array"))
      (do
        (when (.has seen value)
          (throw (js/Error. "Cyclic input is not supported")))
        (let [proto (js/Object.getPrototypeOf value)]
          (when-not (or (and (= kind "array") (= proto (.-prototype js/Array)))
                        (and (= kind "object") (or (nil? proto) (= proto (.-prototype js/Object)))))
            (throw (js/Error. "Only plain objects and arrays are supported"))))
        (when (pos? (alength (js/Object.getOwnPropertySymbols value)))
          (throw (js/Error. "Symbol properties are not supported")))
        (.add seen value)
        (let [names (array-seq (js/Object.getOwnPropertyNames value))
              keys (if (= kind "array") (remove #(= % "length") names) names)]
          (when (and (= kind "array") (or (not= (count keys) (alength value))
                                          (not-every? #(.call (.-hasOwnProperty js/Object.prototype) value (str %))
                                                      (range (alength value)))))
            (throw (js/Error. "Sparse or extended arrays are not supported")))
          (doseq [key keys]
            (let [descriptor (js/Object.getOwnPropertyDescriptor value key)]
              (when-not (and (.-enumerable descriptor)
                             (.call (.-hasOwnProperty js/Object.prototype) descriptor "value"))
                (throw (js/Error. "Accessor and hidden properties are not supported")))
              (reject-unsupported! (.-value descriptor) seen))))
        (.delete seen value))
      :else (throw (js/Error. "Value is not supported by the EDN boundary")))))

(defn normalize-js [value]
  (case (goog/typeOf value)
    "array" (mapv normalize-js (array-seq value))
    "object" (if (nil? value) nil
               (reduce (fn [m key] (assoc m key (normalize-js (aget value key))))
                       {} (array-seq (js/Object.keys value))))
    value))

(defn normalize-event [value]
  (when-not (map? value)
    (throw (js/Error. "Event or filter must be an object")))
  (reduce-kv (fn [event k v]
               (let [key (keyword k)
                     normalized (if (and (#{:event/from :event/to} key) (map? v))
                                  (reduce-kv (fn [m child-key child] (assoc m (keyword child-key) child)) {} v)
                                  v)]
                 (assoc event key normalized)))
             {} value))

(defn ^:export make-envelope-js [event-type payload]
  (reject-unsupported! payload (js/WeakSet.))
  (to-js (make-envelope event-type (normalize-js payload))))
