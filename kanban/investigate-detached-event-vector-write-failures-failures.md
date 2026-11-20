---
category: "kanban"
labels: "events, mongodb, embedding, cljs"
dependency: []
parent: "openplanner-5-graph-connections"
type: "task"
write-id: "1793679321682-0.s0l4f87u3m9bggmdjf"
title: "Investigate detached event vector write failures"
priority: "P1"
status: "incoming"
uuid: "openplanner-5-detached-vector-failures"
created_at: "2026-11-03T03:59:52.640Z"
---

# Investigate detached event-vector write failures

## Outcome

Identify and correct the inherited Mongo write failures observed in detached event-vector and graph-node embedding work, with an explicit, verified account of response and failure behavior. This task follows `openplanner-5-graph-connections`; the five graph/textless examples do not resolve these failures.

## Evidence

In isolated reference and candidate replica-set tests involving non-string event IDs, both HTTP routes returned 200 while three hot-vector writes failed because an `_id` value was an array and two graph-node embedding writes failed with duplicate-key errors. The instrumented runs recorded five terminal warnings in each route. One reference run also recorded a retryable WiredTiger write-conflict attempt; its ultimate outcome was not established. Synthetic embeddings and disabled Kafka were used. The bounded observation window does not prove that no later or uninstrumented work exists.

## Scope and acceptance

- Reproduce each failure against unchanged reference behavior using disposable Mongo and Clojure-family tests, preserving exact input, stored records, response counters, logs and failure timing.
- Identify event-ID and graph-embedding key/uniqueness semantics and demonstrate a safe, idempotent persistence strategy for supported input shapes without losing data or changing status/error behavior implicitly.
- Verify actual persisted vector/embedding records, duplicate and collision handling, transient write-failure handling, and shutdown/task settlement; explicitly distinguish retry attempts from eventual outcomes.
- Characterize Kafka, real embedding-provider and cross-service behavior separately; do not infer it from synthetic providers.
- Record any required public API or data-migration decision before changing existing contracts. New OpenPlanner implementation and tests use Clojure-family code with named foreign-value adapters.

## Non-goals

Backfilling production data, changing credentials or security settings, production deployment, or hiding detached failures behind successful assertion counts.