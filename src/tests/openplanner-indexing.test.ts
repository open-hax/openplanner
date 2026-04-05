import assert from "node:assert/strict";
import test from "node:test";
import { prepareIndexDocument } from "../lib/indexing.js";
import { mergeTieredVectorHits, type TieredVectorHit } from "../lib/vector-search.js";

test("prepareIndexDocument converts html input into markdown-like text", () => {
  const prepared = prepareIndexDocument({
    parentId: "web:url:https://example.com/page",
    text: `<!doctype html><html><head><style>.x{color:red}</style></head><body><article><h1>Hello</h1><p>World</p><script>alert(1)</script></article></body></html>`,
  });

  assert.equal(prepared.normalizedFormat, "markdown");
  assert.match(prepared.normalizedText, /^# Hello/m);
  assert.match(prepared.normalizedText, /World/);
  assert.doesNotMatch(prepared.normalizedText, /alert\(1\)/);
  assert.equal(prepared.chunkCount, 1);
});

test("prepareIndexDocument chunks oversized text automatically", () => {
  const repeated = Array.from({ length: 5000 }, (_, index) => `Paragraph ${index}: ${"lorem ipsum dolor sit amet ".repeat(8)}`).join("\n\n");
  const prepared = prepareIndexDocument({
    parentId: "doc:big",
    text: repeated,
    forceChunking: true,
    targetChunkTokens: 200,
    targetChunkChars: 800,
    overlapChars: 0,
  });

  assert.ok(prepared.chunkCount > 1);
  assert.equal(prepared.chunks[0]?.id, "doc:big#chunk:0000");
  assert.ok(prepared.chunks.every((chunk) => chunk.text.length <= 1200));
});

test("mergeTieredVectorHits collapses chunk hits onto the parent id", () => {
  const hits: TieredVectorHit[] = [
    {
      id: "doc:1#chunk:0000",
      tier: "hot",
      rank: 0,
      document: "chunk zero",
      metadata: { parent_id: "doc:1", chunk_index: 0 },
      distance: 0.12,
    },
    {
      id: "doc:1#chunk:0001",
      tier: "hot",
      rank: 1,
      document: "chunk one",
      metadata: { parent_id: "doc:1", chunk_index: 1 },
      distance: 0.18,
    },
  ];

  const merged = mergeTieredVectorHits([hits], 10) as {
    ids: string[][];
    metadatas: Array<Array<Record<string, unknown>>>;
  };

  assert.deepEqual(merged.ids[0], ["doc:1"]);
  assert.equal(merged.metadatas[0]?.[0]?.parent_id, "doc:1");
  assert.equal(merged.metadatas[0]?.[0]?.best_match_id, "doc:1#chunk:0000");
});
