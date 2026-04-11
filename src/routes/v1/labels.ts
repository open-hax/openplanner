/**
 * Labels API — Native OpenPlanner implementation replacing Python km_labels.
 *
 * Stores label records in MongoDB collection `km_labels`.
 * API shape matches the legacy Python /api/km-labels/ contract.
 */

import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";

// ── Types ────────────────────────────────────────────────────────────

interface ContextChunk {
  id: string;
  text: string;
  source: string;
  source_url?: string;
  source_title?: string;
  position?: number;
  score?: number;
}

interface LabelDimensions {
  correctness: string;
  groundedness: string;
  completeness?: string;
  tone?: string;
  risk: string;
  pii_leakage: string;
  translation_quality?: string;
  overall: string;
}

interface KmLabel {
  example_id: string;
  tenant_id: string;
  domain_id?: string;
  question: string;
  question_lang: string;
  answer: string;
  answer_lang?: string;
  answer_translated?: string;
  answer_target_lang?: string;
  context: ContextChunk[];
  labels: LabelDimensions;
  gold_answer?: string;
  editor_notes?: string;
  model?: string;
  labeler_id?: string;
  labeled_at?: string;
  created_at: string;
  updated_at: string;
}

interface CreateKmLabelPayload {
  tenant_id: string;
  domain_id?: string;
  question: string;
  question_lang?: string;
  answer: string;
  answer_lang?: string;
  answer_translated?: string;
  answer_target_lang?: string;
  context?: ContextChunk[];
  labels: LabelDimensions;
  gold_answer?: string;
  editor_notes?: string;
  model?: string;
}

interface UpdateKmLabelPayload {
  labels?: LabelDimensions;
  gold_answer?: string;
  editor_notes?: string;
  labeler_id?: string;
}

function labelsCollection(app: FastifyInstance) {
  return app.mongo.db.collection("km_labels");
}

function tenantsCollection(app: FastifyInstance) {
  return app.mongo.db.collection("tenants");
}

// ── Routes ───────────────────────────────────────────────────────────

