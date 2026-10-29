(ns promethean.event-ledger
  "Event ledger: append-only event store with change stream watching."
  (:require
    [promethean.event-ledger.core :as core]
    [promethean.event-ledger.watcher :as watcher]
    [promethean.event-ledger.schema :as schema]
    [promethean.event-ledger.rest-adapter :as adapter]
    [promethean.event-ledger.ttl-config :as ttl]
    [promethean.event-ledger.legacy-bridge :as bridge]))

;; Re-export core functions
(def append-event core/append-event)
(def append-events core/append-events)
(def setup-indexes core/setup-indexes)

;; Re-export watcher functions
(def watch-ledger watcher/watch-ledger)
(def watch-once watcher/watch-once)
(def close-watcher watcher/close-watcher)
(def close-all-watchers watcher/close-all-watchers)

;; Re-export schema functions
(def validate-envelope schema/validate-envelope)

;; Re-export REST adapter functions
(def rest-event->envelope adapter/rest-event->envelope)
(def append-rest-event adapter/append-rest-event)
(def append-rest-events adapter/append-rest-events)

;; Re-export TTL config functions
(def resolve-ttl ttl/resolve-ttl)
(def load-overrides ttl/load-overrides)

;; Re-export legacy bridge functions
(def bridge-enabled? bridge/bridge-enabled?)
(def merge-find-events bridge/merge-find-events)
(def find-event-by-id bridge/find-event-by-id)
