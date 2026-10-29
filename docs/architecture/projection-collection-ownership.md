# Projection Collection Ownership Map

**Epic:** 13 — System Projections, Socket.IO & REST Compat Layer
**Task:** 13-04
**Date:** 2026-06-05

## Overview

Each system watches the event ledger for event kinds it cares about and writes to its own projection collection. Projection collections are the queryable state; the ledger is the source of truth.

## Ownership Table

| Package | System | Watches (event kinds) | Owns (collection) | Notes |
|---------|--------|----------------------|-------------------|-------|
| `packages/auth-system/` | Auth | `user.*.request` | `knoxx_users` | Creates/updates/deletes users |
| `packages/session-system/` | Session | `session.*` | `knoxx_sessions` | Manages conversation sessions |
| `packages/graph-system/` | Graph | `graph.*` | `graph_edges`, `graph_nodes`, `graph_view_nodes`, `graph_cluster_memberships`, `graph_label_nodes`, `graph_semantic_edges` | Semantic graph operations |
| `packages/translation-system/` | Translation | `translation.*` | `translation_segments` | Translation management |
| `packages/label-system/` | Labels | `label.*` | `km_labels`, `graph_label_nodes` | Label CRUD and application |
| `packages/cms-system/` | CMS | `document.*`, `garden.*` | `gardens`, `translation_segments` | Content management |
| `packages/audit-system/` | Audit | `*.success`, `*.failure` | `audit_log` | Informational (M2+) |

## Event Flow Pattern

```
Client → REST/Socket.IO → Event Ledger (append)
                              ↓
                    System Watcher (change stream)
                              ↓
                    Projection Collection (write)
                              ↓
                    Response Event (append success/failure)
                              ↓
                    Client receives response
```

## Failure Handling

- If a system is down, events remain in the ledger
- When the system comes back up, it resumes watching from its last checkpoint
- Events that have been processed are tracked in `*_processed_events` collections (TTL = event TTL)
- The ledger's `expiresAt` field ensures old events are cleaned up by Mongo TTL monitor

## Collection Inventory

### Auth System (`knoxx_users`)
- **Source events:** `user.create.request`, `user.update.request`, `user.delete.request`
- **Document shape:** `{ _id, username, email, passwordHash, createdAt, updatedAt, metadata }`

### Session System (`knoxx_sessions`)
- **Source events:** `session.create`, `session.update`, `session.close`
- **Document shape:** `{ _id, actorId, causalRoot, createdAt, updatedAt, metadata }`

### Graph System
- **`graph_edges`:** `{ _id, source, target, type, weight, metadata }`
- **`graph_nodes`:** `{ _id, type, label, embedding?, metadata }`
- **`graph_view_nodes`:** `{ _id, nodeId, x, y, zoom }`
- **`graph_cluster_memberships`:** `{ _id, nodeId, clusterId }`
- **`graph_label_nodes`:** `{ _id, nodeId, labelId }`
- **`graph_semantic_edges`:** `{ _id, source, target, weight, type }`

### Translation System (`translation_segments`)
- **Source events:** `translation.create`, `translation.label`, `translation.batch`
- **Document shape:** `{ _id, source, target, sourceLang, targetLang, label }`

### CMS System
- **`gardens`:** `{ _id, title, content, createdAt, updatedAt }`
- **`translation_segments`:** shared with translation system

### Audit System (`audit_log`)
- **Source events:** `*.success`, `*.failure` (all event types)
- **Document shape:** `{ _id, eventType, actorId, timestamp, result, metadata }`
