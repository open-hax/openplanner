# Graph and event CLJS experiment

This is an **unserved, incomplete experiment**, not a replacement for the application. The graph port has additional reads that can time out; it then logs and returns reference behavior, which may omit the correction. Per-operation aborts can close pooled MongoDB sockets. Full event input parity is not established. Production startup and TypeScript route registration are unchanged. The `x-reference` switch exists only in test-composed apps and must not be deployed.

## Prerequisites

Run from the repository root in an isolated checkout. The observed environment used Node.js 24.14.1, pnpm 10.15.0, NBB 1.3.204, Java/shadow-cljs, and Docker with the `mongo:7` image. NBB is **not** a root dependency: install that exact version separately and verify `nbb --version`, or provide an equivalent pinned executable. Installing packages or images may require network access. Use no production databases or credentials.

A clean checkout needs workspace dependencies installed and the package outputs required by the unchanged app built. The following are the repository's intended setup commands; they were not verified from a fresh checkout in this experiment:

```sh
pnpm install --frozen-lockfile
pnpm --filter @open-hax/garden-publication-components build
pnpm --filter @open-hax/openplanner-graph-claim-core build
pnpm --filter @open-hax/openplanner-translation-core build
pnpm --filter @open-hax/openplanner-store-cache build
pnpm --filter @open-hax/openplanner-document-hydration build
```

The actual local run used existing dependency artifacts through an isolated `node_modules` overlay and locally built workspace packages. A clean-install and CI run have not been verified. Preserve the normal workspace dependency layout; do not point the tests at a shared mutable database.

## Disposable MongoDB

The event differential tests require a replica set for their transaction-backed synthetic vector fixture. For example, start a no-mount container bound only to loopback:

```sh
docker run --rm -d --name openplanner5-test -p 127.0.0.1::27017 mongo:7 --replSet op5rs --bind_ip_all
docker exec openplanner5-test mongosh --quiet --eval 'rs.initiate({_id:"op5rs",members:[{_id:0,host:"127.0.0.1:27017"}]})'
docker port openplanner5-test 27017
```

Wait until the single node is primary, then export `OPENPLANNER_E2E_MONGO_URI` as the printed `mongodb://127.0.0.1:PORT` address (for example, `export OPENPLANNER_E2E_MONGO_URI=mongodb://127.0.0.1:PORT` with `PORT` replaced). The tests refuse non-loopback URIs, create unique databases and attempt to drop them. A crashed test may leave its database until the disposable container is removed. The HTTP tests use a synthetic key, disable Kafka and use synthetic embeddings. Stop and verify removal when finished:

```sh
docker stop openplanner5-test
docker inspect openplanner5-test
```

The last command should report that no such container exists. A shell may treat that expected result as a nonzero exit status.

## Test commands

With the loopback URI set, run these separately; each uses its own database. `NODE_OPTIONS` loads the existing TypeScript reference through `tsx`. The focused shape tests intentionally trigger detached Mongo vector and graph-embedding failures for some inputs: their matching HTTP results do not prove those embeddings were persisted. They observe and classify those warnings and Mongo write attempts over a bounded quiescence window; the reference has no complete detached-task signal, so no absence of later or uninstrumented work is implied.

```sh
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/graph_event_combined_probe.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/graph_connections_full_port_probe.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/slice_http.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/reference_http.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/shape_candidate.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/shape_reference.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/fault_candidate.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/fault_reference.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/duplicate_candidate.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/duplicate_reference.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/proto_boundary_mongo.cljs
NODE_OPTIONS='--import tsx' nbb -cp src/cljs:tests tests/event5/discord_projection_test.cljs
```

`tests/openplanner5/client_deadline_probe.cljs` opens a separate synthetic loopback listener and does not use MongoDB. Its default `timeoutMS` mode deliberately demonstrates a failed deadline expectation; set `OPENPLANNER_PROBE_MODE=abort` to exercise the passing abort mode. `tests/openplanner5/pool_abort_probe.cljs` runs synthetic slow reads against the disposable MongoDB and requires the loopback URI. These are bounded fault experiments, not production load tests.

The combined test demonstrates the five characterized examples and a cross-route edge read. It does not prove full endpoint parity, real Kafka/Clio or embedding-provider behavior, safe shared-pool cancellation at scale, or reliable correction when supplemental reads fail. The copied event tests use a partial handler, and the actual reference and candidate runs use separate fixtures. Further review and broader differential testing are required before any production wiring.
