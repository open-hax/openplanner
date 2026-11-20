import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareIndexDocument,
  isContextOverflowError,
  batchPreparedChunks,
  type PreparedIndexChunk,
} from "../lib/indexing.js";
import { ObjectId } from "mongodb";
import type { EmbeddingRuntime } from "../../packages/openplanner-sdk/src/embedding-runtime.js";
import {
  formatEmbeddingPassageText,
  planEventGraphProjections,
  planHotEventProjection,
  planStoredEventEmbeddingProjections,
  type StoredProjectionEvent,
} from "../../packages/openplanner-sdk/src/embedding-text.js";
import { ingestEvents } from "../../packages/openplanner-sdk/src/ingest.js";
import type { MongoConnection } from "../../packages/openplanner-sdk/src/mongodb.js";
import { computeTextHash } from "../../packages/openplanner-sdk/src/sentence-split.js";
import type { EventEnvelopeV1 } from "../../packages/openplanner-sdk/src/types.js";

test("isContextOverflowError matches ollama context overflow", () => {
  assert.ok(isContextOverflowError(new Error("ollama_context_overflow")));
  assert.ok(isContextOverflowError(new Error("context window exceeded")));
  assert.ok(isContextOverflowError(new Error("exceeds model context window")));
  assert.ok(isContextOverflowError(new Error("Context size has been exceeded.")));
  assert.ok(isContextOverflowError(new Error("embed_input_too_large")));
  assert.ok(isContextOverflowError(new Error("embedding input is too large")));
  assert.ok(isContextOverflowError(new Error("input is too large")));
  assert.ok(isContextOverflowError(new Error("maximum: 200000")));
});

test("isContextOverflowError matches exceed_context_size_error from embed provider", () => {
  const err = new Error(
    'Embed provider failed: 400 Bad Request\n{"error":{"code":400,"message":"request (56759 tokens) exceeds the available context size (32768 tokens)","type":"exceed_context_size_error"}}'
  );
  assert.ok(isContextOverflowError(err), "exceed_context_size_error should be detected");

  const err2 = new Error(
    '{"error":{"code":400,"message":"Embedding upstream rejected the request: {\\"error\\\":{\\"type\\":\\"exceed_context_size_error\\"}}","type":"invalid_request_error"}}'
  );
  assert.ok(isContextOverflowError(err2), "nested exceed_context_size_error should be detected");
});

test("isContextOverflowError returns false for unrelated errors", () => {
  assert.ok(!isContextOverflowError(new Error("connection refused")));
  assert.ok(!isContextOverflowError(new Error("model not found")));
  assert.ok(!isContextOverflowError(new Error("rate limit exceeded")));
  assert.ok(!isContextOverflowError(new Error("timeout")));
  assert.ok(!isContextOverflowError(null));
  assert.ok(!isContextOverflowError(undefined));
  assert.ok(!isContextOverflowError("just a string"));
});

test("prepareIndexDocument returns single chunk for small text", () => {
  const result = prepareIndexDocument({
    parentId: "test-doc",
    text: "Hello world this is a short document.",
  });
  assert.equal(result.chunkCount, 1, "short text should not be chunked");
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0]!.id, "test-doc");
  assert.equal(result.chunks[0]!.chunkIndex, 0);
  assert.equal(result.chunks[0]!.chunkCount, 1);
  assert.equal(result.chunks[0]!.charStart, 0);
  assert.equal(result.chunks[0]!.charEnd, result.normalizedText.length);
});

test("prepareIndexDocument chunks large text", () => {
  const longText = "Word ".repeat(10_000);
  const result = prepareIndexDocument({
    parentId: "big-doc",
    text: longText,
    targetChunkTokens: 1_000,
    targetChunkChars: 10_000,
    overlapChars: 500,
  });
  assert.ok(result.chunkCount > 1, `expected chunking, got count=${result.chunkCount}`);
  for (let i = 0; i < result.chunks.length; i++) {
    const chunk = result.chunks[i]!;
    assert.equal(chunk.id, `big-doc#chunk:${String(i).padStart(4, "0")}`, `chunk ${i} id mismatch`);
    assert.equal(chunk.chunkIndex, i);
    assert.equal(chunk.chunkCount, result.chunkCount);
    if (chunk.charStart !== null && chunk.charStart !== undefined && chunk.charEnd !== null && chunk.charEnd !== undefined) {
      assert.equal(result.normalizedText.slice(chunk.charStart, chunk.charEnd), chunk.text);
    }
  }
});

