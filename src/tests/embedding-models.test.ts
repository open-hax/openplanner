import assert from "node:assert/strict";
import test from "node:test";
import { parseModelMap, resolveEmbeddingModel, type EmbeddingModelConfig } from "../lib/embedding-models.js";
import type { EmbeddingRuntime } from "../../packages/openplanner-sdk/src/embedding-runtime.js";
import { ingestEvents } from "../../packages/openplanner-sdk/src/ingest.js";
import type { MongoConnection } from "../../packages/openplanner-sdk/src/mongodb.js";
import type { EventEnvelopeV1 } from "../../packages/openplanner-sdk/src/types.js";

function config(overrides: Partial<EmbeddingModelConfig> = {}): EmbeddingModelConfig {
  return {
    defaultModel: "qwen3-embedding:0.6b",
    bySource: {},
    byKind: {},
    byProject: {},
    ...overrides
  };
}

test("parseModelMap supports key=value list", () => {
  const parsed = parseModelMap("chatgpt=qwen3-embedding:4b;discord=qwen3-embedding:0.6b");
  assert.deepEqual(parsed, {
    chatgpt: "qwen3-embedding:4b",
    discord: "qwen3-embedding:0.6b"
  });
});

test("parseModelMap supports JSON map", () => {
  const parsed = parseModelMap('{"chatgpt-export":"qwen3-embedding:4b"}');
  assert.deepEqual(parsed, {
    "chatgpt-export": "qwen3-embedding:4b"
  });
});

test("resolveEmbeddingModel uses project then source then kind then default", () => {
  const resolved = resolveEmbeddingModel(
    config({
      byProject: { chatgpt: "proj-model" },
      bySource: { "chatgpt-export": "source-model" },
      byKind: { message: "kind-model" }
    }),
    {
      project: "chatgpt",
      source: "chatgpt-export",
      kind: "message"
    }
  );
  assert.equal(resolved, "proj-model");
});

test("resolveEmbeddingModel falls back correctly", () => {
  const cfg = config({
    bySource: { "chatgpt-export": "source-model" },
    byKind: { message: "kind-model" }
  });
  assert.equal(resolveEmbeddingModel(cfg, { source: "chatgpt-export", kind: "message" }), "source-model");
  assert.equal(resolveEmbeddingModel(cfg, { kind: "message" }), "kind-model");
  assert.equal(resolveEmbeddingModel(cfg, { source: "unknown" }), "qwen3-embedding:0.6b");
});

test("regular ingest writes hot metadata and label topology for an eligible event", async () => {
  const passage = "This synthetic message checks active ingest metadata.";
  const envelope: EventEnvelopeV1 = {
    schema: "openplanner.event.v1",
    id: "event:synthetic-eligible",
    ts: "2026-11-20T00:00:00.000Z",
    source: "fixture",
    kind: "message",
    text: passage,
    source_ref: { project: "shared-project", session: "fixture-session", message: "Synthetic title" },
    meta: { role: "assistant", author: "fixture-author", model: "source-model" },
    extra: { visibility: "review", openplanner_labels: { quality: "good", labels: ["fixture", "fixture"] } },
  };
  type Doc = Readonly<Record<string, unknown>>;
  type Write = { readonly updateOne: { readonly update: { readonly $set: Doc } } };
  const writes = new Map<string, readonly Doc[]>();
  const partitions = new Map<string, Doc>();
  const scopes = new Set<Doc>();
  const capture = (collection: string) => async (rows: readonly Write[]) => {
    writes.set(collection, rows.map(({ updateOne }) => updateOne.update.$set));
  };
  const partitionCollection = {
    createIndex: async () => undefined,
    listSearchIndexes: (name: string) => ({
      toArray: async () => [{ name, status: "READY", queryable: true }],
    }),
    deleteMany: async () => undefined,
    bulkWrite: capture("partition"),
  };
  const mongo = {
    events: { insertOne: async () => undefined, bulkWrite: capture("events") },
    graphEdges: { bulkWrite: capture("edges") },
    graphLabelNodes: { bulkWrite: capture("labels") },
    graphNodeEmbeddings: {
      find: () => ({ project: () => ({ toArray: async () => [] }) }),
      bulkWrite: capture("graph"),
    },
    hotVectors: { ...partitionCollection, collectionName: "fixture_hot", bulkWrite: capture("hot") },
    vectorPartitions: {
      updateOne: async ({ _id }: { readonly _id: string }, { $set }: { readonly $set: Doc }) => {
        partitions.set(_id, { ...partitions.get(_id), ...$set, _id });
      },
      findOne: async ({ _id }: { readonly _id: string }) => partitions.get(_id),
      find: () => ({ sort: () => ({ toArray: async () => [...partitions.values()] }) }),
    },
    db: { collection: () => partitionCollection },
    client: {
      startSession: () => ({
        withTransaction: (work: () => Promise<unknown>) => work(),
        endSession: async () => undefined,
      }),
    },
  } as unknown as MongoConnection;
  const generator = { generate: async (texts: readonly string[]) => texts.map(() => [1, 0]) };
  const embeddingRuntime = {
    hot: {
      getModel: () => "embeddinggemma-2",
      getBackgroundEmbeddingFunction: (scope: Doc) => {
        scopes.add(scope);
        return generator;
      },
      getBackgroundEmbeddingFunctionForModel: () => generator,
    },
  } as unknown as EmbeddingRuntime;
  const outcome = await ingestEvents({ mongo, embeddingRuntime }, [envelope]);
  await outcome.backgroundIndexing;
  assert.equal(outcome.queuedEventVectors, 1);
  assert.deepEqual([...scopes], [{ source: "fixture", kind: "message", project: "shared-project" }]);
  const hot = writes.get("hot")?.[0];
  assert.ok(hot);
  assert.equal(hot.parent_id, envelope.id);
  assert.equal(hot.text, passage);
  assert.equal(hot.embedding_model, "embeddinggemma-2");
  assert.equal(hot.quality_label, "good");
  assert.equal(hot.visibility, "review");
  assert.deepEqual(hot.labels, ["fixture"]);
  assert.deepEqual(writes.get("partition")?.[0], hot);
  const label = writes.get("labels")?.[0];
  assert.ok(label);
  assert.equal(label.label, "fixture");
  const edge = writes.get("edges")?.[0];
  assert.ok(edge);
  assert.equal(edge.source_node_id, envelope.id);
  assert.equal(edge.target_node_id, label.label_id);
  assert.equal(edge.edge_kind, "has_label");
});
