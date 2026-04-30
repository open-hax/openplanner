# @open-hax/openplanner-graph-claim-core

ClojureScript edge-claim domain package for OpenPlanner graph logic.

This is the first extraction point out of the large TypeScript graph route/UI
files. It deliberately separates:

- pure CLJS domain logic in `openplanner.graph.claims.core`
- JavaScript/CLJS conversion in `openplanner.graph.claims.boundary`

The pure namespace receives normalized CLJS maps only. It does not inspect JS
objects, parse host dates, hash bytes, or guess field aliases. All external
coercion lives at the boundary.

## Why this shape

The future claim acceptance layer should be defined by an abductive policy DSL,
following the shape of `orgs/open-hax/proxx/src/proxx/policy/`:

- EDN policy trees define accepted/refuted/deferred claim logic.
- A small evaluator/router applies policies to normalized contexts.
- Strategies are explicit injected functions, not hidden conditionals inside
  route handlers.

This package does **not** pull the Proxx policy engine yet. It keeps the graph
claim data shape and projection rules ready for that engine by making the claim
context data-first and CLJS-native.

## Exports

- `normalizeEdgeClaimStatus(value, fallback?)`
- `normalizeEdgeClaimDirection(value)`
- `normalizeEdgeClaimScope(value)`
- `buildEdgeClaimId(input)`
- `claimProjectable(claim, options?)`
- `projectEdgeClaim(claim, options?)`
- `projectEdgeClaims(claims, options?)`

## Build

```bash
pnpm --filter @open-hax/openplanner-graph-claim-core build
```

## Test

```bash
pnpm --filter @open-hax/openplanner-graph-claim-core test
```
