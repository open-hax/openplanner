import { describe, expect, it, vi } from "vitest";
import {
  buildEdgeClaimId,
  edgeClaimToApi,
  normalizeEdgeClaimDirection,
  normalizeEdgeClaimStatus,
  resolveGraphMemorySeedNodes,
} from "./graph.js";

describe("resolveGraphMemorySeedNodes", () => {
  it("falls back when native graph vector search returns no usable seeds", async () => {
    const fallbackVectorSearch = vi.fn().mockResolvedValue([
      { nodeId: "devel:file:docs/openplanner.md", score: 0.91, project: "devel" },
      { nodeId: "knoxx-session:run:abc:user", score: 0.72, project: "knoxx-session" },
    ]);

    const result = await resolveGraphMemorySeedNodes({
      k: 2,
      lakeRegexes: [],
      nodeTypes: null,
      minVectorSimilarity: 0.35,
      nativeVectorSearch: async () => [],
      fallbackVectorSearch,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(fallbackVectorSearch).toHaveBeenCalledTimes(1);
    expect(result.vectorHitCount).toBe(2);
    expect(result.seedNodeIds).toEqual([
      "devel:file:docs/openplanner.md",
      "knoxx-session:run:abc:user",
    ]);
    expect(result.seedScoresMap.get("devel:file:docs/openplanner.md")).toBe(0.91);
  });

  it("uses native vector matches when they produce scoped seeds", async () => {
    const fallbackVectorSearch = vi.fn().mockResolvedValue([
      { nodeId: "devel:file:docs/fallback.md", score: 0.5, project: "devel" },
    ]);

    const result = await resolveGraphMemorySeedNodes({
      k: 1,
      lakeRegexes: [/^devel:/],
      nodeTypes: ["file"],
      minVectorSimilarity: 0.35,
      nativeVectorSearch: async () => [
        { node_id: "devel:file:docs/openplanner.md", score: 0.81, project: "devel" },
        { node_id: "knoxx-session:run:abc:user", score: 0.99, project: "knoxx-session" },
      ],
      fallbackVectorSearch,
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(fallbackVectorSearch).not.toHaveBeenCalled();
    expect(result.vectorHitCount).toBe(1);
    expect(result.seedNodeIds).toEqual(["devel:file:docs/openplanner.md"]);
    expect(result.seedScoresMap.get("devel:file:docs/openplanner.md")).toBe(0.81);
  });
});

describe("edge claim helpers", () => {
  it("normalizes claim status and direction", () => {
    expect(normalizeEdgeClaimStatus("refuted")).toBe("refuted");
    expect(normalizeEdgeClaimStatus("withdrawn")).toBe("withdrawn");
    expect(normalizeEdgeClaimStatus("not-real")).toBe("proposed");
    expect(normalizeEdgeClaimDirection("undirected")).toBe("undirected");
    expect(normalizeEdgeClaimDirection("directed")).toBe("directed");
  });

  it("builds stable ids for undirected claims regardless of node order", () => {
    const left = buildEdgeClaimId({
      sourceNodeId: "node:b",
      targetNodeId: "node:a",
      relationKind: "supports",
      direction: "undirected",
      scope: { project: "devel" },
    });
    const right = buildEdgeClaimId({
      sourceNodeId: "node:a",
      targetNodeId: "node:b",
      relationKind: "supports",
      direction: "undirected",
      scope: { project: "devel" },
    });

    expect(left).toBe(right);
    expect(left).toMatch(/^edge_claim:[a-f0-9]{24}$/);
  });

  it("serializes edge claims without promoting them to semantic edges", () => {
    const now = new Date("2026-04-30T00:00:00.000Z");
    const api = edgeClaimToApi({
      _id: "edge_claim:abc",
      claim_id: "edge_claim:abc",
      source_node_id: "node:a",
      target_node_id: "node:b",
      relation_kind: "supports",
      direction: "directed",
      scope: { project: "devel" },
      status: "active",
      confidence: 0.9,
      support_event_ids: ["event:1"],
      refute_event_ids: [],
      supersedes_claim_ids: [],
      valid_from: now,
      valid_until: null,
      decay_policy: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(api).toMatchObject({
      claim_id: "edge_claim:abc",
      source_node_id: "node:a",
      target_node_id: "node:b",
      relation_kind: "supports",
      status: "active",
      confidence: 0.9,
    });
    expect(api).not.toHaveProperty("similarity");
  });
});