test("prepareIndexDocument forceChunking overrides small text", () => {
  const result = prepareIndexDocument({
    parentId: "small-but-forced",
    text: "Tiny doc.",
    forceChunking: true,
    targetChunkTokens: 4_000,
    targetChunkChars: 16_000,
  });
  assert.ok(result.chunkCount > 1 || result.chunks.length >= 1, "should produce chunks");
});

test("prepareIndexDocument stores correct estimated tokens", () => {
  const text = "The quick brown fox jumps over the lazy dog.";
  const result = prepareIndexDocument({ parentId: "tok-test", text });
  assert.ok(result.rawEstimatedTokens > 0, "rawEstimatedTokens should be > 0");
  assert.ok(result.normalizedEstimatedTokens > 0, "normalizedEstimatedTokens should be > 0");
});

test("prepareIndexDocument preserves parentId", () => {
  const result = prepareIndexDocument({ parentId: "my-special-id", text: "Some text here." });
  assert.equal(result.parentId, "my-special-id");
});

test("batchPreparedChunks respects token budget", () => {
  const chunks: PreparedIndexChunk[] = Array.from({ length: 10 }, (_, i) => ({
    id: `chunk-${i}`,
    text: `Word `.repeat(100),
    chunkIndex: i,
    chunkCount: 10,
  }));

  const batches = batchPreparedChunks(chunks, { maxBatchTokens: 1_000, maxBatchItems: 3 });
  assert.ok(batches.length > 1, `expected multiple batches, got ${batches.length}`);

  let totalChunks = 0;
  for (const batch of batches) {
    assert.ok(batch.length <= 3, `batch size ${batch.length} exceeds maxBatchItems=3`);
    totalChunks += batch.length;
  }
  assert.equal(totalChunks, 10, "all chunks should be accounted for");
});

test("batchPreparedChunks handles empty input", () => {
  const batches = batchPreparedChunks([]);
  assert.deepEqual(batches, []);
});

test("batchPreparedChunks handles single chunk", () => {
  const chunks: PreparedIndexChunk[] = [{
    id: "solo",
    text: "Only one.",
    chunkIndex: 0,
    chunkCount: 1,
  }];
  const batches = batchPreparedChunks(chunks);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.length, 1);
});

test("DEFAULT limits are conservative for 8k context", () => {
  const result = prepareIndexDocument({
    parentId: "limit-check",
    text: "Word ".repeat(7_000),
    targetChunkTokens: 4_000,
    targetChunkChars: 16_000,
  });
  for (const chunk of result.chunks) {
    assert.ok(
      chunk.text.length <= 16_000,
      `chunk chars ${chunk.text.length} exceeds 16k limit`
    );
  }
});
const timestamp = "2026-11-20T00:00:00.000Z";
const passage = "This synthetic passage has a stable embedding projection.";

function stored(overrides: Partial<StoredProjectionEvent> = {}): StoredProjectionEvent {
  return {
    _id: new ObjectId(),
    id: "event:synthetic",
    ts: new Date(timestamp),
    source: "fixture",
    kind: "message",
    project: "shared-project",
    session: "fixture-session",
    message: "Synthetic title",
    role: "assistant",
    author: "fixture-author",
    model: "source-model",
    text: passage,
    extra: { visibility: "review", openplanner_labels: { quality: "good", labels: ["fixture", "fixture"] } },
    ...overrides,
  };
}

