import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import test from "node:test";
import AdmZip from "adm-zip";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import type { OpenPlannerConfig } from "../lib/config.js";

function authHeader(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}` };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openplanner-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function testConfig(dataDir: string): OpenPlannerConfig {
  return {
    storageBackend: "duckdb",
    dataDir,
    host: "127.0.0.1",
    port: 0,
    apiKey: "fixture-openplanner-auth-token", // pragma: allowlist secret
    chromaUrl: "disabled",
    chromaCollection: "test_collection",
    chromaCompactCollection: "test_collection_compact",
    ollamaBaseUrl: "http://localhost:11434",
    embeddingModels: {
      defaultModel: "qwen3-embedding:0.6b",
      bySource: {},
      byKind: {},
      byProject: {}
    },
    compactEmbedModel: "qwen3-embedding:4b",
    ollamaEmbedTruncate: true,
    semanticCompaction: {
      enabled: true,
      minEventCount: 10,
      maxNeighbors: 8,
      maxChars: 4000,
      distanceThreshold: 0.35,
      minClusterSize: 3,
      maxPacksPerRun: 32,
    },
    mongodb: {
      uri: "mongodb://localhost:27017",
      dbName: "openplanner_test",
      eventsCollection: "events",
      compactedCollection: "compacted_memories",
      vectorHotCollection: "event_chunks",
      vectorCompactCollection: "compacted_vectors",
    }
  };
}

async function createChatGPTZip(zipPath: string, messageText: string): Promise<void> {
  const conversations = [
    {
      title: "Test Session",
      create_time: 1700000000,
      mapping: {
        root: { id: "root", children: ["n1"] },
        n1: {
          id: "n1",
          parent: "root",
          children: [],
          message: {
            id: "msg-1",
            author: { role: "user" },
            create_time: 1700000001,
            content: { content_type: "text", parts: [messageText] },
            status: "finished_successfully"
          }
        }
      }
    }
  ];

  const zip = new AdmZip();
  zip.addFile("conversations.json", Buffer.from(JSON.stringify(conversations), "utf-8"));
  zip.writeZip(zipPath);
}

async function waitForJobDone(app: FastifyInstance, id: string, apiKey: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 80; i += 1) {
    const res = await app.inject({
      method: "GET",
      url: `/v1/jobs/${id}`,
      headers: authHeader(apiKey)
    });

    const body: unknown = res.json();
    if (isRecord(body) && isRecord(body.job)) {
      const job: Record<string, unknown> = body.job;
      if (job.status === "done" || job.status === "error") return job;
    }
    await sleep(50);
  }
  throw new Error("timed out waiting for job completion");
}

test("GET / is public", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const res = await app.inject({ method: "GET", url: "/" });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.ok, true);
      assert.equal(body.name, "openplanner");
    } finally {
      await app.close();
    }
  });
});

test("GET /v1/health is public and returns duckdb status", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const res = await app.inject({ method: "GET", url: "/v1/health" });
      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.ok, true);
      assert.equal(typeof body.ftsEnabled, "boolean");
      assert.equal(typeof body.time, "string");
      assert.equal(body.vectorCollections.hot, cfg.chromaCollection);
      assert.equal(body.vectorCollections.compact, cfg.chromaCompactCollection);
    } finally {
      await app.close();
    }
  });
});

test("Protected endpoints require Authorization bearer token", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const res = await app.inject({ method: "GET", url: "/v1/sessions" });
      assert.equal(res.statusCode, 401);
    } finally {
      await app.close();
    }
  });
});

test("ChatGPT import job ingests events into DuckDB and is searchable", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const zipPath = path.join(dir, "chatgpt-export.zip");
    const msgText = "hello from test";
    await createChatGPTZip(zipPath, msgText);

    const app = await buildApp(cfg);
    try {
      const createRes = await app.inject({
        method: "POST",
        url: "/v1/jobs/import/chatgpt",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json"
        },
        payload: JSON.stringify({ filePath: zipPath })
      });

      assert.equal(createRes.statusCode, 200);
      const createBody: unknown = createRes.json();
      assert.ok(isRecord(createBody));
      assert.equal(createBody.ok, true);
      assert.ok(isRecord(createBody.job));

      const jobId = createBody.job.id;
      if (typeof jobId !== "string") throw new Error("expected job.id to be a string");

      const job = await waitForJobDone(app, jobId, cfg.apiKey);
      assert.equal(job.status, "done");

      const searchRes = await app.inject({
        method: "POST",
        url: "/v1/search/fts",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json"
        },
        payload: JSON.stringify({ q: "hello", limit: 10 })
      });

      assert.equal(searchRes.statusCode, 200);
      const searchBody: unknown = searchRes.json();
      assert.ok(isRecord(searchBody));
      assert.equal(searchBody.ok, true);
      const count = searchBody.count;
      if (typeof count !== "number") throw new Error("expected count to be a number");
      assert.ok(count >= 1);
      assert.ok(Array.isArray(searchBody.rows));

      const match = searchBody.rows.find((r: unknown) => isRecord(r) && r.source === "chatgpt-export");
      assert.ok(match);
    } finally {
      await app.close();
    }
  });
});

test("graph stats serializes DuckDB counts as JSON-safe numbers", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const ingestRes = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          events: [
            {
              schema: "openplanner.event.v1",
              id: "graph.node:test",
              ts: "2026-04-04T18:00:00Z",
              source: "test-suite",
              kind: "graph.node",
              text: "hello graph",
              extra: {
                url: "https://example.com/test",
                title: "test",
              },
            },
            {
              schema: "openplanner.event.v1",
              id: "graph.edge:test",
              ts: "2026-04-04T18:00:00Z",
              source: "test-suite",
              kind: "graph.edge",
              text: "https://example.com/test -> https://example.com/next",
              extra: {
                source: "https://example.com/test",
                target: "https://example.com/next",
              },
            },
          ],
        }),
      });

      assert.equal(ingestRes.statusCode, 200);

      const statsRes = await app.inject({
        method: "GET",
        url: "/v1/graph/stats",
        headers: authHeader(cfg.apiKey),
      });

      assert.equal(statsRes.statusCode, 200);
      const body = statsRes.json();
      assert.equal(typeof body.nodeCount, "number");
      assert.equal(typeof body.edgeCount, "number");
      assert.equal(body.nodeCount, 1);
      assert.equal(body.edgeCount, 1);
    } finally {
      await app.close();
    }
  });
});

test("GET /v1/lakes groups lake inventory by project and kind", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const ingestRes = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          events: [
            {
              schema: "openplanner.event.v1",
              id: "lake.docs.1",
              ts: "2026-04-04T18:00:00Z",
              source: "test-suite",
              kind: "docs",
              source_ref: { project: "devel-docs", message: "Doc one" },
              text: "doc one",
            },
            {
              schema: "openplanner.event.v1",
              id: "lake.docs.2",
              ts: "2026-04-04T18:05:00Z",
              source: "test-suite",
              kind: "docs",
              source_ref: { project: "devel-docs", message: "Doc two" },
              text: "doc two",
            },
            {
              schema: "openplanner.event.v1",
              id: "lake.code.1",
              ts: "2026-04-04T18:10:00Z",
              source: "test-suite",
              kind: "code",
              source_ref: { project: "devel-code", message: "Code one" },
              text: "println :ok",
            },
          ],
        }),
      });

      assert.equal(ingestRes.statusCode, 200);

      const lakesRes = await app.inject({
        method: "GET",
        url: "/v1/lakes",
        headers: authHeader(cfg.apiKey),
      });

      assert.equal(lakesRes.statusCode, 200);
      const body = lakesRes.json();
      assert.equal(body.ok, true);
      assert.equal(body.count, 2);
      assert.ok(Array.isArray(body.lakes));

      const docsLake = body.lakes.find((row: any) => row.project === "devel-docs");
      assert.ok(docsLake);
      assert.equal(docsLake.totalEvents, 2);
      assert.equal(docsLake.kinds.docs, 2);

      const codeLake = body.lakes.find((row: any) => row.project === "devel-code");
      assert.ok(codeLake);
      assert.equal(codeLake.totalEvents, 1);
      assert.equal(codeLake.kinds.code, 1);
    } finally {
      await app.close();
    }
  });
});

test("session routes can be scoped to a specific project", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const ingestRes = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          events: [
            {
              schema: "openplanner.event.v1",
              id: "legacy.session.row",
              ts: "2026-04-04T18:00:00Z",
              source: "test-suite",
              kind: "knoxx.message",
              source_ref: { project: "devel", session: "shared-session", message: "legacy" },
              text: "legacy row",
              extra: { org_id: "org-1", user_id: "user-1" },
            },
            {
              schema: "openplanner.event.v1",
              id: "session.row",
              ts: "2026-04-04T18:01:00Z",
              source: "test-suite",
              kind: "knoxx.message",
              source_ref: { project: "knoxx-session", session: "shared-session", message: "session" },
              text: "session row",
              extra: { org_id: "org-1", user_id: "user-1" },
            },
          ],
        }),
      });

      assert.equal(ingestRes.statusCode, 200);

      const listRes = await app.inject({
        method: "GET",
        url: "/v1/sessions?project=knoxx-session",
        headers: authHeader(cfg.apiKey),
      });
      assert.equal(listRes.statusCode, 200);
      const listBody = listRes.json();
      assert.equal(listBody.rows.length, 1);
      assert.equal(listBody.rows[0].project, "knoxx-session");

      const detailRes = await app.inject({
        method: "GET",
        url: "/v1/sessions/shared-session?project=knoxx-session",
        headers: authHeader(cfg.apiKey),
      });
      assert.equal(detailRes.statusCode, 200);
      const detailBody = detailRes.json();
      assert.equal(detailBody.rows.length, 1);
      assert.equal(detailBody.rows[0].project, "knoxx-session");
      assert.equal(detailBody.rows[0].text, "session row");
    } finally {
      await app.close();
    }
  });
});

test("POST /v1/lakes/purge removes legacy projects from storage", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const ingestRes = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          events: [
            {
              schema: "openplanner.event.v1",
              id: "purge.legacy",
              ts: "2026-04-04T18:00:00Z",
              source: "test-suite",
              kind: "docs",
              source_ref: { project: "devel-docs", session: "legacy-session", message: "legacy" },
              text: "legacy docs",
            },
            {
              schema: "openplanner.event.v1",
              id: "purge.keep",
              ts: "2026-04-04T18:01:00Z",
              source: "test-suite",
              kind: "docs",
              source_ref: { project: "devel", session: "canonical-session", message: "keep" },
              text: "canonical docs",
            },
          ],
        }),
      });
      assert.equal(ingestRes.statusCode, 200);

      const purgeRes = await app.inject({
        method: "POST",
        url: "/v1/lakes/purge",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json",
        },
        payload: JSON.stringify({ projects: ["devel-docs"] }),
      });
      assert.equal(purgeRes.statusCode, 200);
      const purgeBody = purgeRes.json();
      assert.equal(purgeBody.deletedEvents, 1);

      const lakesRes = await app.inject({
        method: "GET",
        url: "/v1/lakes",
        headers: authHeader(cfg.apiKey),
      });
      const lakesBody = lakesRes.json();
      assert.equal(lakesBody.lakes.some((row: any) => row.project === "devel-docs"), false);
      assert.equal(lakesBody.lakes.some((row: any) => row.project === "devel"), true);
    } finally {
      await app.close();
    }
  });
});

test("GET /v1/graph/export returns canonical graph nodes and edges", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const ingestRes = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          events: [
            {
              schema: "openplanner.event.v1",
              id: "graph.node:devel-doc",
              ts: "2026-04-04T18:00:00Z",
              source: "test-suite",
              kind: "graph.node",
              source_ref: { project: "devel", message: "devel:file:docs/INDEX.md" },
              extra: {
                lake: "devel",
                node_id: "devel:file:docs/INDEX.md",
                node_type: "docs",
                label: "INDEX.md",
                path: "docs/INDEX.md",
              },
            },
            {
              schema: "openplanner.event.v1",
              id: "graph.node:web-home",
              ts: "2026-04-04T18:00:01Z",
              source: "test-suite",
              kind: "graph.node",
              source_ref: { project: "web", message: "web:url:https://example.com/" },
              extra: {
                lake: "web",
                node_id: "web:url:https://example.com/",
                node_type: "visited",
                label: "example.com",
                url: "https://example.com/",
              },
            },
            {
              schema: "openplanner.event.v1",
              id: "graph.edge:devel-to-web",
              ts: "2026-04-04T18:00:02Z",
              source: "test-suite",
              kind: "graph.edge",
              source_ref: { project: "devel", message: "devel:file:docs/INDEX.md -> web:url:https://example.com/" },
              extra: {
                lake: "devel",
                edge_id: "devel:edge:external_web_link:docs/INDEX.md:https://example.com/",
                edge_type: "external_web_link",
                source_node_id: "devel:file:docs/INDEX.md",
                target_node_id: "web:url:https://example.com/",
                source_lake: "devel",
                target_lake: "web",
                anchor_text: "Example",
                anchor_context: "See Example for more details",
                dom_path: "body/main/article/p/a",
                block_signature: "host:docs.example:block:test123",
                block_role: "main_content",
              },
            },
          ],
        }),
      });

      assert.equal(ingestRes.statusCode, 200);

      const exportRes = await app.inject({
        method: "GET",
        url: "/v1/graph/export?projects=devel,web",
        headers: authHeader(cfg.apiKey),
      });

      assert.equal(exportRes.statusCode, 200);
      const body = exportRes.json();
      assert.equal(body.ok, true);
      assert.equal(body.counts.nodes, 2);
      assert.equal(body.counts.edges, 1);

      const develNode = body.nodes.find((row: any) => row.id === "devel:file:docs/INDEX.md");
      assert.ok(develNode);
      assert.equal(develNode.lake, "devel");
      assert.equal(develNode.nodeType, "docs");

      const webNode = body.nodes.find((row: any) => row.id === "web:url:https://example.com/");
      assert.ok(webNode);
      assert.equal(webNode.kind, "url");
      assert.equal(webNode.nodeType, "visited");

      const edge = body.edges.find((row: any) => row.id === "devel:edge:external_web_link:docs/INDEX.md:https://example.com/");
      assert.ok(edge);
      assert.equal(edge.kind, "external_web_link");
      assert.equal(edge.sourceLake, "devel");
      assert.equal(edge.targetLake, "web");
      assert.equal(edge.data.anchor_text, "Example");
      assert.equal(edge.data.block_role, "main_content");
    } finally {
      await app.close();
    }
  });
});

test("GET /v1/graph/query searches graph nodes and returns incident edges", async () => {
  await withTempDir(async (dir) => {
    const cfg = testConfig(dir);
    const app = await buildApp(cfg);
    try {
      const ingestRes = await app.inject({
        method: "POST",
        url: "/v1/events",
        headers: {
          ...authHeader(cfg.apiKey),
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          events: [
            {
              schema: "openplanner.event.v1",
              id: "kg.node.session",
              ts: "2026-04-04T18:00:00Z",
              source: "test-suite",
              kind: "graph.node",
              source_ref: { project: "knoxx-session", session: "kg-session", message: "kg.node.session" },
              text: "assistant mentioned orgs/open-hax/openplanner/README.md",
              extra: {
                lake: "knoxx-session",
                node_id: "knoxx-session:run:test:assistant",
                node_type: "assistant_message",
                label: "assistant message",
                path: "orgs/open-hax/openplanner/README.md",
              },
            },
            {
              schema: "openplanner.event.v1",
              id: "kg.node.devel",
              ts: "2026-04-04T18:00:00Z",
              source: "test-suite",
              kind: "graph.node",
              source_ref: { project: "devel", message: "kg.node.devel" },
              text: "README",
              extra: {
                lake: "devel",
                node_id: "devel:file:orgs/open-hax/openplanner/README.md",
                node_type: "docs",
                label: "README.md",
                path: "orgs/open-hax/openplanner/README.md",
              },
            },
            {
              schema: "openplanner.event.v1",
              id: "kg.edge.session.devel",
              ts: "2026-04-04T18:00:01Z",
              source: "test-suite",
              kind: "graph.edge",
              source_ref: { project: "knoxx-session", session: "kg-session", message: "kg.edge.session.devel" },
              text: "assistant message -> devel readme",
              extra: {
                lake: "knoxx-session",
                edge_id: "kg.edge.session.devel",
                edge_type: "mentions_devel_path",
                source_node_id: "knoxx-session:run:test:assistant",
                target_node_id: "devel:file:orgs/open-hax/openplanner/README.md",
                source_lake: "knoxx-session",
                target_lake: "devel",
              },
            },
          ],
        }),
      });
      assert.equal(ingestRes.statusCode, 200);

      const queryRes = await app.inject({
        method: "GET",
        url: "/v1/graph/query?q=README&projects=knoxx-session,devel&limit=5&edgeLimit=5",
        headers: authHeader(cfg.apiKey),
      });
      assert.equal(queryRes.statusCode, 200);
      const body = queryRes.json();
      assert.equal(body.ok, true);
      assert.ok(body.nodes.some((node: any) => node.id === "devel:file:orgs/open-hax/openplanner/README.md"));
      assert.ok(body.edges.some((edge: any) => edge.id === "kg.edge.session.devel"));
    } finally {
      await app.close();
    }
  });
});
