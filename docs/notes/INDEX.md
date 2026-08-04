# Notes Index

OpenPlanner notes are non-authoritative working and implementation records.
Numeric corpus state, service availability, and storage behavior are scoped to
the revision and environment where they were observed.

| Note | Disposition | Summary |
|---|---|---|
| [Graph Weaver Live Graph Query Notes](dev/graph-weaver-live-graph-query-notes.md) | retain; verification-record candidate | Reports a working graph view, exact node/edge/chunk counts, a Mongo vector-search implementation, removed chunk text, and follow-up risks. The evidence is useful for the referenced revision, but the counts and “DB becomes index, not store” interpretation are not permanent architecture authority. |

## Interpretation rules

- Preserve the exact implementation revision and environment when reusing a
  numeric or availability claim.
- Distinguish observed query results from architectural interpretations.
- Graph edges, vector neighbors, and layout records are projections; they do not
  automatically establish accepted semantic or architectural relations.
- Do not treat OpenPlanner collections as canonical workspace knowledge merely
  because they currently contain the graph/search representation.
- Cross-repository authority and migration direction are recorded in
  `open-hax/eta-mu:docs/architecture/contract-dialect-and-data-authority.md`;
  this index does not reproduce or supersede that record.

## Highest-value next pass

Inventory additional `docs/notes/` files from a recursive Git-tree source, then
classify each as time-bound verification, historical implementation context,
design input, or closed-no-extraction. Relate any still-useful graph/search APIs
to an explicit Epiphany projection or compatibility protocol.
