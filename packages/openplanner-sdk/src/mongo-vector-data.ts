import crypto from "node:crypto";
import type { Collection, Filter } from "mongodb";
import type { MongoConnection, MongoVectorDocument } from "./mongodb.js";
import { OPENPLANNER_SCHEMA_TARGETS, vectorChunkMigrationState } from "./schema-versions.js";
import { loadHydrationSourceText } from "./source-hydration.js";

export type MongoVectorTier = "hot" | "compact";

// Keep the existing SDK mutable public types while implementation inputs are readonly.
// eslint-disable-next-line functional/prefer-readonly-type -- SDK public mutation ABI; guarded by compile fixture.
export type SdkMutable<T> = { -readonly [Key in keyof T]: T[Key] };
export type SdkArray<T> = SdkMutable<readonly T[]>;

export type RawQueryResult = SdkMutable<{
  readonly ids: SdkArray<SdkArray<string>>;
  readonly documents: SdkArray<SdkArray<string>>;
  readonly metadatas: SdkArray<SdkArray<Record<string, unknown> | null>>;
  readonly distances: SdkArray<SdkArray<number | null>>;
  readonly include: SdkMutable<readonly ["documents", "metadatas", "distances"]>;
}>;

export type MongoVectorEntry = SdkMutable<{
  readonly id: string;
  readonly parentId: string;
  readonly text: string;
  readonly embedding: SdkArray<number>;
  readonly metadata: Record<string, unknown>;
}>;

export type SourceRef = {
  readonly source_path?: string;
  readonly url?: string;
  readonly hostname?: string;
  readonly lake?: string;
  readonly content_hash?: string;
};

export const FILTERABLE_PATHS = ["source", "kind", "project", "session", "visibility", "quality_label", "parent_id", "embedding_model"] as const;

export const FILTERABLE_PATH_SET = new Set<string>(FILTERABLE_PATHS);

export function emptyResult(): RawQueryResult {
  return { ids: [[]], documents: [[]], metadatas: [[]], distances: [[]], include: ["documents", "metadatas", "distances"] };
}

export function getFlatCollection(mongo: MongoConnection, tier: MongoVectorTier): Collection<MongoVectorDocument> {
  return tier === "compact" ? mongo.compactVectors : mongo.hotVectors;
}

export function asDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(String(value ?? new Date().toISOString()));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function toStringOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const next = String(value);
  return next.length > 0 ? next : null;
}

export function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}

export function parsePositiveIntEnv(name: string): number {
  const parsed = Number.parseInt(process.env[name] ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function ttlExpiryFromNow(ttlSeconds: number): Date | undefined {
  return ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : undefined;
}

export function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function firstString(...values: readonly unknown[]): string | undefined {
  return values.map(nonBlankString).find((value) => value !== undefined);
}

export function sourceRefFromExtra(extra: Record<string, unknown> | undefined): SourceRef | null {
  const metadata = objectValue(extra?.metadata);
  const sourcePath = firstString(extra?.source_path, extra?.path, metadata.path, metadata.file_id);
  const url = firstString(extra?.url, metadata.url);
  const hostname = firstString(extra?.hostname, metadata.hostname);
  const lake = firstString(extra?.lake, metadata.lake);
  const contentHash = firstString(
    extra?.content_hash, metadata.content_hash, objectValue(extra?.migration_2).text_hash_sha256,
  );
  if (!sourcePath && !url && !hostname) return null;
  return Object.fromEntries(Object.entries({
    source_path: sourcePath, url, hostname, lake, content_hash: contentHash,
  }).filter(([, value]) => value !== undefined));
}

export function hydrationInput(doc: MongoVectorDocument) {
  const ref = objectValue(doc.source_ref);
  return {
    id: doc.parent_id ?? doc._id, text: "",
    project: nonBlankString(ref.lake) ?? doc.project,
    extra: {
      source_path: firstString(ref.source_path, ref.sourcePath),
      url: nonBlankString(ref.url), hostname: nonBlankString(ref.hostname),
      lake: nonBlankString(ref.lake) ?? doc.project,
      content_hash: firstString(ref.content_hash, ref.contentHash),
    },
  };
}

export async function hydrateVectorDocumentText(doc: MongoVectorDocument): Promise<string> {
  if (doc.text || doc.source_text_redacted !== true) return doc.text ?? "";
  const sourceText = await loadHydrationSourceText(hydrationInput(doc));
  if (!sourceText) return "";
  const start = typeof doc.char_start === "number" && doc.char_start >= 0 ? doc.char_start : null;
  const end = typeof doc.char_end === "number" && doc.char_end >= 0 ? doc.char_end : null;
  if (start !== null && end !== null && end >= start) {
    return sourceText.slice(start, end);
  }
  return sourceText;
}

export function sha256Text(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function sourceRedactionMetadata(params: {
  readonly extra?: Record<string, unknown>;
  readonly rawText: string;
  readonly chunkText: string;
  readonly charStart?: number | null;
  readonly charEnd?: number | null;
}): Record<string, unknown> {
  const sourceRef = sourceRefFromExtra(params.extra);
  if (!sourceRef) return {};
  return {
    source_text_redacted: true,
    source_ref: sourceRef,
    text_hash_sha256: sourceRef.content_hash ?? sha256Text(params.rawText),
    chunk_text_hash_sha256: sha256Text(params.chunkText),
    char_start: params.charStart ?? null,
    char_end: params.charEnd ?? null,
  };
}

export function normalizeScalarFilterValue(value: unknown): unknown {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  return undefined;
}

export function filterValue(rawValue: unknown): unknown {
  if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
    return normalizeScalarFilterValue(rawValue);
  }
  const record = rawValue as Record<string, unknown>;
  if (Array.isArray(record.$in)) return { $in: record.$in };
  if (Object.prototype.hasOwnProperty.call(record, "$eq")) return normalizeScalarFilterValue(record.$eq);
  if (Object.prototype.hasOwnProperty.call(record, "$ne")) {
    const value = normalizeScalarFilterValue(record.$ne);
    return value === undefined ? undefined : { $ne: value };
  }
  return undefined;
}

export function buildMongoFilter(where: Record<string, unknown> | undefined): Filter<MongoVectorDocument> {
  return Object.fromEntries(Object.entries(where ?? {})
    .filter(([key]) => FILTERABLE_PATH_SET.has(key))
    .map(([key, value]) => [key, filterValue(value)])
    .filter(([, value]) => value !== undefined));
}

export function dot(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) {
    throw new RangeError(`embedding length mismatch: left=${left.length} right=${right.length}`);
  }
  return left.reduce((total, value, index) => total + value * right[index]!, 0);
}

export function magnitude(input: readonly number[]): number {
  return Math.sqrt(dot(input, input));
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) return Number.NEGATIVE_INFINITY;
  const leftMagnitude = magnitude(left);
  const rightMagnitude = magnitude(right);
  if (leftMagnitude === 0 || rightMagnitude === 0) return Number.NEGATIVE_INFINITY;
  return dot(left, right) / (leftMagnitude * rightMagnitude);
}

