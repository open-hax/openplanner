const VEXX_BASE_URL = String(process.env.VEXX_BASE_URL ?? "").trim();
const VEXX_API_KEY = String(process.env.VEXX_API_KEY ?? "").trim();
const VEXX_DEVICE = String(process.env.VEXX_DEVICE ?? "AUTO").trim() || "AUTO";
const VEXX_REQUIRE_ACCEL = /^(1|true|yes|on)$/i.test(String(process.env.VEXX_REQUIRE_ACCEL ?? ""));
const VEXX_ENFORCE = /^(1|true|yes|on)$/i.test(String(process.env.VEXX_ENFORCE ?? ""));
const VEXX_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.VEXX_TIMEOUT_MS ?? "30000");
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 30000;
})();

type ChromaQueryLike = Partial<{
  ids: string[][];
  documents: Array<Array<string | null> | null>;
  metadatas: Array<Array<Record<string, unknown> | null> | null>;
  distances: Array<Array<number | null> | null>;
  embeddings: number[][][];
  include: string[];
}>;

function firstNestedArray<T>(value: unknown): T[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const first = value[0];
  return Array.isArray(first) ? (first as T[]) : [];
}

export function vexxEnabled(): boolean {
  return VEXX_BASE_URL.length > 0;
}

export function vexxEnforced(): boolean {
  return VEXX_ENFORCE;
}

export function vexxRequiredError(context: string): Error {
  return new Error(`vexx_required:${context}`);
}

export async function rerankChromaQueryWithVexx(params: {
  context: string;
  queryEmbedding: number[];
  result: ChromaQueryLike;
  k: number;
}): Promise<ChromaQueryLike | null> {
  if (!vexxEnabled()) {
    if (vexxEnforced()) throw vexxRequiredError(params.context);
    return null;
  }

  const ids = firstNestedArray<string>(params.result.ids);
  const documents = firstNestedArray<string | null>(params.result.documents);
  const metadatas = firstNestedArray<Record<string, unknown> | null>(params.result.metadatas);
  const embeddings = firstNestedArray<number[]>(params.result.embeddings);
  if (ids.length === 0) {
    return {
      ids: [[]],
      documents: [[]],
      metadatas: [[]],
      distances: [[]],
      include: ["documents", "metadatas", "distances"],
    };
  }

  const candidates = ids
    .map((id, index) => ({
      id,
      embedding: embeddings[index],
      document: documents[index] ?? "",
      metadata: (metadatas[index] ?? {}) as Record<string, unknown>,
    }))
    .filter((candidate) => Array.isArray(candidate.embedding) && candidate.embedding.length === params.queryEmbedding.length);

  if (candidates.length === 0) {
    if (vexxEnforced()) throw vexxRequiredError(`${params.context}:empty_candidates`);
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VEXX_TIMEOUT_MS);
  try {
    const response = await fetch(`${VEXX_BASE_URL.replace(/\/$/, "")}/v1/cosine/topk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(VEXX_API_KEY ? { Authorization: `Bearer ${VEXX_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        query: params.queryEmbedding,
        candidates: candidates.map((candidate) => ({ id: candidate.id, embedding: candidate.embedding })),
        k: Math.max(1, params.k),
        device: VEXX_DEVICE,
        requireAccel: VEXX_REQUIRE_ACCEL,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      if (vexxEnforced()) {
        throw new Error(`vexx_required:${params.context}:${response.status}`);
      }
      return null;
    }

    const payload = await response.json() as { matches?: Array<{ id?: string; score?: number }> };
    if (!Array.isArray(payload.matches)) {
      if (vexxEnforced()) throw vexxRequiredError(`${params.context}:invalid_payload`);
      return null;
    }

    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const ranked = payload.matches
      .map((match, rank) => {
        const id = typeof match.id === "string" ? match.id : "";
        const candidate = byId.get(id);
        const score = typeof match.score === "number" ? match.score : Number.NEGATIVE_INFINITY;
        if (!candidate || !Number.isFinite(score)) return null;
        return {
          id,
          document: candidate.document,
          metadata: candidate.metadata,
          distance: 1 - score,
          rank,
        };
      })
      .filter((entry): entry is { id: string; document: string; metadata: Record<string, unknown>; distance: number; rank: number } => entry !== null)
      .slice(0, Math.max(1, params.k));

    return {
      ids: [ranked.map((entry) => entry.id)],
      documents: [ranked.map((entry) => entry.document)],
      metadatas: [ranked.map((entry) => entry.metadata)],
      distances: [ranked.map((entry) => entry.distance)],
      include: ["documents", "metadatas", "distances"],
    };
  } catch (error) {
    if (vexxEnforced()) throw error;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