const envelope: EventEnvelopeV1 = {
  schema: "openplanner.event.v1",
  id: "event:synthetic",
  ts: timestamp,
  source: "fixture",
  kind: "message",
  text: passage,
  source_ref: { project: "shared-project", session: "fixture-session", message: "Synthetic title" },
  meta: { role: "assistant", author: "fixture-author", model: "source-model" },
  extra: { visibility: "review", openplanner_labels: { quality: "good", labels: ["fixture", "fixture"] } },
};

type DerivedTopology = ReturnType<typeof planEventGraphProjections>["derivedGraphNodes"][number];

function topologyMirror(derived: DerivedTopology): StoredProjectionEvent {
  return stored({
    _id: derived.id,
    id: derived.id,
    ts: derived.ts,
    source: "openplanner-derive",
    kind: "graph.node",
    project: derived.project,
    session: null,
    message: derived.label,
    role: null,
    author: null,
    model: null,
    text: "",
    extra: {
      node_id: derived.nodeId,
      node_kind: derived.nodeKind,
      label: derived.label,
      preview: derived.preview,
      content_hash: computeTextHash(derived.preview),
      lake: derived.project,
      ...derived.extra,
    },
  });
}

test("stored replay preserves logical identity and shares the normal hot projection", () => {
  const source = Object.freeze({ ...stored(), _id: new ObjectId("000000000000000000000001") });
  const before = JSON.stringify(source);
  const graphEdge = stored({ id: "event:edge", kind: "graph.edge" });
  const blank = stored({ id: "event:blank", text: " \n " });
  const explicit = stored({
    id: "event:graph",
    kind: "graph.node",
    text: null,
    extra: { node_id: "node:preview", preview: "A synthetic graph preview." },
  });
  const projected = planStoredEventEmbeddingProjections([source, graphEdge, blank, explicit]);
  assert.deepEqual(Object.keys(projected), ["hot", "graph", "sharedGraphSources"]);
  assert.deepEqual(projected.sharedGraphSources, []);
  assert.deepEqual(projected.hot, [planHotEventProjection(envelope)]);
  assert.deepEqual(projected.graph.find((row) => row.node_id === source.id), {
    node_id: source.id,
    source_event_id: source.id,
    project: source.project,
    text: formatEmbeddingPassageText(passage),
    chunk_count: 1,
  });
  assert.deepEqual(projected.graph.find((row) => row.node_id === "node:preview"), {
    node_id: "node:preview",
    source_event_id: "event:graph",
    project: explicit.project,
    text: formatEmbeddingPassageText("A synthetic graph preview."),
    chunk_count: 1,
  });
  assert.ok(projected.graph.every((row) => row.source_event_id !== blank.id && row.source_event_id !== graphEdge.id));
  assert.equal(JSON.stringify(source), before);
});

test("a verified derived topology mirror retains the original graph embedding owner", () => {
  const [derived] = planEventGraphProjections(envelope).derivedGraphNodes;
  assert.ok(derived);
  const mirror = topologyMirror(derived);
  const expected = planStoredEventEmbeddingProjections([stored()]);
  assert.deepEqual(planStoredEventEmbeddingProjections([stored(), mirror]), expected);
  assert.deepEqual(planStoredEventEmbeddingProjections([mirror, stored()]), expected);
  assert.equal(expected.graph[0]?.source_event_id, envelope.id);
  assert.throws(() => planStoredEventEmbeddingProjections([stored(), {
    ...mirror,
    extra: { ...(mirror.extra as object), source_event_id: "event:unverified" },
  }]), /lacks a unique verified source owner/);
  assert.throws(() => planStoredEventEmbeddingProjections([mirror]), /lacks a unique verified source owner/);
});

test("stored topology replay follows ordinary ingestion metadata overrides", () => {
  const extra = { node_id: "ignored-overlay-node", preview: "Ignored synthetic metadata preview." };
  const [derived] = planEventGraphProjections({ ...envelope, extra }).derivedGraphNodes;
  assert.ok(derived);
  const mirror = topologyMirror(derived);
  assert.equal((mirror.extra as typeof extra).node_id, extra.node_id);
  assert.equal((mirror.extra as typeof extra).preview, extra.preview);
  const result = planStoredEventEmbeddingProjections([mirror, stored({ extra })]);
  assert.deepEqual(result.graph.map(({ node_id, text }) => ({ node_id, text })), [
    { node_id: envelope.id, text: formatEmbeddingPassageText(passage) },
  ]);
  assert.deepEqual(result.sharedGraphSources, []);
});