export function toMetadata(doc: MongoVectorDocument): Record<string, unknown> {
  const defaults: Readonly<Record<string, unknown>> = {
    project: "",
    session: "",
    author: "",
    role: "",
    model: "",
    visibility: "",
    quality_label: "",
    labels: [],
    title: "",
    embedding_model: "",
    embedding_dimensions: null,
    chunk_id: doc._id,
    chunk_index: 0,
    chunk_count: 1,
    normalized_format: null,
    normalized_estimated_tokens: null,
    raw_estimated_tokens: null,
    seed_id: null,
    member_count: null,
    char_count: null,
    source_text_redacted: false,
    source_ref: null,
    text_hash_sha256: null,
    chunk_text_hash_sha256: null,
    char_start: null,
    char_end: null,
    schema_version: null,
    migration_state: null,
  };
  return {
    ts: doc.ts.toISOString(),
    source: doc.source,
    kind: doc.kind,
    search_tier: doc.search_tier,
    parent_id: doc.parent_id,
    ...Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [
      key, (doc as unknown as Record<string, unknown>)[key] ?? fallback,
    ])),
  };
}

export function toMongoVectorDocument(entry: MongoVectorEntry, tier: MongoVectorTier, now: Date): MongoVectorDocument {
  const ts = asDate(entry.metadata.ts);
  const sourceTextRedacted = entry.metadata.source_text_redacted === true;
  const labels = toStringArray(entry.metadata.labels);
  const ttlSeconds = tier === "hot"
    ? parsePositiveIntEnv("MONGODB_EVENTS_TTL_SECONDS")
    : parsePositiveIntEnv("MONGODB_COMPACTED_TTL_SECONDS");
  return {
    _id: entry.id,
    parent_id: entry.parentId,
    text: sourceTextRedacted ? "" : entry.text,
    embedding: [...entry.embedding],
    ts,
    source: toStringOrNull(entry.metadata.source) ?? "",
    kind: toStringOrNull(entry.metadata.kind) ?? "",
    project: toStringOrNull(entry.metadata.project),
    session: toStringOrNull(entry.metadata.session),
    author: toStringOrNull(entry.metadata.author),
    role: toStringOrNull(entry.metadata.role),
    model: toStringOrNull(entry.metadata.model),
    visibility: toStringOrNull(entry.metadata.visibility),
    quality_label: toStringOrNull(entry.metadata.quality_label),
    labels: [...labels],
    title: toStringOrNull(entry.metadata.title),
    embedding_model: toStringOrNull(entry.metadata.embedding_model),
    embedding_dimensions: entry.embedding.length,
    search_tier: tier,
    chunk_id: toStringOrNull(entry.metadata.chunk_id) ?? entry.id,
    chunk_index: toNumberOrNull(entry.metadata.chunk_index),
    chunk_count: toNumberOrNull(entry.metadata.chunk_count),
    normalized_format: toStringOrNull(entry.metadata.normalized_format),
    normalized_estimated_tokens: toNumberOrNull(entry.metadata.normalized_estimated_tokens),
    raw_estimated_tokens: toNumberOrNull(entry.metadata.raw_estimated_tokens),
    seed_id: toStringOrNull(entry.metadata.seed_id),
    member_count: toNumberOrNull(entry.metadata.member_count),
    char_count: toNumberOrNull(entry.metadata.char_count),
    source_text_redacted: sourceTextRedacted,
    source_ref: sourceTextRedacted ? objectValue(entry.metadata.source_ref) : null,
    text_hash_sha256: toStringOrNull(entry.metadata.text_hash_sha256),
    chunk_text_hash_sha256: toStringOrNull(entry.metadata.chunk_text_hash_sha256),
    char_start: toNumberOrNull(entry.metadata.char_start),
    char_end: toNumberOrNull(entry.metadata.char_end),
    schema_version: OPENPLANNER_SCHEMA_TARGETS.vectorChunk,
    migration_state: vectorChunkMigrationState(now),
    expiresAt: labels.length > 0 ? null : ttlExpiryFromNow(ttlSeconds) ?? null,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildMongoVectorDeleteFilter(where: Record<string, unknown>): Filter<MongoVectorDocument> {
  return buildMongoFilter(where);
}