export async function labelsRoutes(app: FastifyInstance) {
  // List labels for a tenant
  app.get<{ Params: { tenant_id: string } }>("/:tenant_id", async (req, reply) => {
    const { tenant_id } = req.params;
    const { domain_id, overall, language, limit = "100", offset = "0" } = req.query as any;

    const filter: any = { tenant_id };
    if (domain_id) filter.domain_id = domain_id;
    if (overall) filter["labels.overall"] = overall;
    if (language) filter.question_lang = language;

    const col = labelsCollection(app);
    const total = await col.countDocuments(filter);
    const rows = await col
      .find(filter)
      .sort({ created_at: -1 })
      .skip(Number(offset))
      .limit(Math.min(Number(limit), 1000))
      .toArray();

    const labels: KmLabel[] = rows.map((r) => ({
      example_id: r.example_id,
      tenant_id: r.tenant_id,
      domain_id: r.domain_id,
      question: r.question,
      question_lang: r.question_lang ?? "en",
      answer: r.answer ?? "",
      answer_lang: r.answer_lang,
      answer_translated: r.answer_translated,
      answer_target_lang: r.answer_target_lang,
      context: r.context ?? [],
      labels: r.labels,
      gold_answer: r.gold_answer,
      editor_notes: r.editor_notes,
      model: r.model,
      labeler_id: r.labeler_id,
      labeled_at: r.labeled_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return { labels, total, offset: Number(offset), limit: Number(limit) };
  });

  // Create a label
  app.post("/", async (req, reply) => {
    const payload = req.body as CreateKmLabelPayload;
    const now = new Date().toISOString();
    const example_id = new ObjectId().toString();

    // Verify tenant exists
    const tenant = await tenantsCollection(app).findOne({ tenant_id: payload.tenant_id });
    if (!tenant) {
      return reply.code(400).send({ detail: "Tenant not found" });
    }

    const doc = {
      example_id,
      tenant_id: payload.tenant_id,
      domain_id: payload.domain_id,
      question: payload.question,
      question_lang: payload.question_lang ?? "en",
      answer: payload.answer,
      answer_lang: payload.answer_lang,
      answer_translated: payload.answer_translated,
      answer_target_lang: payload.answer_target_lang,
      context: payload.context ?? [],
      labels: payload.labels,
      gold_answer: payload.gold_answer,
      editor_notes: payload.editor_notes,
      model: payload.model,
      created_at: now,
      updated_at: now,
    };

    await labelsCollection(app).insertOne(doc);

    return reply.code(201).send({
      example_id,
      tenant_id: payload.tenant_id,
      domain_id: payload.domain_id,
      question: payload.question,
      question_lang: payload.question_lang ?? "en",
      answer: payload.answer,
      answer_lang: payload.answer_lang,
      answer_translated: payload.answer_translated,
      answer_target_lang: payload.answer_target_lang,
      context: payload.context ?? [],
      labels: payload.labels,
      gold_answer: payload.gold_answer,
      editor_notes: payload.editor_notes,
      model: payload.model,
      created_at: now,
      updated_at: now,
    });
  });

  // Get a specific label
  app.get<{ Params: { tenant_id: string; example_id: string } }>(
    "/:tenant_id/:example_id",
    async (req, reply) => {
      const { tenant_id, example_id } = req.params;
      const row = await labelsCollection(app).findOne({ tenant_id, example_id });
      if (!row) return reply.code(404).send({ detail: "Label not found" });

      return {
        example_id: row.example_id,
        tenant_id: row.tenant_id,
        domain_id: row.domain_id,
        question: row.question,
        question_lang: row.question_lang ?? "en",
        answer: row.answer ?? "",
        answer_lang: row.answer_lang,
        answer_translated: row.answer_translated,
        answer_target_lang: row.answer_target_lang,
        context: row.context ?? [],
        labels: row.labels,
        gold_answer: row.gold_answer,
        editor_notes: row.editor_notes,
        model: row.model,
        labeler_id: row.labeler_id,
        labeled_at: row.labeled_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    },
  );

  // Update a label (partial)
  app.patch<{ Params: { tenant_id: string; example_id: string } }>(
    "/:tenant_id/:example_id",
    async (req, reply) => {
      const { tenant_id, example_id } = req.params;
      const payload = req.body as UpdateKmLabelPayload;
      const now = new Date().toISOString();

      const updates: any = { updated_at: now };
      if (payload.labels !== undefined) updates.labels = payload.labels;
      if (payload.gold_answer !== undefined) updates.gold_answer = payload.gold_answer;
      if (payload.editor_notes !== undefined) updates.editor_notes = payload.editor_notes;
      if (payload.labeler_id !== undefined) {
        updates.labeler_id = payload.labeler_id;
        updates.labeled_at = now;
      }

      const result = await labelsCollection(app).findOneAndUpdate(
        { tenant_id, example_id },
        { $set: updates },
        { returnDocument: "after" },
      );

      if (!result) return reply.code(404).send({ detail: "Label not found" });

      return {
        example_id: result.example_id,
        tenant_id: result.tenant_id,
        domain_id: result.domain_id,
        question: result.question,
        question_lang: result.question_lang ?? "en",
        answer: result.answer ?? "",
        answer_lang: result.answer_lang,
        answer_translated: result.answer_translated,
        answer_target_lang: result.answer_target_lang,
        context: result.context ?? [],
        labels: result.labels,
        gold_answer: result.gold_answer,
        editor_notes: result.editor_notes,
        model: result.model,
        labeler_id: result.labeler_id,
        labeled_at: result.labeled_at,
        created_at: result.created_at,
        updated_at: result.updated_at,
      };
    },
  );

  // Delete a label
  app.delete<{ Params: { tenant_id: string; example_id: string } }>(
    "/:tenant_id/:example_id",
    async (req, reply) => {
      const { tenant_id, example_id } = req.params;
      const result = await labelsCollection(app).deleteOne({ tenant_id, example_id });
      if (result.deletedCount === 0) return reply.code(404).send({ detail: "Label not found" });
      return reply.code(204).send();
    },
  );
}
