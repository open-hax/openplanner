import { describe, expect, it, vi } from "vitest";
import { resolveGraphMemorySeedNodes } from "./graph.js";

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
