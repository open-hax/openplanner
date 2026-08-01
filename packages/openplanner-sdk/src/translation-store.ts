/**
 * Direct MongoDB storage for the translation workbench.
 *
 * Trusted in-process consumers use the same collections and wire contracts as
 * the HTTP compatibility server without making a network round trip.
 */
import { ObjectId, type Collection, type Db } from "mongodb";

type Input = Record<string, unknown>;
type SegmentStatus = "pending" | "in_review" | "approved" | "rejected";
type LabelOverall = "approve" | "needs_edit" | "reject";

type SegmentDoc = {
  _id?: ObjectId;
  source_text: string;
  translated_text: string;
  source_lang: string;
  target_lang: string;
  document_id: string;
  segment_index: number;
  status: SegmentStatus;
  garden_id?: string;
  mt_model?: string;
  confidence?: number;
  domain?: string;
  content_type?: string;
  url_context?: string;
  org_id?: string;
  project?: string;
  created_at: Date;
  updated_at: Date;
};

type LabelDoc = {
  _id?: ObjectId;
  segment_id: string;
  labeler_id: string;
  labeler_email: string;
  label_version: number;
  adequacy: "excellent" | "good" | "adequate" | "poor" | "unusable";
  fluency: "excellent" | "good" | "adequate" | "poor" | "unusable";
  terminology: "correct" | "minor_errors" | "major_errors";
  risk: "safe" | "sensitive" | "policy_violation";
  overall: LabelOverall;
  corrected_text?: string;
  editor_notes?: string;
  created_at: Date;
};

type BatchDoc = {
  _id?: ObjectId;
  batch_id: string;
  garden_id: string;
  target_lang: string;
  source_lang: string;
  project: string;
  status: string;
  document_ids: string[];
  completed_documents: string[];
  failed_documents: unknown[];
  attempts?: number;
  created_at: Date;
  updated_at?: Date;
  started_at?: Date;
  completed_at?: Date;
  agent_session_id?: string;
  agent_conversation_id?: string;
  agent_run_id?: string;
  error?: string;
};

type EventDoc = {
  _id: string;
  text?: string | null;
  project?: string | null;
  extra?: Input | null;
};

type TranslationStoreOptions = {
  eventsCollection?: string;
};

type ManifestOptions = {
  project?: string;
  org_id?: string;
};

const statuses = new Set<SegmentStatus>(["pending", "approved", "rejected", "in_review"]);

const text = (value: unknown, fallback = "") => {
  const valueText = String(value ?? "").trim();
  return valueText || fallback;
};

const numeric = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const date = (value: unknown) => value instanceof Date ? value.toISOString() : value ?? null;
const id = (row: { _id?: unknown; id?: unknown }) => String(row._id ?? row.id ?? "");

function clean(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clean(entry)]));
  }
  return value;
}

function objectId(value: string): ObjectId | null {
  try { return new ObjectId(value); } catch { return null; }
}

function statusAfterLabel(current: SegmentStatus, overall: unknown, correctedText?: unknown): SegmentStatus {
  if (overall === "approve") return "approved";
  if (overall === "reject") return "rejected";
  if (overall === "needs_edit") return text(correctedText) ? "approved" : "in_review";
  return current;
}

function documentOverallStatus(total: number, approved: number, rejected: number, pending: number): string {
  if (total > 0 && approved === total) return "fully_approved";
  if (total > 0 && rejected === total) return "fully_rejected";
  if (total > 0 && pending === total) return "pending_review";
  if (pending > 0) return "partial_review";
  return "mixed";
}

function reviewLabelPlan(input: Input): Omit<LabelDoc, "label_version" | "created_at"> & { next_status: SegmentStatus } {
  const overall = (["approve", "needs_edit", "reject"].includes(String(input.overall))
    ? input.overall
    : "needs_edit") as LabelOverall;
  const approved = overall === "approve";
  const correctedText = text(input.corrected_text) || undefined;
  return {
    segment_id: text(input.segment_id),
    labeler_id: text(input.labeler_id, "unknown"),
    labeler_email: text(input.labeler_email, "unknown"),
    adequacy: approved ? "good" : "adequate",
    fluency: approved ? "good" : "adequate",
    terminology: approved ? "correct" : "minor_errors",
    risk: "safe",
    overall,
    corrected_text: correctedText,
    editor_notes: text(input.editor_notes) || undefined,
    next_status: statusAfterLabel("pending", overall, correctedText),
  };
}