test("a caller-supplied source name does not give an admitted row mirror provenance", () => {
  const caller = stored({
    id: "graph.node:derive:synthetic-authoritative-source",
    source: "openplanner-derive",
    kind: "graph.node",
    extra: { node_id: "node:caller" },
  });
  const replay = planStoredEventEmbeddingProjections([caller]);
  assert.ok(replay.graph.some(({ node_id, source_event_id }) =>
    node_id === "node:caller" && source_event_id === caller.id));
});

test("shared sentence coverage retains both sources and prefers the verified topology owner", (t) => {
  const original = process.env.EMBED_PASSAGE_TEMPLATE;
  process.env.EMBED_PASSAGE_TEMPLATE = "{text}";
  t.after(() => {
    if (original === undefined) delete process.env.EMBED_PASSAGE_TEMPLATE;
    else process.env.EMBED_PASSAGE_TEMPLATE = original;
  });
  const first = stored({ id: "event:one", kind: "graph.node", extra: { node_id: "node:one" } });
  const second = stored({ id: "event:two", kind: "graph.node", extra: { node_id: "node:two" } });
  const graph = planEventGraphProjections({
    ...envelope,
    id: second.id,
    kind: second.kind,
    extra: { node_id: "node:two" },
  });
  const sentence = graph.derivedGraphNodes.find(({ nodeKind }) => nodeKind === "sentence");
  assert.ok(sentence);
  const coverage = [{ nodeId: sentence.nodeId, sourceEventIds: [first.id, second.id] }];
  [[first, second], [second, first]].forEach((rows) => {
    const initial = planStoredEventEmbeddingProjections(rows);
    assert.deepEqual(initial.sharedGraphSources, coverage);
    assert.equal(initial.graph.find(({ node_id }) => node_id === sentence.nodeId)?.source_event_id, first.id);
    const verified = planStoredEventEmbeddingProjections([...rows, topologyMirror(sentence)]);
    assert.deepEqual(verified.sharedGraphSources, coverage);
    assert.equal(verified.graph.find(({ node_id }) => node_id === sentence.nodeId)?.source_event_id, second.id);
  });
  assert.throws(() => planStoredEventEmbeddingProjections([
    first, { ...second, text: passage.toUpperCase() },
  ]), /Conflicting stored event owners/);
});

test("stored replay rejects ambiguous graph ownership and duplicate logical IDs", () => {
  const first = stored({ id: "event:graph-one", kind: "graph.node", extra: { node_id: "shared:node" } });
  const second = stored({ id: "event:graph-two", kind: "graph.node", extra: { node_id: "shared:node" } });
  assert.throws(() => planStoredEventEmbeddingProjections([first, second]), /Conflicting stored event owners/);
  assert.throws(() => planStoredEventEmbeddingProjections([second, first]), /Conflicting stored event owners/);
  assert.throws(() => planStoredEventEmbeddingProjections([first, first]), /Duplicate stored event identity/);
  assert.throws(() => planStoredEventEmbeddingProjections([stored({ ts: new Date(Number.NaN) })]),
    /Invalid stored event identity/);
  [{ source: 42 }, { kind: true }].forEach((fields) => {
    const malformed = { ...stored(), ...fields } as unknown as StoredProjectionEvent;
    assert.throws(() => planStoredEventEmbeddingProjections([malformed]), /Invalid stored event identity/);
  });
  const badText = { ...stored(), text: 42 } as unknown as StoredProjectionEvent;
  assert.throws(() => planStoredEventEmbeddingProjections([badText]), /Invalid stored event text/);
});

