(ns promethean.event-ledger.rest-adapter
  "REST compatibility adapter for the event ledger.
   Maps EventEnvelopeV1 (TypeScript REST API) to ledger envelopes
   and appends them to the event_ledger collection."
  (:require
    [promethean.event-ledger.core :as core]))

(defn- js-val
  "Get a property from a JS object, returning nil for undefined."
  [obj key]
  (when obj
    (let [v (if (map? obj)
              (get obj key)
              (aget obj (name key)))]
      (when (not= v js/undefined) v))))

(defn- build-payload
  "Build a payload map from REST event fields."
  [rest-event]
  (let [text (js-val rest-event :text)
        attachments (js-val rest-event :attachments)
        extra (js-val rest-event :extra)
        meta (js-val rest-event :meta)
        source-ref (js-val rest-event :source_ref)
        project (when source-ref (js-val source-ref :project))
        base (cond-> {}
              text (assoc :text text)
              attachments (assoc :attachments (js->clj attachments :keywordize-keys true))
              project (assoc :project project))
        extra-map (when extra (js->clj extra :keywordize-keys true))
        meta-map (when meta (js->clj meta :keywordize-keys true))]
    (cond-> base
      extra-map (merge extra-map)
      meta-map (assoc :meta meta-map))))

(defn rest-event->envelope
  "Map an EventEnvelopeV1 JS object or CLJS map to a ledger envelope."
  [rest-event]
  (let [kind (js-val rest-event :kind)
        source (js-val rest-event :source)
        ts (js-val rest-event :ts)
        id (js-val rest-event :id)
        source-ref (js-val rest-event :source_ref)
        session (when source-ref (js-val source-ref :session))]
    (cond-> {:event/type kind
             :event/from {:actor-id source :actor-kind source}}
      id (assoc :event/id id)
      ts (assoc :event/time ts)
      session (assoc :session/id session)
      true (assoc :payload (build-payload rest-event)))))

(defn- ok-response
  "Build a successful RestAppendResult."
  [docs]
  #js {:ok true
       :count (count docs)
       :ids (clj->js (mapv :event/id docs))
       :projectedGraphEdges 0
       :ftsEnabled true
       :storageBackend "event-ledger"
       :indexed false
       :indexing "skipped"
       :ledgerSeqs (clj->js (mapv :ledger/seq docs))})

(defn- error-response
  "Build a failed RestAppendResult."
  [err]
  #js {:ok false
       :error (str (or (.-message ^js err) err))
       :count 0
       :ids #js []
       :projectedGraphEdges 0
       :ftsEnabled true
       :storageBackend "event-ledger"
       :indexed false
       :indexing "skipped"
       :ledgerSeqs #js []})

(defn ^:async append-rest-event
  "Map an EventEnvelopeV1 to a ledger envelope and append.
   Returns a JS object with backward-compatible response shape."
  [db rest-event]
  (try
    (let [envelope (rest-event->envelope rest-event)
          doc (await (core/append-event db envelope))]
      (ok-response [doc]))
    (catch :default e
      (error-response e))))

(defn ^:async append-rest-events
  "Map and append multiple EventEnvelopeV1 objects.
   Returns a JS object with backward-compatible response shape."
  [db rest-events]
  (try
    (let [envelopes (mapv rest-event->envelope (js->clj rest-events :keywordize-keys true))
          docs (await (core/append-events db envelopes))]
      (ok-response docs))
    (catch :default e
      (error-response e))))