function graphMemoryPlan(segment: SegmentDoc, correctedText?: string) {
  const segmentId = id(segment);
  const targetText = text(correctedText) || segment.translated_text;
  if (!text(segment.source_text) || !text(targetText)) {
    return { ok: false as const, error: "Missing source or target text" };
  }
  const nodeId = `translation:${segment.source_lang}:${segment.target_lang}:${segmentId}`;
  return {
    ok: true as const,
    node: {
      id: nodeId,
      kind: "translation_example",
      label: `${segment.source_lang}→${segment.target_lang}: ${segment.source_text.slice(0, 50)}...`,
      data: {
        source_text: segment.source_text,
        target_text: targetText,
        source_lang: segment.source_lang,
        target_lang: segment.target_lang,
        document_id: segment.document_id,
        domain: segment.domain,
        content_type: segment.content_type,
        quality: "approved",
        segment_id: segmentId,
      },
    },
    edge: {
      id: `translation:doc:${segment.document_id}:${segmentId}`,
      source: segment.document_id,
      target: nodeId,
      kind: "has_translation",
      data: { source_lang: segment.source_lang, target_lang: segment.target_lang },
    },
  };
}

function sftRow(segment: SegmentDoc, targetText: string) {
  return {
    prompt: `Translate the following text from English to ${segment.target_lang}. Preserve formatting, technical terms, and code examples.\n\nText:\n${segment.source_text}`,
    target: targetText,
  };
}

function segmentView(segment: SegmentDoc, labels: LabelDoc[] = [], labelCount?: number) {
  return {
    id: id(segment),
    source_text: segment.source_text,
    translated_text: segment.translated_text,
    source_lang: segment.source_lang,
    target_lang: segment.target_lang,
    document_id: segment.document_id,
    segment_index: segment.segment_index,
    status: segment.status,
    confidence: segment.confidence ?? null,
    mt_model: segment.mt_model ?? null,
    domain: segment.domain ?? null,
    garden_id: segment.garden_id ?? null,
    tenant_id: segment.org_id ?? null,
    org_id: segment.org_id ?? null,
    project: segment.project ?? null,
    labels: labels.map((label) => ({
      id: id(label), segment_id: label.segment_id, labeler_id: label.labeler_id,
      labeler_email: label.labeler_email, adequacy: label.adequacy,
      fluency: label.fluency, terminology: label.terminology, risk: label.risk,
      overall: label.overall, corrected_text: label.corrected_text ?? null,
      editor_notes: label.editor_notes ?? null, ts: date(label.created_at),
    })),
    ...(labelCount === undefined ? {} : { label_count: labelCount }),
    ts: date(segment.created_at),
  };
}

function copyFilters(source: Input, keys: string[]): Input {
  const filter: Input = {};
  for (const key of keys) if (source[key]) filter[key] = source[key];
  return filter;
}

export class TranslationStore {
  private readonly segments: Collection<SegmentDoc>;
  private readonly labels: Collection<LabelDoc>;
  private readonly batches: Collection<BatchDoc>;
  private readonly events: Collection<EventDoc>;
  private readonly graphNodes: Collection<Input>;
  private readonly graphEdges: Collection<Input>;