test("a chunked document retains an explicit parent claim even without a parent vector", () => {
  const short = stored({ id: "event:short", kind: "graph.node", extra: { node_id: "node:parent" } });
  const long = stored({
    ...short,
    id: "event:long",
    text: Array.from({ length: 3000 }, () => "Separate synthetic words cause chunking across this document.").join(" "),
  });
  const projectedLong = planStoredEventEmbeddingProjections([long]);
  assert.ok(projectedLong.graph.some(({ chunk_count }) => chunk_count > 1));
  assert.ok(projectedLong.graph.every(({ node_id }) => node_id !== "node:parent"));
  assert.throws(() => planStoredEventEmbeddingProjections([short, long]), /Conflicting stored event owners/);
});

test("an ordinary sentence event cannot claim a generated sentence vector key", () => {
  const document = stored({ id: "event:document", kind: "graph.node", extra: { node_id: "node:document" } });
  const sentenceId = `shared-project:sentence:${computeTextHash(passage)}`;
  const ordinary = stored({ id: sentenceId, kind: "sentence" });
  assert.throws(() => planStoredEventEmbeddingProjections([document, ordinary]), /Conflicting stored event owners/);
});

test("an explicit graph owner remains visible when its own sentence shadows its vector key", () => {
  const document = stored({ id: "event:document", kind: "graph.node", extra: { node_id: "node:document" } });
  const sentenceId = `shared-project:sentence:${computeTextHash(passage)}`;
  const shadowed = stored({ id: "event:shadowed", kind: "graph.node", extra: { node_id: sentenceId } });
  assert.throws(() => planStoredEventEmbeddingProjections([document, shadowed]), /Conflicting stored event owners/);
  assert.throws(() => planStoredEventEmbeddingProjections([{
    ...shadowed, text: `${passage} A second synthetic sentence changes the direct embedding input.`,
  }]), /Conflicting stored event owners/);
});

test("ordinary ingest retains event admission and its graph topology writes", async () => {
  const event: EventEnvelopeV1 = {
    ...envelope,
    id: "event:explicit-ingest",
    kind: "graph.node",
    extra: { node_id: "node:explicit-ingest" },
  };
  const graph = planEventGraphProjections(event);
  assert.ok(graph.derivedGraphNodes.length > 0);
  const admissions: Array<{ id: string }> = [];
  const derivedIds: string[] = [];
  const graphEdgeIds: string[] = [];
  const graphWrites: GraphRow[] = [];
  type Write<T> = { updateOne: { filter: { _id: string }; update: { $set: T } } };
  type GraphRow = { node_id: string; source_event_id: string; text: string };
  const mongo = {
    events: {
      insertOne: async (row: { id: string }) => { admissions.push(row); },
      bulkWrite: async (rows: Write<unknown>[]) => {
        derivedIds.push(...rows.map((row) => row.updateOne.filter._id));
      },
    },
    graphEdges: {
      bulkWrite: async (rows: Write<unknown>[]) => {
        graphEdgeIds.push(...rows.map((row) => row.updateOne.filter._id));
      },
    },
    graphNodeEmbeddings: {
      find: () => ({ project: () => ({ toArray: async () => [] }) }),
      bulkWrite: async (rows: Write<GraphRow>[]) => {
        graphWrites.push(...rows.map((row) => row.updateOne.update.$set));
      },
    },
  } as unknown as MongoConnection;
  const embeddingRuntime = {
    hot: {
      getModel: () => "embeddinggemma-2",
      getBackgroundEmbeddingFunctionForModel: () => ({ generate: async (texts: string[]) => texts.map(() => [1, 0]) }),
    },
  } as unknown as EmbeddingRuntime;
  const outcome = await ingestEvents({ mongo, embeddingRuntime }, [event]);
  await outcome.backgroundIndexing;
  assert.deepEqual(admissions.map(({ id }) => id), [event.id]);
  assert.deepEqual(derivedIds, graph.derivedGraphNodes.map(({ id }) => id));
  assert.equal(graphEdgeIds.length, graph.projectedGraphEdges.length);
  assert.deepEqual(graphWrites.map(({ node_id, source_event_id, text }) => ({ node_id, source_event_id, text })),
    graph.graph.map(({ node_id, source_event_id, text }) => ({ node_id, source_event_id, text })));
});
