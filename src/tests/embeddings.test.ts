import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PersistentEmbeddingCache } from "../lib/embedding-cache.js";
import { OllamaEmbeddingFunction } from "../lib/embeddings.js";

test("OllamaEmbeddingFunction batches concurrent misses into one Ollama request", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[][] = [];

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
    const inputs = Array.isArray(payload.input) ? payload.input : [];
    requests.push(inputs);
    return {
      ok: true,
      json: async () => ({
        embeddings: inputs.map((text, index) => [index + 1, text.length]),
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const cache = new PersistentEmbeddingCache();
    const embeddingFunction = new OllamaEmbeddingFunction("test-model", "http://ollama.invalid", {
      cache,
      batchWindowMs: 25,
      maxBatchItems: 16,
    });

    const [left, right] = await Promise.all([
      embeddingFunction.generate(["alpha"]),
      embeddingFunction.generate(["beta"]),
    ]);

    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], ["alpha", "beta"]);
    assert.deepEqual(left, [[1, 5]]);
    assert.deepEqual(right, [[2, 4]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OllamaEmbeddingFunction reuses persisted embeddings for the same text", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  const cachePath = path.join(os.tmpdir(), `openplanner-embedding-cache-${Date.now()}-${Math.random()}.jsonl`);

  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    fetchCalls += 1;
    const payload = JSON.parse(String(init?.body ?? "{}")) as { input?: string[] };
    const inputs = Array.isArray(payload.input) ? payload.input : [];
    return {
      ok: true,
      json: async () => ({
        embeddings: inputs.map((text) => [text.length, text.length + 1]),
      }),
    } as Response;
  }) as typeof fetch;

  try {
    const first = new OllamaEmbeddingFunction("test-model", "http://ollama.invalid", {
      cache: new PersistentEmbeddingCache(cachePath),
      batchWindowMs: 5,
      maxBatchItems: 8,
    });
    const second = new OllamaEmbeddingFunction("test-model", "http://ollama.invalid", {
      cache: new PersistentEmbeddingCache(cachePath),
      batchWindowMs: 5,
      maxBatchItems: 8,
    });

    const firstResult = await first.generate(["same document"]);
    const secondResult = await second.generate(["same document"]);

    assert.equal(fetchCalls, 1);
    assert.deepEqual(firstResult, secondResult);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(cachePath, { force: true });
  }
});

test("OllamaEmbeddingFunction observes all failed in-flight batch promises", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => "upstream unavailable",
    } as Response;
  }) as typeof fetch;

  try {
    const embeddingFunction = new OllamaEmbeddingFunction("test-model", "http://ollama.invalid", {
      cache: new PersistentEmbeddingCache(),
      batchWindowMs: 5,
      maxBatchItems: 16,
    });

    await assert.rejects(
      embeddingFunction.generate(["alpha", "beta", "gamma"]),
      /Ollama embed failed: 502 Bad Gateway/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