  constructor(private readonly db: Db, options: TranslationStoreOptions = {}) {
    this.segments = db.collection<SegmentDoc>("translation_segments");
    this.labels = db.collection<LabelDoc>("translation_labels");
    this.batches = db.collection<BatchDoc>("translation_batches");
    this.events = db.collection<EventDoc>(options.eventsCollection ?? "events");
    this.graphNodes = db.collection<Input>("graph_nodes");
    this.graphEdges = db.collection<Input>("graph_edges");
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.segments.createIndex({ document_id: 1, segment_index: 1, target_lang: 1 }, { unique: true, name: "segment_unique_idx" }),
      this.segments.createIndex({ status: 1 }), this.segments.createIndex({ target_lang: 1 }),
      this.segments.createIndex({ garden_id: 1 }), this.segments.createIndex({ org_id: 1 }),
      this.segments.createIndex({ project: 1 }), this.labels.createIndex({ segment_id: 1, created_at: -1 }),
      this.batches.createIndex({ garden_id: 1, target_lang: 1, status: 1 }),
      this.batches.createIndex({ status: 1, created_at: 1 }),
    ]);
  }

  async listSegments(opts: Input = {}) {
    const filter = copyFilters(opts, ["project", "org_id", "status", "source_lang", "target_lang", "domain", "document_id"]);
    const limit = Math.min(100, Math.max(1, numeric(opts.limit, 50)));
    const offset = Math.max(0, numeric(opts.offset, 0));
    const rows = await this.segments.find(filter).sort({ created_at: 1 }).skip(offset).limit(limit).toArray();
    const ids = rows.map(id);
    const counts = await this.labels.aggregate<{ _id: string; count: number }>([
      { $match: { segment_id: { $in: ids } } },
      { $group: { _id: "$segment_id", count: { $sum: 1 } } },
    ]).toArray();
    const countById = new Map(counts.map((row) => [row._id, row.count]));
    const total = await this.segments.countDocuments(filter);
    return { segments: rows.map((row) => segmentView(row, [], countById.get(id(row)) ?? 0)), total, has_more: offset + rows.length < total };
  }

  async segment(segmentId: string) {
    const oid = objectId(segmentId);
    if (!oid) throw new Error("Invalid segment ID");
    const row = await this.segments.findOne({ _id: oid });
    if (!row) throw new Error("Segment not found");
    const labels = await this.labels.find({ segment_id: segmentId }).sort({ created_at: -1 }).toArray();
    return segmentView(row, labels);
  }

  async createSegment(input: Input) {
    const segmentIndex = Number(input.segment_index);
    if (input.segment_index === undefined || input.segment_index === null || !Number.isInteger(segmentIndex) || segmentIndex < 0) {
      throw new Error("segment_index must be an explicitly provided non-negative integer");
    }
    const now = new Date();
    const requestedStatus = text(input.status, "pending") as SegmentStatus;
    const doc: Omit<SegmentDoc, "_id" | "created_at"> = {
      source_text: text(input.source_text), translated_text: text(input.translated_text),
      source_lang: text(input.source_lang, "en"), target_lang: text(input.target_lang),
      document_id: text(input.document_id), segment_index: segmentIndex,
      status: statuses.has(requestedStatus) ? requestedStatus : "pending",
      garden_id: text(input.garden_id) || undefined, mt_model: text(input.mt_model) || undefined,
      confidence: input.confidence === undefined ? undefined : numeric(input.confidence),
      domain: text(input.domain) || undefined, content_type: text(input.content_type) || undefined,
      url_context: text(input.url_context) || undefined, org_id: text(input.org_id) || undefined,
      project: text(input.project) || undefined, updated_at: now,
    };
    if (!doc.source_text || !doc.translated_text || !doc.target_lang || !doc.document_id) {
      throw new Error("Missing required fields: source_text, translated_text, target_lang, document_id");
    }
    const result = await this.segments.findOneAndUpdate(
      { document_id: doc.document_id, segment_index: doc.segment_index, target_lang: doc.target_lang },
      { $set: doc, $setOnInsert: { created_at: now } },
      { upsert: true, returnDocument: "after", includeResultMetadata: true },
    );
    if (!result.value) throw new Error("Failed to create translation segment");
    return {
      ok: true,
      id: id(result.value),
      status: result.value.status,
      upserted: Boolean(result.lastErrorObject?.upserted),
      modified: Boolean(result.lastErrorObject?.updatedExisting),
    };
  }

  async createSegmentsBatch(payload: Input) {
    const rows = Array.isArray(payload.segments) ? payload.segments.filter((row): row is Input => Boolean(row) && typeof row === "object") : [];
    if (!rows.length) throw new Error("No segments provided");
    const results: Input[] = []; const errors: Input[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      try {
        const row = rows[index];
        const segment = await this.createSegment({ ...row, segment_index: row.segment_index ?? index, org_id: payload.org_id ?? "", project: payload.project ?? "" });
        results.push({ index, id: segment.id, status: segment.status });
      } catch (error) { errors.push({ index, error: error instanceof Error ? error.message : String(error) }); }
    }
    return { ok: true, imported: results.length, errors: errors.length, results, ...(errors.length ? { errors_detail: errors } : {}) };
  }

  private async upsertGraphMemory(segment: SegmentDoc, correctedText?: string) {
    const plan = graphMemoryPlan(segment, correctedText);
    if (!plan.ok) return { success: false, error: plan.error };
    try {
      const now = new Date();
      await Promise.all([
        this.graphNodes.updateOne({ id: plan.node.id }, { $set: { ...plan.node, updated_at: now }, $setOnInsert: { created_at: now } }, { upsert: true }),
        this.graphEdges.updateOne({ id: plan.edge.id }, { $set: { ...plan.edge, updated_at: now }, $setOnInsert: { created_at: now } }, { upsert: true }),
      ]);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async labelSegment(segmentId: string, payload: Input) {
    const oid = objectId(segmentId);
    if (!oid) throw new Error("Invalid segment ID");
    const segment = await this.segments.findOne({ _id: oid });
    if (!segment) throw new Error("Segment not found");
    for (const key of ["adequacy", "fluency", "terminology", "risk", "overall"]) if (!payload[key]) throw new Error("Missing required label fields");
    const label: LabelDoc = {
      segment_id: segmentId,
      labeler_id: text(payload.labeler_id, "unknown"), labeler_email: text(payload.labeler_email, "unknown"),
      label_version: (await this.labels.countDocuments({ segment_id: segmentId })) + 1,
      adequacy: payload.adequacy as LabelDoc["adequacy"], fluency: payload.fluency as LabelDoc["fluency"],
      terminology: payload.terminology as LabelDoc["terminology"], risk: payload.risk as LabelDoc["risk"],
      overall: payload.overall as LabelOverall, corrected_text: text(payload.corrected_text) || undefined,
      editor_notes: text(payload.editor_notes) || undefined, created_at: new Date(),
    };
    const inserted = await this.labels.insertOne(label);
    const newStatus = statusAfterLabel(segment.status, label.overall, label.corrected_text);
    await this.segments.updateOne({ _id: oid }, { $set: { ...(label.corrected_text ? { translated_text: label.corrected_text } : {}), status: newStatus, updated_at: new Date() } });
    const graphMemory = newStatus === "approved" ? await this.upsertGraphMemory(segment, label.corrected_text) : undefined;
    return { ok: true, label: { ...clean(label) as Input, id: inserted.insertedId.toString(), _id: undefined }, new_status: newStatus, graph_memory: graphMemory };
  }

  private async appendSftBatch(rows: SegmentDoc[], corrected: boolean, lines: string[]): Promise<void> {
    let correctedBySegment = new Map<string, string>();
    if (corrected && rows.length) {
      const labels = await this.labels.aggregate<{ _id: string; corrected_text: string }>([
        { $match: { segment_id: { $in: rows.map(id) }, corrected_text: { $exists: true, $nin: [null, ""] } } },
        { $sort: { created_at: -1 } },
        { $group: { _id: "$segment_id", corrected_text: { $first: "$corrected_text" } } },
      ]).toArray();
      correctedBySegment = new Map(labels.map((label) => [label._id, label.corrected_text]));
    }
    for (const row of rows) {
      lines.push(JSON.stringify(sftRow(row, correctedBySegment.get(id(row)) ?? row.translated_text)));
    }
  }

  async exportSft(opts: Input = {}): Promise<string> {
    const filter = { status: "approved", ...copyFilters(opts, ["project", "target_lang", "org_id"]) } as Input;
    const corrected = opts.include_corrected !== "false" && opts.include_corrected !== false;
    const lines: string[] = [];
    const batch: SegmentDoc[] = [];
    for await (const row of this.segments.find(filter).sort({ _id: 1 }).batchSize(250)) {
      batch.push(row);
      if (batch.length >= 250) {
        await this.appendSftBatch(batch.splice(0), corrected, lines);
      }
    }
    if (batch.length) await this.appendSftBatch(batch, corrected, lines);
    return lines.join("\n");
  }

  async manifest(projectOrOptions: string | ManifestOptions = {}) {
    const opts = typeof projectOrOptions === "string" ? { project: projectOrOptions } : projectOrOptions;
    const filter = copyFilters(opts as Input, ["project", "org_id"]);
    const languages = await this.segments.aggregate<{
      _id: string; total: number; approved: number; rejected: number; pending: number; in_review: number;
    }>([
      { $match: filter },
      { $group: {
        _id: "$target_lang", total: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
        in_review: { $sum: { $cond: [{ $eq: ["$status", "in_review"] }, 1, 0] } },
      } },
    ]).toArray();

    const segmentMatch = Object.fromEntries(Object.entries(filter).map(([key, value]) => [`segment.${key}`, value]));
    const labelStats = await this.labels.aggregate<{
      corrections: Array<{ _id: string; count: number }>;
      labelers: Array<{ _id: string; segments_labeled: number }>;
    }>([
      { $addFields: { segment_object_id: { $convert: { input: "$segment_id", to: "objectId", onError: null, onNull: null } } } },
      { $lookup: { from: this.segments.collectionName, localField: "segment_object_id", foreignField: "_id", as: "segment" } },
      { $unwind: "$segment" },
      ...(Object.keys(segmentMatch).length ? [{ $match: segmentMatch }] : []),
      { $facet: {
        corrections: [
          { $match: { corrected_text: { $exists: true, $nin: [null, ""] } } },
          { $group: { _id: { target_lang: "$segment.target_lang", segment_id: "$segment_id" } } },
          { $group: { _id: "$_id.target_lang", count: { $sum: 1 } } },
        ],
        labelers: [{ $group: { _id: "$labeler_email", segments_labeled: { $sum: 1 } } }],
      } },
    ]).next();
    const corrections = Object.fromEntries((labelStats?.corrections ?? []).map((row) => [row._id, row.count]));
    const shapedLanguages = Object.fromEntries(languages.map((row) => [row._id || "unknown", {
      total_segments: row.total,
      approved: row.approved,
      rejected: row.rejected,
      pending: row.pending,
      in_review: row.in_review,
      with_corrections: corrections[row._id] ?? 0,
      avg_labels_per_segment: 0,
    }]));
    const exportSizes = Object.fromEntries(languages.map((row) => [`sft_${row._id || "unknown"}`, {
      rows: row.approved,
      bytes_estimate: row.approved * 500,
    }]));
    return {
      project: opts.project || "all",
      languages: shapedLanguages,
      labelers: (labelStats?.labelers ?? []).map((row) => ({ email: row._id, segments_labeled: row.segments_labeled })),
      export_sizes: exportSizes,
      generated_at: new Date().toISOString(),
    };
  }

  async documents(opts: Input = {}) {
    const filter = copyFilters(opts, ["project", "target_lang", "source_lang", "garden_id", "org_id"]);
    const docs = await this.segments.aggregate<{
      _id: { document_id: string; target_lang: string };
      source_lang: string; garden_id: string | null; project: string | null;
      total_segments: number; approved: number; pending: number; rejected: number; in_review: number;
    }>([
      { $match: filter },
      { $group: {
        _id: { document_id: "$document_id", target_lang: "$target_lang" },
        source_lang: { $first: "$source_lang" }, garden_id: { $first: "$garden_id" }, project: { $first: "$project" },
        total_segments: { $sum: 1 },
        approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
        pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
        rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
        in_review: { $sum: { $cond: [{ $eq: ["$status", "in_review"] }, 1, 0] } },
      } },
      { $sort: { "_id.document_id": 1, "_id.target_lang": 1 } },
    ]).toArray();
    const eventRows = await this.events.find(
      { _id: { $in: docs.map((row) => row._id.document_id) } },
      { projection: { _id: 1, "extra.title": 1, "extra.visibility": 1 } },
    ).toArray();
    const titles = new Map(eventRows.map((row) => [row._id, {
      title: text(row.extra?.title, "Untitled"), visibility: text(row.extra?.visibility, "internal"),
    }]));
    const documents = docs.map((row) => {
      const meta = titles.get(row._id.document_id);
      return {
        document_id: row._id.document_id, target_lang: row._id.target_lang,
        source_lang: row.source_lang, garden_id: row.garden_id, project: row.project,
        title: meta?.title ?? "Untitled", document_status: meta?.visibility ?? "internal",
        total_segments: row.total_segments, approved: row.approved, pending: row.pending,
        rejected: row.rejected, in_review: row.in_review,
        overall_status: documentOverallStatus(row.total_segments, row.approved, row.rejected, row.pending),
      };
    });
    return { documents, total: documents.length };
  }

  async document(documentId: string, targetLang: string) {
    const event = await this.events.findOne({ _id: documentId });
    if (!event) throw new Error("Document not found");
    const segments = await this.segments.aggregate<SegmentDoc>([
      { $match: { document_id: documentId, target_lang: targetLang } },
      { $sort: { segment_index: 1, created_at: -1 } },
      { $group: { _id: "$segment_index", doc: { $first: "$$ROOT" } } },
      { $replaceRoot: { newRoot: "$doc" } },
      { $sort: { segment_index: 1 } },
    ]).toArray();
    const labels = await this.labels.find({ segment_id: { $in: segments.map(id) } }).sort({ created_at: -1 }).toArray();
    const labelsBySegment = new Map<string, LabelDoc[]>();
    for (const label of labels) {
      const group = labelsBySegment.get(label.segment_id) ?? [];
      group.push(label);
      labelsBySegment.set(label.segment_id, group);
    }
    const extra = event.extra ?? {};
    const shapedSegments = segments.map((row) => segmentView(row, labelsBySegment.get(id(row)) ?? []));
    const counts = { approved: 0, pending: 0, rejected: 0, in_review: 0 };
    for (const row of segments) counts[row.status] += 1;
    return {
      document: {
        id: documentId, title: text(extra.title, "Untitled"), content: text(extra.content ?? extra.text),
        source_lang: text(extra.language, "en"), visibility: text(extra.visibility, "internal"),
        source_path: extra.sourcePath ?? extra.source_path ?? null,
      },
      segments: shapedSegments,
      summary: {
        total_segments: segments.length, ...counts,
        overall_status: documentOverallStatus(segments.length, counts.approved, counts.rejected, counts.pending),
      },
    };
  }

  async reviewDocument(documentId: string, targetLang: string, payload: Input) {
    if (!["approve", "needs_edit", "reject"].includes(String(payload.overall))) throw new Error("overall must be approve, needs_edit, or reject");
    const segments = await this.segments.find({ document_id: documentId, target_lang: targetLang }).sort({ segment_index: 1 }).toArray();
    if (!segments.length) throw new Error("No segments found for this document+language pair");
    const overrides = payload.segment_overrides && typeof payload.segment_overrides === "object"
      ? payload.segment_overrides as Record<string, Input>
      : {};
    const versionRows = await this.labels.aggregate<{ _id: string; count: number }>([
      { $match: { segment_id: { $in: segments.map(id) } } },
      { $group: { _id: "$segment_id", count: { $sum: 1 } } },
    ]).toArray();
    const versions = new Map(versionRows.map((row) => [row._id, row.count]));
    const plans = segments.map((segment) => {
      const segmentId = id(segment);
      const override = overrides[String(segment.segment_index)] ?? overrides[segmentId] ?? {};
      const plan = reviewLabelPlan({
        segment_id: segmentId,
        labeler_id: payload.labeler_id,
        labeler_email: payload.labeler_email,
        overall: override.overall ?? payload.overall,
        corrected_text: override.corrected_text,
        editor_notes: override.editor_notes ?? payload.editor_notes,
      });
      const { next_status: nextStatus, ...labelFields } = plan;
      const label: LabelDoc = { ...labelFields, label_version: (versions.get(segmentId) ?? 0) + 1, created_at: new Date() };
      return { segment, label, nextStatus };
    });
    await this.labels.bulkWrite(plans.map(({ label }) => ({ insertOne: { document: label } })), { ordered: false });
    await this.segments.bulkWrite(plans.map(({ segment, label, nextStatus }) => ({
      updateOne: {
        filter: { _id: segment._id },
        update: { $set: { ...(label.corrected_text ? { translated_text: label.corrected_text } : {}), status: nextStatus, updated_at: new Date() } },
      },
    })), { ordered: false });
    const graphResults = await Promise.all(plans
      .filter(({ nextStatus }) => nextStatus === "approved")
      .map(({ segment, label }) => this.upsertGraphMemory(segment, label.corrected_text)));
    return {
      ok: true, document_id: documentId, target_lang: targetLang,
      segments_reviewed: segments.length, segments_failed: 0,
      overall: payload.overall, overrides_applied: Object.keys(overrides).length,
      graph_memory_failures: graphResults.filter((result) => !result.success).length,
    };
  }

  async createBatch(payload: Input) {
    const documentIds = Array.isArray(payload.document_ids) ? payload.document_ids.map(String).filter(Boolean) : [];
    if (!payload.garden_id || !payload.target_lang || !documentIds.length) throw new Error("garden_id, target_lang, and document_ids are required");
    const batch: BatchDoc = {
      batch_id: crypto.randomUUID(), garden_id: text(payload.garden_id), target_lang: text(payload.target_lang),
      source_lang: text(payload.source_lang, "en"), project: text(payload.project, "devel"), status: "queued",
      document_ids: documentIds, completed_documents: [], failed_documents: [], created_at: new Date(),
    };
    const inserted = await this.batches.insertOne(batch);
    return { ok: true, batch_id: batch.batch_id, id: inserted.insertedId.toString(), status: batch.status, document_ids: batch.document_ids };
  }

  async listBatches(opts: Input = {}) {
    const filter = copyFilters(opts, ["garden_id", "target_lang", "status"]);
    const rows = await this.batches.find(filter).sort({ created_at: -1 }).limit(50).toArray();
    return { batches: rows.map((row) => ({ ...clean(row) as Input, id: id(row), _id: undefined })) };
  }

  async nextBatch() {
    const row = await this.batches.findOneAndUpdate(
      { status: "queued" },
      { $set: { status: "processing", started_at: new Date(), updated_at: new Date() }, $inc: { attempts: 1 } },
      { sort: { created_at: 1 }, returnDocument: "after" },
    );
    return { batch: row ? { ...clean(row) as Input, id: id(row), _id: undefined } : null };
  }

  async batch(batchId: string) {
    const oid = objectId(batchId);
    const row = await this.batches.findOne(oid ? { _id: oid } : { batch_id: batchId });
    if (!row) throw new Error("Batch not found");
    return { ...clean(row) as Input, id: id(row), _id: undefined };
  }

  async updateBatch(batchId: string, payload: Input) {
    if (!["processing", "complete", "partial", "failed"].includes(String(payload.status))) throw new Error("Invalid status");
    const now = new Date(); const set: Input = { status: payload.status };
    if (payload.status === "processing") Object.assign(set, { started_at: now, ...(payload.agent_session_id ? { agent_session_id: payload.agent_session_id } : {}), ...(payload.agent_conversation_id ? { agent_conversation_id: payload.agent_conversation_id } : {}), ...(payload.agent_run_id ? { agent_run_id: payload.agent_run_id } : {}) });
    if (["complete", "partial", "failed"].includes(String(payload.status))) Object.assign(set, { completed_at: now, ...(payload.error ? { error: payload.error } : {}) });
    const push: Input = { ...(payload.completed_document ? { completed_documents: payload.completed_document } : {}), ...(payload.failed_document ? { failed_documents: payload.failed_document } : {}) };
    const oid = objectId(batchId);
    const result = await this.batches.updateOne(oid ? { _id: oid } : { batch_id: batchId }, { $set: set, ...(Object.keys(push).length ? { $push: push } : {}) });
    if (!result.matchedCount) throw new Error("Batch not found");
    return { ok: true, batch_id: batchId, status: payload.status };
  }
}

export const createTranslationStore = (db: Db, options: TranslationStoreOptions = {}) => new TranslationStore(db, options);
