import { isDeepStrictEqual } from "node:util";
import { prepareIndexDocument, type PreparedIndexChunk } from "./indexing.js";
import type { EventDocument } from "./mongodb.js";
import { computeTextHash, deduplicateByHash, splitSentences, type SentenceWithHash } from "./sentence-split.js";
import type { EventEnvelopeV1 } from "./types.js";

function expandEscapedNewlines(value: string): string {
  return value.replaceAll("\\n", "\n");
}

export function formatEmbeddingQueryText(rawQuery: string): string {
  const query = String(rawQuery ?? "").trim();
  if (!query) return "";

  const template = expandEscapedNewlines(String(process.env.EMBED_QUERY_TEMPLATE ?? "")).trim();
  if (template) {
    return template.replaceAll("{query}", query);
  }

  const prefix = expandEscapedNewlines(String(process.env.EMBED_QUERY_PREFIX ?? ""));
  if (prefix) {
    return `${prefix}${query}`;
  }

  return query;
}

export function formatEmbeddingPassageText(rawText: string): string {
  const text = String(rawText ?? "").trim();
  if (!text) return "";

  const template = expandEscapedNewlines(String(process.env.EMBED_PASSAGE_TEMPLATE ?? "")).trim();
  if (template) {
    return template.replaceAll("{text}", text);
  }

  const prefix = expandEscapedNewlines(String(process.env.EMBED_PASSAGE_PREFIX ?? ""));
  if (prefix) {
    return `${prefix}${text}`;
  }

  return text;
}

export function toNullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

const norm = toNullableString;

export function eventProjectionLabels(extra: Readonly<Record<string, unknown>>): readonly string[] {
  const labels = (extra.openplanner_labels as { readonly labels?: unknown } | undefined)?.labels;
  if (!Array.isArray(labels)) return [];
  return [...new Set(labels.map((label) => String(label ?? "").trim()).filter(Boolean))];
}

export function shouldIndexEventHotVectors(ev: EventEnvelopeV1): ev is EventEnvelopeV1 & { readonly text: string } {
  // Graph nodes have their own embedding index. Graph edges are topology.
  return typeof ev.text === "string" && ev.text.trim().length > 0 &&
    ev.kind !== "graph.node" && ev.kind !== "graph.edge";
}

function hotProjectionMetadata(ev: EventEnvelopeV1, labels: readonly string[]) {
  const source = ev.source_ref ?? {};
  const extra = ev.extra ?? {};
  const { author, role, model } = ev.meta ?? {};
  const quality = (extra.openplanner_labels as { readonly quality?: unknown } | undefined)?.quality;
  return {
    ts: ev.ts,
    source: ev.source,
    kind: ev.kind,
    project: source.project,
    session: source.session,
    author: norm(author) ?? "",
    role: norm(role) ?? "",
    model: norm(model) ?? "",
    search_tier: "hot",
    visibility: extra.visibility ?? "internal",
    quality_label: quality ?? "",
    labels,
    title: extra.title ?? source.message ?? ev.id,
  };
}

export function planHotEventProjection(ev: EventEnvelopeV1, labels = eventProjectionLabels(ev.extra ?? {})) {
  if (!shouldIndexEventHotVectors(ev)) return null;
  return {
    parentId: ev.id,
    text: ev.text,
    extra: ev.extra ?? {},
    scope: { source: ev.source, kind: ev.kind, project: norm(ev.source_ref?.project) ?? undefined },
    metadata: hotProjectionMetadata(ev, labels),
  };
}

export interface GraphEmbeddingInput {
  readonly node_id: string;
  readonly source_event_id: string;
  readonly project: string | null;
  readonly text: string;
  readonly chunk_count: number;
}

