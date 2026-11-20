---
uuid: "openplanner-5-graph-connections"
title: "Repair graph connection projection"
status: "incoming"
type: "task"
priority: "P1"
labels: "graph, projection, cljs"
parent: "openplanner-system-projections-rest-compat"
dependency: []
category: "kanban"
write-id: "1793664019641-0.csvy8gwm58gcs2douvx"
created_at: "2026-11-03T00:00:19.641Z"
---

# Repair graph connections and textless event projection

## Outcome

The served graph and event APIs preserve induced edges at the node cap, attribute Bluesky mentions through observed authorship, and project predecessor, topic and attachment edges for textless Discord events.

## Scope

Destination: Clojure-family graph/event projection and an explicitly verified HTTP and Mongo boundary, under the system projections and REST compatibility epic.

## Non-goals

Changing identity claims, historical backfill, ordering guarantees, authentication or production data.

## Acceptance criteria

- The existing real-HTTP/disposable-Mongo characterization passes all seven checks, including cap-boundary, authorship and all three textless edges.
- Every existing route and write behavior exposed by the replaced or adapted TypeScript implementation is characterized and retained.
- Named external adapters normalize foreign values to Clojure data and real service integration is tested separately from stubs.
- No new TypeScript implementation is introduced; existing TypeScript remains intact unless its replacement is fully characterized.

## Verification

Run the existing ClojureScript characterization with disposable MongoDB and loopback HTTP, targeted and integrated tests, lint, and independent review. Record Kafka/Clio and migration limitations.
