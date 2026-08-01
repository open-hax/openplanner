/**
 * Direct MongoDB storage for the translation workbench.
 *
 * This is deliberately an SDK surface rather than a REST-client copy: trusted
 * in-process consumers (Knoxx and workers) operate on the same collections as
 * the HTTP compatibility server without making a network round trip.
 */
import { ObjectId, type Db } from "mongodb";

type Row = Record<string, any>;

const text = (value: unknown, fallback = "") => {
  const valueText = String(value ?? "").trim();
  return valueText || fallback;
};

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const date = (value: unknown) => value instanceof Date ? value.toISOString() : value ?? null;
const id = (row: Row) => String(row._id ?? row.id ?? "");

function clean(value: any): any {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof ObjectId) return value.toString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clean(entry)]));
  }
  return value;
}

function statusAfterLabel(current: string, overall: string, correctedText?: string): string {
  if (overall === "approve") return "approved";
  if (overall === "reject") return "rejected";
  if (overall === "needs_edit") return correctedText?.trim() ? "approved" : "in_review";
  return current || "pending";
}

function segmentView(segment: Row, labels: Row[] = [], labelCount?: number) {
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

function objectId(value: string): ObjectId | null {
  try { return new ObjectId(value); } catch { return null; }
}

export class TranslationStore {
  private readonly segments;
  private readonly labels;
  private readonly batches;
  private readonly events;

  constructor(private readonly db: Db) {
    this.segments = db.collection<Row>("translation_segments");
    this.labels = db.collection<Row>("translation_labels");
    this.batches = db.collection<Row>("translation_batches");
    this.events = db.collection<Row>(process.env.MONGODB_EVENTS_COLLECTION ?? "events");
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

  async listSegments(opts: Row = {}) {
    const filter: Row = {};
    for (const key of ["project", "org_id", "status", "source_lang", "target_lang", "domain", "document_id"]) {
      if (opts[key]) filter[key] = opts[key];
    }
    const limit = Math.min(100, Math.max(1, number(opts.limit, 50)));
    const offset = Math.max(0, number(opts.offset, 0));
    const rows = await this.segments.find(filter).sort({ created_at: 1 }).skip(offset).limit(limit).toArray();
    const ids = rows.map(id);
    const counts = await this.labels.aggregate([{ $match: { segment_id: { $in: ids } } }, { $group: { _id: "$segment_id", count: { $sum: 1 } } }]).toArray();
    const countById = new Map(counts.map((row: Row) => [row._id, row.count]));
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

  async createSegment(input: Row) {
    const now = new Date();
    const doc: Row = {
      source_text: text(input.source_text), translated_text: text(input.translated_text),
      source_lang: text(input.source_lang, "en"), target_lang: text(input.target_lang),
      document_id: text(input.document_id), segment_index: number(input.segment_index),
      status: text(input.status, "pending"), garden_id: input.garden_id ?? undefined,
      mt_model: input.mt_model ?? undefined, confidence: input.confidence ?? undefined,
      domain: input.domain ?? undefined, content_type: input.content_type ?? undefined,
      url_context: input.url_context ?? undefined, org_id: input.org_id ?? undefined,
      project: input.project ?? undefined, created_at: now, updated_at: now,
    };
    if (!doc.source_text || !doc.translated_text || !doc.target_lang || !doc.document_id) {
      throw new Error("Missing required fields: source_text, translated_text, target_lang, document_id");
    }
    const result = await this.segments.updateOne(
      { document_id: doc.document_id, segment_index: doc.segment_index, target_lang: doc.target_lang },
      { $set: doc }, { upsert: true },
    );
    return { ok: true, id: result.upsertedId?.toString() ?? (result.modifiedCount ? "updated" : "new"), status: doc.status, upserted: result.upsertedCount > 0, modified: result.modifiedCount > 0 };
  }

  async createSegmentsBatch(payload: Row) {
    const rows = Array.isArray(payload.segments) ? payload.segments : [];
    if (!rows.length) throw new Error("No segments provided");
    const results: Row[] = []; const errors: Row[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      try {
        const segment = await this.createSegment({ ...rows[index], segment_index: rows[index].segment_index ?? index, org_id: payload.org_id ?? "", project: payload.project ?? "" });
        results.push({ index, id: segment.id, status: segment.status });
      } catch (error) { errors.push({ index, error: error instanceof Error ? error.message : String(error) }); }
    }
    return { ok: true, imported: results.length, errors: errors.length, results, ...(errors.length ? { errors_detail: errors } : {}) };
  }

  async labelSegment(segmentId: string, payload: Row) {
    const oid = objectId(segmentId);
    if (!oid) throw new Error("Invalid segment ID");
    const segment = await this.segments.findOne({ _id: oid });
    if (!segment) throw new Error("Segment not found");
    for (const key of ["adequacy", "fluency", "terminology", "risk", "overall"]) if (!payload[key]) throw new Error("Missing required label fields");
    const label: Row = { segment_id: segmentId, labeler_id: text(payload.labeler_id, "unknown"), labeler_email: text(payload.labeler_email, "unknown"), label_version: (await this.labels.countDocuments({ segment_id: segmentId })) + 1, adequacy: payload.adequacy, fluency: payload.fluency, terminology: payload.terminology, risk: payload.risk, overall: payload.overall, corrected_text: payload.corrected_text ? String(payload.corrected_text) : undefined, editor_notes: payload.editor_notes ? String(payload.editor_notes) : undefined, created_at: new Date() };
    const inserted = await this.labels.insertOne(label);
    const newStatus = statusAfterLabel(segment.status, label.overall, label.corrected_text);
    await this.segments.updateOne({ _id: oid }, { $set: { ...(label.corrected_text ? { translated_text: label.corrected_text } : {}), status: newStatus, updated_at: new Date() } });
    return { ok: true, label: { ...clean(label), id: inserted.insertedId.toString(), _id: undefined }, new_status: newStatus };
  }

  async exportSft(opts: Row = {}): Promise<string> {
    const filter: Row = { status: "approved" };
    for (const key of ["project", "target_lang", "org_id"]) if (opts[key]) filter[key] = opts[key];
    const rows = await this.segments.find(filter).toArray();
    const corrected = opts.include_corrected !== "false";
    const lines = await Promise.all(rows.map(async (row) => {
      let translated = row.translated_text;
      if (corrected) {
        const label = await this.labels.find({ segment_id: id(row), corrected_text: { $exists: true, $ne: null } }).sort({ created_at: -1 }).limit(1).next();
        translated = label?.corrected_text || translated;
      }
      return JSON.stringify({ messages: [{ role: "user", content: `Translate from English to ${row.target_lang}:\n${row.source_text}` }, { role: "assistant", content: translated }] });
    }));
    return lines.join("\n");
  }

  async manifest(project?: string) {
    const filter: Row = project ? { project } : {};
    const rows = await this.segments.find(filter).toArray();
    const languages = Object.values(rows.reduce((all: Row, row) => {
      const entry = all[row.target_lang] ??= { target_lang: row.target_lang, total: 0, approved: 0, rejected: 0, pending: 0, in_review: 0 };
      entry.total += 1; entry[row.status] = (entry[row.status] ?? 0) + 1; return all;
    }, {}));
    return { project: project || "all", languages, generated_at: new Date().toISOString() };
  }

  async documents(opts: Row = {}) {
    const filter: Row = {};
    for (const key of ["project", "target_lang", "source_lang", "garden_id"]) if (opts[key]) filter[key] = opts[key];
    const rows = await this.segments.find(filter).toArray();
    const grouped = new Map<string, Row>();
    for (const row of rows) {
      const key = `${row.document_id}:${row.target_lang}`; const entry = grouped.get(key) ?? { document_id: row.document_id, target_lang: row.target_lang, source_lang: row.source_lang, garden_id: row.garden_id ?? null, project: row.project ?? null, total_segments: 0, approved: 0, pending: 0, rejected: 0, in_review: 0 };
      entry.total_segments += 1; entry[row.status] = (entry[row.status] ?? 0) + 1; grouped.set(key, entry);
    }
    return { documents: [...grouped.values()].sort((a, b) => `${a.document_id}:${a.target_lang}`.localeCompare(`${b.document_id}:${b.target_lang}`)), total: grouped.size };
  }

  async document(documentId: string, targetLang: string) {
    const event = await this.events.findOne({ _id: documentId });
    if (!event) throw new Error("Document not found");
    const rows = await this.segments.find({ document_id: documentId, target_lang: targetLang }).sort({ segment_index: 1, created_at: -1 }).toArray();
    const byIndex = new Map<number, Row>(); for (const row of rows) if (!byIndex.has(row.segment_index)) byIndex.set(row.segment_index, row);
    const segments = [...byIndex.values()].sort((a, b) => a.segment_index - b.segment_index);
    const labels = await this.labels.find({ segment_id: { $in: segments.map(id) } }).sort({ created_at: -1 }).toArray();
    const extra = event.extra ?? {};
    return { document: { id: documentId, title: text(extra.title, "Untitled"), content: text(extra.content ?? extra.text), source_lang: text(extra.language, "en"), visibility: text(extra.visibility, "internal"), source_path: extra.sourcePath ?? extra.source_path ?? null }, segments: segments.map((row) => segmentView(row)), labels: labels.map(clean) };
  }

  async reviewDocument(documentId: string, targetLang: string, payload: Row) {
    if (!["approve", "needs_edit", "reject"].includes(payload.overall)) throw new Error("overall must be approve, needs_edit, or reject");
    const segments = await this.segments.find({ document_id: documentId, target_lang: targetLang }).sort({ segment_index: 1 }).toArray();
    if (!segments.length) throw new Error("No segments found for this document+language pair");
    const overrides = payload.segment_overrides ?? {};
    for (const row of segments) {
      const override = overrides[String(row.segment_index)] ?? overrides[id(row)] ?? {};
      await this.labelSegment(id(row), { adequacy: "adequate", fluency: "adequate", terminology: "correct", risk: "safe", overall: override.overall ?? payload.overall, corrected_text: override.corrected_text, editor_notes: override.editor_notes ?? payload.editor_notes, labeler_id: payload.labeler_id, labeler_email: payload.labeler_email });
    }
    return { ok: true, document_id: documentId, target_lang: targetLang, segments_reviewed: segments.length, overall: payload.overall, overrides_applied: Object.keys(overrides).length };
  }

  async createBatch(payload: Row) {
    if (!payload.garden_id || !payload.target_lang || !Array.isArray(payload.document_ids) || !payload.document_ids.length) throw new Error("garden_id, target_lang, and document_ids are required");
    const batch = { batch_id: crypto.randomUUID(), garden_id: payload.garden_id, target_lang: payload.target_lang, source_lang: payload.source_lang ?? "en", project: payload.project ?? "devel", status: "queued", document_ids: payload.document_ids, completed_documents: [], failed_documents: [], created_at: new Date() };
    const inserted = await this.batches.insertOne(batch); return { ok: true, batch_id: batch.batch_id, id: inserted.insertedId.toString(), status: batch.status, document_ids: batch.document_ids };
  }

  async listBatches(opts: Row = {}) { const filter: Row = {}; for (const key of ["garden_id", "target_lang", "status"]) if (opts[key]) filter[key] = opts[key]; const rows = await this.batches.find(filter).sort({ created_at: -1 }).limit(50).toArray(); return { batches: rows.map((row) => ({ ...clean(row), id: id(row), _id: undefined })) }; }
  async nextBatch() { const row = await this.batches.findOne({ status: "queued" }, { sort: { created_at: 1 } }); return { batch: row ? { ...clean(row), id: id(row), _id: undefined } : null }; }
  async batch(batchId: string) { const oid = objectId(batchId); const row = await this.batches.findOne(oid ? { _id: oid } : { batch_id: batchId }); if (!row) throw new Error("Batch not found"); return { ...clean(row), id: id(row), _id: undefined }; }
  async updateBatch(batchId: string, payload: Row) {
    if (!["processing", "complete", "partial", "failed"].includes(payload.status)) throw new Error("Invalid status");
    const now = new Date(); const set: Row = { status: payload.status };
    if (payload.status === "processing") Object.assign(set, { started_at: now, ...(payload.agent_session_id ? { agent_session_id: payload.agent_session_id } : {}), ...(payload.agent_conversation_id ? { agent_conversation_id: payload.agent_conversation_id } : {}), ...(payload.agent_run_id ? { agent_run_id: payload.agent_run_id } : {}) });
    if (["complete", "partial", "failed"].includes(payload.status)) Object.assign(set, { completed_at: now, ...(payload.error ? { error: payload.error } : {}) });
    const push: Row = { ...(payload.completed_document ? { completed_documents: payload.completed_document } : {}), ...(payload.failed_document ? { failed_documents: payload.failed_document } : {}) };
    const oid = objectId(batchId); const result = await this.batches.updateOne(oid ? { _id: oid } : { batch_id: batchId }, { $set: set, ...(Object.keys(push).length ? { $push: push } : {}) });
    if (!result.matchedCount) throw new Error("Batch not found"); return { ok: true, batch_id: batchId, status: payload.status };
  }
}

export const createTranslationStore = (db: Db) => new TranslationStore(db);
