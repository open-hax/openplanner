---
category: "kanban"
labels: "event-ledger, edn, protocols"
dependency: ["openplanner-13-01-cljs-protocol-definitions"]
parent: "openplanner-system-projections-rest-compat"
type: "task"
write-id: "1793661838127-0.6qdtniftj1thyctaqor"
title: "Preserve readable EDN event admission"
priority: "P1"
status: "incoming"
uuid: "openplanner-126-readable-edn-admission"
created_at: "2026-11-02T23:09:56.183Z"
---

# Preserve readable EDN admission

## Outcome

The JavaScript EventAdmission boundary rejects values that cannot be stored and read without loss.

## Scope

Destination: `packages/openplanner-protocols`. Parent epic: system projections and protocol implementations. Validate a whole batch before its first write.

## Non-goals

Changing Mongo authentication or the pre-existing filesystem watcher delivery semantics.

## Acceptance criteria

- Valid nested values append and query with their data intact.
- Unsupported nested values are rejected before a ledger write.
- A batch containing an unsupported value writes none of its events.

## Verification

Run the compiled JavaScript boundary tests and integrated protocol tests; report failing checks and warnings accurately.