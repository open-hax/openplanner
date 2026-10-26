import type { SdkArray, SdkMutable } from "./mongo-vector-data.js";

export type SearchTier = "hot" | "compact";

type RawQueryResult = Partial<{
  readonly ids: readonly (readonly string[])[];
  readonly documents: ReadonlyArray<ReadonlyArray<string | null> | null>;
  readonly metadatas: ReadonlyArray<ReadonlyArray<Record<string, unknown> | null> | null>;
  readonly distances: ReadonlyArray<ReadonlyArray<number | null> | null>;
}>;

// Preserve the existing mutable SDK boundary; internal ranking records are readonly.
export type TieredVectorHit = SdkMutable<{
  readonly id: string;
  readonly tier: SearchTier;
  readonly rank: number;
  readonly document?: string;
  readonly metadata: Record<string, unknown>;
  readonly distance?: number;
}>;

function firstNestedArray<T>(value: unknown): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const first = value[0];
  return Array.isArray(first) ? (first as readonly T[]) : [];
}

export function extractTieredVectorHits(result: unknown, tier: SearchTier): SdkArray<TieredVectorHit> {
  const payload = (result ?? {}) as RawQueryResult;
  const ids = firstNestedArray<string>(payload.ids);
  const documents = firstNestedArray<string | null>(payload.documents);
  const metadatas = firstNestedArray<Record<string, unknown> | null>(payload.metadatas);
  const distances = firstNestedArray<number | null>(payload.distances);

  return ids.map((id, index) => ({
    id,
    tier,
    rank: index,
    document: documents[index] ?? undefined,
    metadata: (metadatas[index] ?? {}) as Record<string, unknown>,
    distance: typeof distances[index] === "number" ? distances[index] ?? undefined : undefined,
  }));
}

type RankedHit = Readonly<TieredVectorHit> & {
  readonly fusedScore: number;
  readonly bestDistance: number;
  readonly searchTiers: ReadonlySet<SearchTier>;
};

function parentIdOf(hit: Readonly<TieredVectorHit>): string {
  const parentId = hit.metadata.parent_id;
  return typeof parentId === "string" && parentId.length > 0 ? parentId : hit.id;
}

function combineHit(existing: RankedHit | undefined, hit: Readonly<TieredVectorHit>): RankedHit {
  const parentId = parentIdOf(hit);
  const reciprocalRank = 1 / (60 + hit.rank + 1);
  const nextDistance = typeof hit.distance === "number" ? hit.distance : Number.POSITIVE_INFINITY;
  const metadata = { ...hit.metadata, parent_id: parentId, best_match_id: hit.id };
  if (!existing) {
    return { ...hit, id: parentId, metadata, fusedScore: reciprocalRank,
      bestDistance: nextDistance, searchTiers: new Set([hit.tier]) };
  }
  const improved = nextDistance < existing.bestDistance ? {
    bestDistance: nextDistance,
    distance: hit.distance,
    document: hit.document || existing.document,
    metadata: { ...existing.metadata, ...metadata },
    tier: hit.tier,
  } : {};
  return { ...existing, fusedScore: existing.fusedScore + reciprocalRank,
    searchTiers: new Set([...existing.searchTiers, hit.tier]), ...improved };
}

export function mergeTieredVectorHits(
  hitsByTier: ReadonlyArray<ReadonlyArray<TieredVectorHit>>,
  limit: number,
): Record<string, unknown> {
  const byId = hitsByTier.reduce((groups, hits) => hits.reduce((current, hit) => {
    const parentId = parentIdOf(hit);
    current.set(parentId, combineHit(current.get(parentId), hit));
    return current;
  }, groups), new Map<string, RankedHit>());

  const merged = [...byId.values()]
    .sort((left, right) => right.fusedScore - left.fusedScore
      || left.bestDistance - right.bestDistance || left.id.localeCompare(right.id))
    .slice(0, Math.max(1, limit));

  return {
    ids: [merged.map((entry) => entry.id)],
    documents: [merged.map((entry) => entry.document ?? "")],
    metadatas: [merged.map((entry) => ({
      ...entry.metadata,
      search_tier: entry.tier,
      search_tiers: [...entry.searchTiers.values()],
      rrf_score: Number(entry.fusedScore.toFixed(8)),
    }))],
    distances: [merged.map((entry) => (Number.isFinite(entry.bestDistance) ? entry.bestDistance : null))],
    include: ["documents", "metadatas", "distances"],
  };
}