export interface DerivedGraphNodePlan {
  readonly id: string;
  readonly ts: Date;
  readonly project: string | null;
  readonly nodeId: string;
  readonly nodeKind: string;
  readonly label: string;
  readonly preview: string;
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface GraphEdgePlan {
  readonly source_node_id: string;
  readonly target_node_id: string;
  readonly edge_kind: string;
  readonly layer?: string | null;
  readonly project?: string | null;
  readonly source?: string | null;
  readonly data?: Readonly<Record<string, unknown>> | null;
  readonly updated_at?: Date;
}

interface EventGraphContext {
  readonly sourceEventId: string;
  readonly project: string | null;
  readonly ts: Date;
}

interface GraphProjectionPlan {
  readonly derivedGraphNodes: readonly DerivedGraphNodePlan[];
  readonly projectedGraphEdges: readonly GraphEdgePlan[];
  readonly graph: readonly GraphEmbeddingInput[];
  readonly shareableSentenceKeys: ReadonlySet<string>;
  readonly explicitNode: { readonly key: string; readonly collidesWithSentence: boolean } | null;
}

interface DerivedGraphProjection {
  readonly node: DerivedGraphNodePlan;
  readonly edge: GraphEdgePlan;
  readonly embedding: GraphEmbeddingInput | null;
}

const emptyGraphPlan: GraphProjectionPlan = {
  derivedGraphNodes: [], projectedGraphEdges: [], graph: [], shareableSentenceKeys: new Set<string>(),
  explicitNode: null,
};

/** Serialize topology metadata exactly as the existing ingestion writer stores it. */
export function derivedGraphNodeExtra(node: DerivedGraphNodePlan): Readonly<Record<string, unknown>> {
  return {
    node_id: node.nodeId,
    node_kind: node.nodeKind,
    label: node.label,
    preview: node.preview,
    content_hash: computeTextHash(node.preview),
    lake: node.project ?? undefined,
    ...node.extra,
  };
}

function graphEmbedding(
  ctx: EventGraphContext, nodeId: string, text: string, chunkCount: number,
): GraphEmbeddingInput | null {
  const passage = formatEmbeddingPassageText(text);
  return passage ? {
    node_id: nodeId,
    source_event_id: ctx.sourceEventId,
    project: ctx.project,
    text: passage,
    chunk_count: chunkCount,
  } : null;
}

function toDerivedGraphProjection(
  ctx: EventGraphContext,
  node: DerivedGraphNodePlan,
  edge: Pick<GraphEdgePlan, "source_node_id" | "edge_kind" | "data">,
  embedding: GraphEmbeddingInput | null,
): DerivedGraphProjection {
  return {
    node,
    edge: {
      source_node_id: edge.source_node_id,
      target_node_id: node.nodeId,
      edge_kind: edge.edge_kind,
      layer: "derived",
      project: ctx.project,
      source: "openplanner-derive",
      data: edge.data,
      updated_at: ctx.ts,
    },
    embedding,
  };
}

function planDocumentChunk(
  ctx: EventGraphContext, parentNodeId: string, label: string,
  chunk: PreparedIndexChunk,
): DerivedGraphProjection {
  const extra = { parent_node_id: parentNodeId, chunk_index: chunk.chunkIndex, chunk_count: chunk.chunkCount };
  const node = {
    id: `graph.node:doc_chunk:${chunk.id}`,
    ts: ctx.ts,
    project: ctx.project,
    nodeId: chunk.id,
    nodeKind: "doc_chunk",
    label: `${label} [chunk ${chunk.chunkIndex + 1}/${chunk.chunkCount}]`,
    preview: chunk.text.slice(0, 800),
    extra,
  };
  const edge = { source_node_id: parentNodeId, edge_kind: "contains_chunk", data: extra };
  return toDerivedGraphProjection(ctx, node, edge, graphEmbedding(ctx, node.nodeId, chunk.text, chunk.chunkCount));
}

function planSentence(ctx: EventGraphContext, parentNodeId: string, sent: SentenceWithHash): DerivedGraphProjection {
  const nodeId = `${ctx.project ?? "devel"}:sentence:${sent.hash}`;
  const node = {
    id: `graph.node:sentence:${nodeId}`,
    ts: ctx.ts,
    project: ctx.project,
    nodeId,
    nodeKind: "sentence",
    label: sent.sentence.length > 120 ? sent.sentence.slice(0, 117) + "..." : sent.sentence,
    preview: sent.sentence,
    extra: { derived_from_node_id: parentNodeId },
  };
  const edge = { source_node_id: parentNodeId, edge_kind: "contains_sentence", data: { sentence_hash: sent.hash } };
  return toDerivedGraphProjection(ctx, node, edge, graphEmbedding(ctx, nodeId, sent.sentence, 1));
}

function trimmedString(value: unknown): string | undefined {
  return norm(value)?.trim();
}

function explicitGraphNodeSource(ev: EventEnvelopeV1) {
  const source = ev.source_ref ?? {};
  const extra = ev.extra ?? {};
  const nodeId = trimmedString(extra.node_id) ?? trimmedString(source.message) ?? "";
  const body = trimmedString(ev.text) || trimmedString(extra.preview) || "";
  const label = String(extra.label ?? extra.path ?? source.message ?? nodeId).trim() || nodeId;
  return { nodeId, body, label, extra };
}

function planExplicitGraphNode(ev: EventEnvelopeV1, ctx: EventGraphContext): GraphProjectionPlan {
  const { nodeId, body, label, extra } = explicitGraphNodeSource(ev);
  if (!nodeId || !body) return emptyGraphPlan;

  const prepared = prepareIndexDocument({
    parentId: nodeId,
    text: body,
    extra,
    forceChunking: false,
    targetChunkTokens: 32_000,
    targetChunkChars: 180_000,
    overlapChars: 1_000,
  });
  const single = prepared.chunkCount <= 1;
  const chunks = single ? [] : prepared.chunks.map((chunk) => planDocumentChunk(ctx, nodeId, label, chunk));
  const direct = single ? graphEmbedding(ctx, nodeId, prepared.normalizedText, 1) : null;
  const sentenceSources = single ? [prepared.normalizedText] : prepared.chunks.map((chunk) => chunk.text);
  const candidates = sentenceSources.flatMap((text) =>
    [...deduplicateByHash(splitSentences(text)).values()].filter((sentence) => sentence.tokens > 3),
  );
  const sentences = [...deduplicateByHash(candidates).values()].map((sentence) => planSentence(ctx, nodeId, sentence));
  const derived = [...chunks, ...sentences];
  const embeddings = [direct, ...derived.map(({ embedding }) => embedding)].filter((input) => input !== null);
  const shareableSentenceKeys = new Set(sentences.map(({ node }) => node.nodeId));
  // Keep the parent claim even when hydration emits only chunk vectors.
  const collidesWithSentence = shareableSentenceKeys.delete(nodeId);
  return {
    derivedGraphNodes: derived.map(({ node }) => node),
    projectedGraphEdges: derived.map(({ edge }) => edge),
    graph: [...new Map(embeddings.map((input) => [input.node_id, input])).values()],
    shareableSentenceKeys,
    explicitNode: { key: nodeId, collidesWithSentence },
  };
}

function planOrdinaryGraphNode(
  ev: EventEnvelopeV1 & { readonly text: string },
  ctx: EventGraphContext,
): GraphProjectionPlan {
  const extra = ev.extra ?? {};
  const preview = ev.text.trim();
  const title = preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;
  const label = String(extra.label ?? ev.source_ref?.message ?? title).trim() || ev.id;
  const node = {
    id: `graph.node:derive:${ev.id}`,
    ts: ctx.ts,
    project: ctx.project,
    nodeId: ev.id,
    nodeKind: ev.kind,
    label,
    preview,
    extra: {
      lake: ctx.project ?? undefined,
      entity_key: ev.id,
      source_event_id: ev.id,
      source_kind: ev.kind,
      ...extra,
    },
  };
  const embedding = graphEmbedding(ctx, ev.id, preview, 1);
  return { ...emptyGraphPlan, derivedGraphNodes: [node], graph: embedding ? [embedding] : [] };
}

/** Plan graph embeddings and the topology that regular ingestion already materializes. */
export function planEventGraphProjections(ev: EventEnvelopeV1): GraphProjectionPlan {
  const ctx = { sourceEventId: ev.id, project: norm(ev.source_ref?.project), ts: new Date(ev.ts) };
  if (ev.kind === "graph.node") return planExplicitGraphNode(ev, ctx);
  return shouldIndexEventHotVectors(ev) ? planOrdinaryGraphNode(ev, ctx) : emptyGraphPlan;
}

export type StoredProjectionEvent = Readonly<{ readonly _id: unknown } & Pick<EventDocument,
  "id" | "ts" | "source" | "kind" | "project" | "session" | "message" | "role" | "author" | "model" | "text" | "extra"
>>;

const derivedIdentityKeys = [
  "node_id", "node_kind", "label", "preview", "content_hash", "entity_key", "source_event_id", "source_kind",
  "parent_node_id", "chunk_index", "chunk_count", "derived_from_node_id",
] as const;

const generatedGraphEventId = /^graph\.node:(?:derive|doc_chunk|sentence):/;

function isStoredTopologyMirror(row: StoredProjectionEvent): boolean {
  // The derived bulk writer chooses the string storage ID. Normal admission
  // lets Mongo assign an ObjectId regardless of the caller's source string.
  return row.kind === "graph.node" && row.source === "openplanner-derive" &&
    row._id === row.id && generatedGraphEventId.test(row.id);
}

function matchesDerivedGraphNode(row: StoredProjectionEvent, node: DerivedGraphNodePlan): boolean {
  if (row.id !== node.id || row.text !== "" || row.project !== node.project || row.message !== node.label ||
      row.ts.getTime() !== node.ts.getTime()) return false;
  const actual = row.extra as Readonly<Record<string, unknown>> | null;
  const expected = derivedGraphNodeExtra(node);
  return derivedIdentityKeys.every((key) => isDeepStrictEqual(actual?.[key] ?? null, expected[key] ?? null));
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidStoredTimestamp(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function storedEventEnvelope(row: StoredProjectionEvent): EventEnvelopeV1 {
  if (row._id == null || !isNonBlankString(row.id) || !isNonBlankString(row.source) || !isNonBlankString(row.kind) ||
      !isValidStoredTimestamp(row.ts)) {
    throw new Error("Invalid stored event identity for embedding projection");
  }
  if (row.text != null && typeof row.text !== "string") {
    throw new Error("Invalid stored event text for embedding projection");
  }
  return {
    schema: "openplanner.event.v1",
    id: row.id,
    ts: row.ts.toISOString(),
    source: row.source,
    kind: row.kind,
    text: row.text ?? undefined,
    source_ref: {
      project: row.project ?? undefined,
      session: row.session ?? undefined,
      message: row.message ?? undefined,
    },
    meta: { role: row.role, author: row.author, model: row.model },
    extra: row.extra as EventEnvelopeV1["extra"],
  };
}

interface StoredGraphOrigin {
  readonly eventId: string;
  readonly node: DerivedGraphNodePlan;
}

interface StoredGraphCandidate {
  readonly input: GraphEmbeddingInput;
  readonly derivedSentence: boolean;
}

interface PlannedGraphSource {
  readonly event: EventEnvelopeV1;
  readonly plan: GraphProjectionPlan;
}

const conflictingGraphOwners = "Conflicting stored event owners for a graph embedding node";

function verifyExplicitGraphOwners(planned: readonly PlannedGraphSource[]): void {
  const owners = new Map<string, string>();
  planned.forEach(({ event, plan }) => {
    const claim = plan.explicitNode;
    if (!claim) return;
    if (claim.collidesWithSentence || owners.has(claim.key)) throw new Error(conflictingGraphOwners);
    owners.set(claim.key, event.id);
  });
  planned.forEach(({ plan }) => plan.graph.forEach(({ node_id, source_event_id }) => {
    const owner = owners.get(node_id);
    if (owner && owner !== source_event_id) throw new Error(conflictingGraphOwners);
  }));
}

function groupByKey<K, V>(values: readonly V[], key: (value: V) => K): ReadonlyMap<K, readonly V[]> {
  // eslint-disable-next-line functional/prefer-readonly-type -- Private mutable buckets keep grouping linear.
  const groups = new Map<K, V[]>();
  values.forEach((value) => {
    const id = key(value);
    const group = groups.get(id);
    if (group) group.push(value);
    else groups.set(id, [value]);
  });
  return groups;
}

function verifiedDerivedOwners(
  mirrors: readonly StoredProjectionEvent[], origins: ReadonlyMap<string, readonly StoredGraphOrigin[]>,
): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  mirrors.forEach((row) => {
    const matches = (origins.get(row.id) ?? []).filter(({ node }) => matchesDerivedGraphNode(row, node));
    if (matches.length !== 1) throw new Error("Stored derived graph node lacks a unique verified source owner");
    const [match] = matches;
    const previous = owners.get(match.node.nodeId);
    if (previous && previous !== match.eventId) throw new Error("Ambiguous stored graph projection lineage");
    owners.set(match.node.nodeId, match.eventId);
  });
  return owners;
}

function sameDerivedSentence(a: StoredGraphCandidate, b: StoredGraphCandidate): boolean {
  return a.derivedSentence && b.derivedSentence && a.input.project === b.input.project &&
    a.input.text === b.input.text && a.input.chunk_count === b.input.chunk_count;
}

function resolveGraphCandidate(candidates: readonly StoredGraphCandidate[], owner: string | undefined) {
  const [first] = candidates;
  if (candidates.length === 1) return { input: first.input, shared: null };
  if (!candidates.every((candidate) => sameDerivedSentence(first, candidate))) {
    throw new Error(conflictingGraphOwners);
  }
  // Persisted topology identifies the representative where it exists. The
  // fallback sorts logical IDs so Mongo cursor order cannot change ownership.
  const sourceIds = candidates.map(({ input }) => input.source_event_id).sort();
  const representative = candidates.find(({ input }) => input.source_event_id === (owner ?? sourceIds[0]));
  if (!representative) throw new Error("Stored shared sentence owner is outside its projection keys");
  return { input: representative.input, shared: { nodeId: representative.input.node_id, sourceEventIds: sourceIds } };
}

/**
 * Derive embedding inputs from a consistent snapshot of admitted events.
 * Generated topology rows are mirrors, and only identical derived sentences
 * can share a vector key. This function has no store or admission capabilities.
 */
export function planStoredEventEmbeddingProjections(rows: readonly StoredProjectionEvent[]) {
  // Mongo assigns storage IDs during admission. Projection identity uses the
  // logical event ID shared with the normal ingest projection.
  if (new Set(rows.map(({ id }) => id)).size !== rows.length) {
    throw new Error("Duplicate stored event identity for embedding projection");
  }
  const events = rows.map((row) => ({ row, event: storedEventEnvelope(row) }));
  const isMirror = ({ row }: { readonly row: StoredProjectionEvent }) => isStoredTopologyMirror(row);
  const sources = events.filter((entry) => !isMirror(entry));
  const planned = sources.map(({ event }) => ({ event, plan: planEventGraphProjections(event) }));
  verifyExplicitGraphOwners(planned);
  const derived = planned.flatMap(({ event, plan }) =>
    plan.derivedGraphNodes.map((node) => ({ eventId: event.id, node })),
  );
  const mirrored = events.filter(isMirror).map(({ row }) => row);
  const owners = verifiedDerivedOwners(mirrored, groupByKey(derived, ({ node }) => node.id));
  const graphCandidates = planned.flatMap(({ plan }) => plan.graph.map((input) => ({
    input,
    derivedSentence: plan.shareableSentenceKeys.has(input.node_id),
  })));
  const graph = [...groupByKey(graphCandidates, ({ input }) => input.node_id).entries()]
    .map(([nodeId, candidates]) => resolveGraphCandidate(candidates, owners.get(nodeId)));
  return {
    hot: sources.map(({ event }) => planHotEventProjection(event)).filter((input) => input !== null),
    graph: graph.map(({ input }) => input),
    sharedGraphSources: graph.map(({ shared }) => shared).filter((shared) => shared !== null),
  };
}
