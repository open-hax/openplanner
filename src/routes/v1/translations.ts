import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";

/**
 * Translation Segment Schema
 * Stored in MongoDB translation_segments collection
 */
interface TranslationSegment {
  _id?: ObjectId;
  id?: string;
  source_text: string;
  translated_text: string;
  source_lang: string;
  target_lang: string;
  document_id: string;
  segment_index: number;
  status: "pending" | "in_review" | "approved" | "rejected";
  mt_model?: string;
  confidence?: number;
  domain?: string;
  content_type?: string;
  url_context?: string;
  org_id?: string;
  project?: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * Translation Label Schema
 * Stored in MongoDB translation_labels collection
 */
interface TranslationLabel {
  _id?: ObjectId;
  segment_id: string;
  labeler_id: string;
  labeler_email: string;
  label_version: number;
  adequacy: "excellent" | "good" | "adequate" | "poor" | "unusable";
  fluency: "excellent" | "good" | "adequate" | "poor" | "unusable";
  terminology: "correct" | "minor_errors" | "major_errors";
  risk: "safe" | "sensitive" | "policy_violation";
  overall: "approve" | "needs_edit" | "reject";
  corrected_text?: string;
  editor_notes?: string;
  created_at: Date;
}

/**
 * Graph memory integration for zero-shot learning
 * Upserts approved translations to graph memory for MT context enrichment
 */
async function upsertTranslationToGraphMemory(
  app: FastifyInstance,
  segment: TranslationSegment,
  correctedText?: string
): Promise<{ success: boolean; error?: string }> {
  const targetText = correctedText || segment.translated_text;
  if (!targetText || !segment.source_text) {
    return { success: false, error: "Missing source or target text" };
  }

  const nodeId = `translation:${segment.source_lang}:${segment.target_lang}:${segment._id}`;
  const nodeLabel = `${segment.source_lang}→${segment.target_lang}: ${segment.source_text.slice(0, 50)}...`;

  try {
    // Upsert to graph_nodes collection
    await app.mongo.db.collection("graph_nodes").updateOne(
      { id: nodeId },
      {
        $set: {
          id: nodeId,
          kind: "translation_example",
          label: nodeLabel,
          data: {
            source_text: segment.source_text,
            target_text: targetText,
            source_lang: segment.source_lang,
            target_lang: segment.target_lang,
            document_id: segment.document_id,
            domain: segment.domain,
            content_type: segment.content_type,
            quality: "approved",
            segment_id: segment._id?.toString(),
          },
          updated_at: new Date(),
        },
        $setOnInsert: {
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    // Also create edge
    await app.mongo.db.collection("graph_edges").updateOne(
      { id: `translation:doc:${segment.document_id}:${segment._id}` },
      {
        $set: {
          id: `translation:doc:${segment.document_id}:${segment._id}`,
          source: segment.document_id,
          target: nodeId,
          kind: "has_translation",
          data: {
            source_lang: segment.source_lang,
            target_lang: segment.target_lang,
          },
          updated_at: new Date(),
        },
        $setOnInsert: {
          created_at: new Date(),
        },
      },
      { upsert: true }
    );

    return { success: true };
  } catch (err) {
    console.error("Failed to upsert translation to graph memory:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Query graph memory for similar translation examples (zero-shot context)
 */
async function queryTranslationExamples(
  app: FastifyInstance,
  sourceText: string,
  sourceLang: string,
  targetLang: string,
  limit: number = 5
): Promise<Array<{ source_text: string; target_text: string; similarity?: number }>> {
  try {
    // Query by language pair and text similarity
    // For now, use regex-based partial match; later can use vector similarity
    const nodes = await app.mongo.db
      .collection("graph_nodes")
      .find({
        kind: "translation_example",
        "data.source_lang": sourceLang,
        "data.target_lang": targetLang,
        $or: [
          { "data.source_text": { $regex: sourceText.slice(0, 30), $options: "i" } },
          { "data.domain": { $exists: true } },
        ],
      })
      .limit(limit)
      .toArray();

    return nodes.map((n) => {
      const data = n.data as Record<string, unknown> | undefined;
      return {
        source_text: String(data?.source_text ?? ""),
        target_text: String(data?.target_text ?? ""),
        similarity: data?.domain ? 0.5 : 0.3,
      };
    });
  } catch (err) {
    console.error("Failed to query translation examples:", err);
    return [];
  }
}

export const translationRoutes: FastifyPluginAsync = async (app) => {
  // Get MongoDB collections
  const segmentsCollection = app.mongo.db.collection("translation_segments");
  const labelsCollection = app.mongo.db.collection("translation_labels");

  // Create indexes
  await segmentsCollection.createIndex({ document_id: 1, segment_index: 1 });
  await segmentsCollection.createIndex({ status: 1 });
  await segmentsCollection.createIndex({ target_lang: 1 });
  await segmentsCollection.createIndex({ org_id: 1 });
  await labelsCollection.createIndex({ segment_id: 1, created_at: -1 });

  /**
   * List translation segments with filtering
   * GET /v1/translations/segments
   */
  app.get("/translations/segments", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};

    // Build filter
    if (query.project) filter.project = query.project;
    if (query.org_id) filter.org_id = query.org_id;
    if (query.status) filter.status = query.status;
    if (query.source_lang) filter.source_lang = query.source_lang;
    if (query.target_lang) filter.target_lang = query.target_lang;
    if (query.domain) filter.domain = query.domain;
    if (query.document_id) filter.document_id = query.document_id;

    const limit = Math.min(100, Math.max(1, Number(query.limit ?? 50)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    const segments = await segmentsCollection
      .find(filter)
      .sort({ created_at: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const total = await segmentsCollection.countDocuments(filter);

    // Return formatted response
    return {
      segments: segments.map((s) => ({
        ...s,
        id: s._id.toString(),
        _id: undefined,
      })),
      total,
      has_more: offset + segments.length < total,
    };
  });

  /**
   * Get single segment with labels
   * GET /v1/translations/segments/:id
   */
  app.get("/translations/segments/:id", async (req, reply) => {
    const id = (req.params as { id: string }).id;

    let segment;
    try {
      segment = await segmentsCollection.findOne({ _id: new ObjectId(id) });
    } catch (err) {
      return reply.status(400).send({ error: "Invalid segment ID" });
    }

    if (!segment) {
      return reply.status(404).send({ error: "Segment not found" });
    }

    // Fetch labels for this segment
    const labels = await labelsCollection
      .find({ segment_id: id })
      .sort({ created_at: -1 })
      .toArray();

    return {
      ...segment,
      id: segment._id.toString(),
      _id: undefined,
      labels: labels.map((l) => ({
        ...l,
        id: l._id.toString(),
        _id: undefined,
      })),
    };
  });

  /**
   * Submit label for segment
   * POST /v1/translations/segments/:id/labels
   */
  app.post("/translations/segments/:id/labels", async (req, reply) => {
    const segmentId = (req.params as { id: string }).id;
    const body = req.body as Record<string, unknown>;

    // Verify segment exists
    let segment;
    try {
      segment = await segmentsCollection.findOne({ _id: new ObjectId(segmentId) });
    } catch (err) {
      return reply.status(400).send({ error: "Invalid segment ID" });
    }

    if (!segment) {
      return reply.status(404).send({ error: "Segment not found" });
    }

    // Get existing label count for versioning
    const existingLabels = await labelsCollection.countDocuments({ segment_id: segmentId });

    // Create label document
    const label: TranslationLabel = {
      segment_id: segmentId,
      labeler_id: String(body.labeler_id || "unknown"),
      labeler_email: String(body.labeler_email || "unknown"),
      label_version: existingLabels + 1,
      adequacy: body.adequacy as TranslationLabel["adequacy"],
      fluency: body.fluency as TranslationLabel["fluency"],
      terminology: body.terminology as TranslationLabel["terminology"],
      risk: body.risk as TranslationLabel["risk"],
      overall: body.overall as TranslationLabel["overall"],
      corrected_text: body.corrected_text ? String(body.corrected_text) : undefined,
      editor_notes: body.editor_notes ? String(body.editor_notes) : undefined,
      created_at: new Date(),
    };

    // Validate required fields
    if (!label.adequacy || !label.fluency || !label.terminology || !label.risk || !label.overall) {
      return reply.status(400).send({ error: "Missing required label fields" });
    }

    await labelsCollection.insertOne(label);

    // Update segment status based on label
    let newStatus: TranslationSegment["status"] = segment.status as TranslationSegment["status"];

    if (label.overall === "approve") {
      newStatus = "approved";
    } else if (label.overall === "needs_edit") {
      newStatus = label.corrected_text ? "approved" : "in_review";
    } else if (label.overall === "reject") {
      newStatus = "rejected";
    }

    await segmentsCollection.updateOne(
      { _id: new ObjectId(segmentId) },
      {
        $set: {
          status: newStatus,
          updated_at: new Date(),
        },
      }
    );

    // Upsert approved translation to graph memory for zero-shot learning
    let graphMemoryResult: { success: boolean; error?: string } | undefined;
    if (newStatus === "approved") {
      graphMemoryResult = await upsertTranslationToGraphMemory(
        app,
        segment as TranslationSegment,
        label.corrected_text
      );
    }

    return {
      ok: true,
      label: {
        ...label,
        id: label._id?.toString(),
        _id: undefined,
      },
      new_status: newStatus,
      graph_memory: graphMemoryResult,
    };
  });

  /**
   * Batch import translation segments (for MT pipeline)
   * POST /v1/translations/segments/batch
   */
  app.post("/translations/segments/batch", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const segments = (body.segments as Record<string, unknown>[]) || [];
    const orgId = String(body.org_id || "");
    const project = String(body.project || "");

    if (segments.length === 0) {
      return reply.status(400).send({ error: "No segments provided" });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];

      try {
        const doc: TranslationSegment = {
          source_text: String(seg.source_text || ""),
          translated_text: String(seg.translated_text || ""),
          source_lang: String(seg.source_lang || "en"),
          target_lang: String(seg.target_lang || ""),
          document_id: String(seg.document_id || ""),
          segment_index: Number(seg.segment_index ?? i),
          status: "pending",
          mt_model: seg.mt_model ? String(seg.mt_model) : undefined,
          confidence: seg.confidence ? Number(seg.confidence) : undefined,
          domain: seg.domain ? String(seg.domain) : undefined,
          content_type: seg.content_type ? String(seg.content_type) : undefined,
          url_context: seg.url_context ? String(seg.url_context) : undefined,
          org_id: orgId,
          project: project,
          created_at: new Date(),
          updated_at: new Date(),
        };

        // Validate required fields
        if (!doc.source_text || !doc.translated_text || !doc.target_lang || !doc.document_id) {
          errors.push({ index: i, error: "Missing required fields" });
          continue;
        }

        const result = await segmentsCollection.insertOne(doc);
        results.push({
          index: i,
          id: result.insertedId.toString(),
          status: doc.status,
        });
      } catch (err) {
        errors.push({
          index: i,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ok: true,
      imported: results.length,
      errors: errors.length,
      results,
      errors_detail: errors.length > 0 ? errors : undefined,
    };
  });

  /**
   * Export SFT training data (JSONL)
   * GET /v1/translations/export/sft
   */
  app.get("/translations/export/sft", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = { status: "approved" };

    if (query.project) filter.project = query.project;
    if (query.target_lang) filter.target_lang = query.target_lang;
    if (query.org_id) filter.org_id = query.org_id;

    const includeCorrected = query.include_corrected !== "false";

    const segments = await segmentsCollection.find(filter).toArray();
    const lines: string[] = [];

    for (const seg of segments) {
      // Get corrected text if available
      let targetText = seg.translated_text;

      if (includeCorrected) {
        const labels = await labelsCollection
          .find({
            segment_id: seg._id.toString(),
            corrected_text: { $exists: true, $ne: null },
          })
          .sort({ created_at: -1 })
          .limit(1)
          .toArray();

        if (labels.length > 0 && labels[0].corrected_text) {
          targetText = labels[0].corrected_text;
        }
      }

      const prompt = `Translate the following text from English to ${seg.target_lang}. Preserve formatting, technical terms, and code examples.\n\nText:\n${seg.source_text}`;

      lines.push(JSON.stringify({ prompt, target: targetText }));
    }

    reply.header("Content-Type", "application/x-ndjson");
    reply.header("Content-Disposition", `attachment; filename="translations_sft_${Date.now()}.jsonl"`);
    return lines.join("\n");
  });

  /**
   * Export manifest with statistics
   * GET /v1/translations/export/manifest
   */
  app.get("/translations/export/manifest", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const projectFilter: Record<string, unknown> = {};

    if (query.project) projectFilter.project = query.project;
    if (query.org_id) projectFilter.org_id = query.org_id;

    // Aggregate by target language
    const languages = await segmentsCollection
      .aggregate([
        { $match: projectFilter },
        {
          $group: {
            _id: "$target_lang",
            total: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
            in_review: { $sum: { $cond: [{ $eq: ["$status", "in_review"] }, 1, 0] } },
            with_corrections: {
              $sum: {
                $cond: [
                  {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: { $ifNull: ["$labels", []] },
                            as: "label",
                            cond: { $ne: ["$$label.corrected_text", null] },
                          },
                        },
                      },
                      0,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .toArray();

    // Get labeler statistics
    const labelers = await labelsCollection
      .aggregate([
        { $match: projectFilter },
        {
          $group: {
            _id: "$labeler_email",
            segments_labeled: { $sum: 1 },
          },
        },
      ])
      .toArray();

    // Calculate export sizes
    const exportSizes: Record<string, { rows: number; bytes_estimate: number }> = {};
    for (const lang of languages) {
      const key = `sft_${lang._id}`;
      exportSizes[key] = {
        rows: lang.approved,
        bytes_estimate: lang.approved * 500, // Rough estimate
      };
    }

    return {
      project: query.project || "all",
      generated_at: new Date().toISOString(),
      languages: Object.fromEntries(languages.map((l) => [l._id, l])),
      labelers: labelers.map((l) => ({
        email: l._id,
        segments_labeled: l.segments_labeled,
      })),
      export_sizes: exportSizes,
    };
  });

  /**
   * Trigger translation for a document
   * POST /v1/documents/:id/translate
   */
  app.post("/documents/:id/translate", async (req, reply) => {
    const documentId = (req.params as { id: string }).id;
    const body = req.body as Record<string, unknown>;

    // Get document from events collection
    const document = await app.mongo.events.findOne({ _id: documentId });

    if (!document) {
      return reply.status(404).send({ error: "Document not found" });
    }

    const targetLangs = (body.target_languages as string[]) || ["es", "de"];
    const gardenId = body.garden_id as string | undefined;
    const text = String(document.text || "");

    if (!text.trim()) {
      return reply.status(400).send({ error: "Document has no content to translate" });
    }

    // Create one job per target language (matches CMS behavior)
    const jobsCollection = app.mongo.db.collection("translation_jobs");
    const jobIds: string[] = [];

    for (const targetLang of targetLangs) {
      const job = {
        document_id: documentId,
        garden_id: gardenId,
        project: document.project,
        source_lang: "en",
        target_language: targetLang, // Singular, matching worker expectation
        status: "queued",
        created_at: new Date(),
      };

      const result = await jobsCollection.insertOne(job);
      jobIds.push(result.insertedId.toString());
    }

    return {
      ok: true,
      job_id: jobIds[0],
      job_ids: jobIds,
      document_id: documentId,
      target_languages: targetLangs,
      status: "queued",
      message: "Translation job(s) created. MT pipeline will process them.",
    };
  });

  /**
   * Get translation jobs status
   * GET /v1/translations/jobs
   */
  app.get("/translations/jobs", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const filter: Record<string, unknown> = {};

    if (query.document_id) filter.document_id = query.document_id;
    if (query.status) filter.status = query.status;

    const jobsCollection = app.mongo.db.collection("translation_jobs");
    const jobs = await jobsCollection.find(filter).sort({ created_at: -1 }).limit(50).toArray();

    return {
      jobs: jobs.map((j) => ({
        ...j,
        id: j._id.toString(),
        _id: undefined,
      })),
    };
  });

  /**
   * Get translation examples from graph memory (zero-shot context)
   * GET /v1/translations/examples
   * Used by MT pipeline to get few-shot examples for better translations
   */
  app.get("/translations/examples", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;
    const sourceText = query.source_text || "";
    const sourceLang = query.source_lang || "en";
    const targetLang = query.target_lang || "";
    const limit = Math.min(10, Math.max(1, Number(query.limit ?? 5)));

    if (!targetLang) {
      return reply.status(400).send({ error: "target_lang is required" });
    }

    const examples = await queryTranslationExamples(
      app,
      sourceText,
      sourceLang,
      targetLang,
      limit
    );

    return {
      source_lang: sourceLang,
      target_lang: targetLang,
      examples,
      count: examples.length,
    };
  });

  /**
   * Get graph memory stats for translations
   * GET /v1/translations/graph-stats
   */
  app.get("/translations/graph-stats", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;

    const filter: Record<string, unknown> = { kind: "translation_example" };
    if (query.source_lang) filter["data.source_lang"] = query.source_lang;
    if (query.target_lang) filter["data.target_lang"] = query.target_lang;

    const totalNodes = await app.mongo.db.collection("graph_nodes").countDocuments(filter);

    // Group by language pair
    const byLanguagePair = await app.mongo.db
      .collection("graph_nodes")
      .aggregate([
        { $match: filter },
        {
          $group: {
            _id: {
              source_lang: "$data.source_lang",
              target_lang: "$data.target_lang",
            },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    return {
      total_translation_nodes: totalNodes,
      by_language_pair: Object.fromEntries(
        byLanguagePair.map((p) => [`${p._id.source_lang}→${p._id.target_lang}`, p.count])
      ),
    };
  });
};
