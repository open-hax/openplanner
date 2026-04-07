import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "crypto";
import { upsertEvent } from "../../lib/mongodb.js";
import type { EventDocument } from "../../lib/mongodb.js";

function norm(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return String(v);
}

function eventToSegmentResponse(event: EventDocument, labels: EventDocument[] = []) {
  const extra = (event.extra as Record<string, unknown>) ?? {};
  const meta = (event.extra as Record<string, unknown>)?.meta as Record<string, unknown> ?? {};
  
  return {
    id: event.id,
    source_text: meta?.source_text ?? "",
    translated_text: event.text ?? "",
    source_lang: meta?.source_lang ?? "en",
    target_lang: meta?.target_lang ?? "en",
    status: meta?.status ?? "pending",
    confidence: meta?.confidence,
    mt_model: meta?.mt_model,
    document_id: event.message ?? "",
    segment_index: meta?.segment_index ?? 0,
    domain: extra?.domain,
    tenant_id: extra?.tenant_id ?? "",
    org_id: extra?.org_id ?? "",
    labels: labels.map(eventToLabelResponse),
    ts: event.ts instanceof Date ? event.ts.toISOString() : event.ts,
  };
}

function eventToLabelResponse(event: EventDocument) {
  const extra = (event.extra as Record<string, unknown>) ?? {};
  
  return {
    id: event.id,
    segment_id: extra?.segment_id ?? "",
    labeler_id: extra?.labeler_id ?? "",
    labeler_email: extra?.labeler_email ?? "",
    adequacy: extra?.adequacy ?? "",
    fluency: extra?.fluency ?? "",
    terminology: extra?.terminology ?? "",
    risk: extra?.risk ?? "",
    overall: extra?.overall ?? "",
    corrected_text: extra?.corrected_text,
    editor_notes: extra?.editor_notes,
    ts: event.ts instanceof Date ? event.ts.toISOString() : event.ts,
  };
}

export const translationRoutes: FastifyPluginAsync = async (app) => {
  // List translation segments
  app.get<{
    Querystring: {
      project?: string;
      status?: string;
      source_lang?: string;
      target_lang?: string;
      domain?: string;
      limit?: number;
      offset?: number;
    };
  }>("/translations/segments", async (req, reply) => {
    const { project, status, source_lang, target_lang, domain } = req.query;
    const limit = Math.max(1, Number(req.query.limit ?? 50) || 50);
    const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);

    if (!project) {
      return reply.status(400).send({ error: "project is required" });
    }

    const filter: Record<string, unknown> = {
      kind: "translation.segment",
      project,
    };

    if (status) filter["extra.meta.status"] = status;
    if (source_lang) filter["extra.meta.source_lang"] = source_lang;
    if (target_lang) filter["extra.meta.target_lang"] = target_lang;
    if (domain) filter["extra.domain"] = domain;

    const segments = await app.mongo.events
      .find(filter)
      .sort({ ts: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const total = await app.mongo.events.countDocuments(filter);

    // Fetch labels for each segment
    const segmentsWithLabels = await Promise.all(
      segments.map(async (seg) => {
        const labels = await app.mongo.events
          .find({
            kind: "translation.label",
            "extra.segment_id": seg.id,
          })
          .sort({ ts: -1 })
          .toArray();
        return eventToSegmentResponse(seg as unknown as EventDocument, labels as unknown as EventDocument[]);
      })
    );

    return {
      segments: segmentsWithLabels,
      total,
      has_more: offset + segments.length < total,
    };
  });

  // Get single segment with labels
  app.get<{ Params: { id: string } }>("/translations/segments/:id", async (req, reply) => {
    const { id } = req.params;

    const segment = await app.mongo.events.findOne({ id, kind: "translation.segment" });
    if (!segment) {
      return reply.status(404).send({ error: "Segment not found" });
    }

    const labels = await app.mongo.events
      .find({
        kind: "translation.label",
        "extra.segment_id": id,
      })
      .sort({ ts: -1 })
      .toArray();

    return eventToSegmentResponse(segment as unknown as EventDocument, labels as unknown as EventDocument[]);
  });

  // Submit label
  app.post<{
    Params: { id: string };
    Body: {
      adequacy: "excellent" | "good" | "adequate" | "poor" | "unusable";
      fluency: "excellent" | "good" | "adequate" | "poor" | "unusable";
      terminology: "correct" | "minor_errors" | "major_errors";
      risk: "safe" | "sensitive" | "policy_violation";
      overall: "approve" | "needs_edit" | "reject";
      corrected_text?: string;
      editor_notes?: string;
      // Auth context can come from body or headers
      labeler_id?: string;
      labeler_email?: string;
      org_id?: string;
      tenant_id?: string;
    };
  }>("/translations/segments/:id/labels", async (req, reply) => {
    const { id } = req.params;
    const body = req.body;

    // Auth context from body (preferred for Knoxx proxy) or headers
    const labelerId = body.labeler_id || req.headers["x-knoxx-user-id"] as string || "unknown";
    const labelerEmail = body.labeler_email || req.headers["x-knoxx-user-email"] as string || "unknown@unknown";
    const orgId = body.org_id || req.headers["x-knoxx-org-id"] as string || "";
    const tenantId = body.tenant_id || req.headers["x-knoxx-tenant-id"] as string || "";

    // Get segment
    const segment = await app.mongo.events.findOne({ id, kind: "translation.segment" });
    if (!segment) {
      return reply.status(404).send({ error: "Segment not found" });
    }

    const segExtra = (segment.extra as Record<string, unknown>) ?? {};
    const segMeta = segExtra?.meta as Record<string, unknown> ?? {};

    // Get current label version
    const existingLabels = await app.mongo.events
      .find({ kind: "translation.label", "extra.segment_id": id })
      .sort({ ts: -1 })
      .limit(1)
      .toArray();
    const labelVersion = existingLabels.length > 0 
      ? (((existingLabels[0].extra as Record<string, unknown>)?.label_version as number) ?? 0) + 1 
      : 1;

    // Determine new status
    let newStatus: string = (segMeta?.status as string) ?? "pending";
    if (body.overall === "approve") {
      newStatus = "approved";
    } else if (body.overall === "needs_edit") {
      newStatus = body.corrected_text ? "approved" : "in_review";
    } else if (body.overall === "reject") {
      newStatus = "rejected";
    }

    const labelId = randomUUID();
    const now = new Date();

    // Create label event
    await upsertEvent(app.mongo.events, {
      id: labelId,
      ts: now,
      source: "shibboleth",
      kind: "translation.label",
      project: segment.project,
      session: segment.session,
      message: null,
      role: null,
      author: labelerEmail,
      model: null,
      tags: null,
      text: null,
      attachments: null,
      extra: {
        segment_id: id,
        document_id: segment.message,
        tenant_id: segExtra?.tenant_id ?? tenantId,
        org_id: segExtra?.org_id ?? orgId,
        labeler_id: labelerId,
        labeler_email: labelerEmail,
        label_version: labelVersion,
        adequacy: body.adequacy,
        fluency: body.fluency,
        terminology: body.terminology,
        risk: body.risk,
        overall: body.overall,
        corrected_text: body.corrected_text,
        editor_notes: body.editor_notes,
      },
    });

    // Update segment status
    await app.mongo.events.updateOne(
      { id, kind: "translation.segment" },
      { 
        $set: { 
          "extra.meta.status": newStatus,
          updatedAt: now,
        } 
      }
    );

    return { ok: true, label_id: labelId, new_status: newStatus };
  });

  // SFT export
  app.get<{
    Querystring: {
      project?: string;
      target_lang?: string;
      include_corrected?: string | boolean;
    };
  }>("/translations/export/sft", async (req, reply) => {
    const { project, target_lang } = req.query;
    const includeCorrected = String(req.query.include_corrected ?? "true") !== "false";

    if (!project) {
      return reply.status(400).send({ error: "project is required" });
    }

    const filter: Record<string, unknown> = {
      kind: "translation.segment",
      project,
      "extra.meta.status": "approved",
    };
    if (target_lang) filter["extra.meta.target_lang"] = target_lang;

    const segments = await app.mongo.events.find(filter).sort({ ts: 1 }).toArray();
    const rows: string[] = [];

    for (const segment of segments) {
      const labels = await app.mongo.events
        .find({ kind: "translation.label", "extra.segment_id": segment.id })
        .sort({ ts: -1 })
        .toArray();
      const latestWithCorrection = labels.find((label) => {
        const extra = (label.extra as Record<string, unknown>) ?? {};
        return typeof extra.corrected_text === "string" && extra.corrected_text.length > 0;
      });
      const segExtra = (segment.extra as Record<string, unknown>) ?? {};
      const segMeta = (segExtra.meta as Record<string, unknown>) ?? {};
      const sourceText = String(segMeta.source_text ?? "");
      const targetText = includeCorrected && latestWithCorrection
        ? String(((latestWithCorrection.extra as Record<string, unknown>) ?? {}).corrected_text ?? segment.text ?? "")
        : String(segment.text ?? "");
      const langName = String(segMeta.target_lang ?? target_lang ?? "target language");
      rows.push(JSON.stringify({
        prompt: `Translate the following text from English to ${langName}. Preserve formatting and technical terms.\n\nText: ${sourceText}`,
        target: targetText,
      }));
    }

    reply.header("Content-Type", "application/x-ndjson");
    return rows.join("\n") + (rows.length ? "\n" : "");
  });

  // Manifest export
  app.get<{
    Querystring: {
      project?: string;
    };
  }>("/translations/export/manifest", async (req, reply) => {
    const { project } = req.query;

    if (!project) {
      return reply.status(400).send({ error: "project is required" });
    }

    const segments = await app.mongo.events.find({ kind: "translation.segment", project }).toArray();
    const labels = await app.mongo.events.find({ kind: "translation.label", project }).toArray();

    const languages: Record<string, any> = {};
    const labelers = new Map<string, number>();

    for (const segment of segments) {
      const segExtra = (segment.extra as Record<string, unknown>) ?? {};
      const segMeta = (segExtra.meta as Record<string, unknown>) ?? {};
      const lang = String(segMeta.target_lang ?? "unknown");
      const status = String(segMeta.status ?? "pending");
      if (!languages[lang]) {
        languages[lang] = {
          total_segments: 0,
          approved: 0,
          rejected: 0,
          pending: 0,
          in_review: 0,
          avg_labels_per_segment: 0,
          with_corrections: 0,
        };
      }
      languages[lang].total_segments += 1;
      if (typeof languages[lang][status] === "number") {
        languages[lang][status] += 1;
      }
      const segmentLabels = labels.filter((label) => ((label.extra as Record<string, unknown>) ?? {}).segment_id === segment.id);
      languages[lang].avg_labels_per_segment += segmentLabels.length;
      if (segmentLabels.some((label) => {
        const extra = (label.extra as Record<string, unknown>) ?? {};
        return typeof extra.corrected_text === "string" && extra.corrected_text.length > 0;
      })) {
        languages[lang].with_corrections += 1;
      }
    }

    for (const lang of Object.keys(languages)) {
      if (languages[lang].total_segments > 0) {
        languages[lang].avg_labels_per_segment = Number((languages[lang].avg_labels_per_segment / languages[lang].total_segments).toFixed(2));
      }
    }

    for (const label of labels) {
      const extra = (label.extra as Record<string, unknown>) ?? {};
      const email = String(extra.labeler_email ?? "unknown");
      labelers.set(email, (labelers.get(email) ?? 0) + 1);
    }

    const export_sizes: Record<string, { rows: number; bytes_estimate: number }> = {};
    for (const [lang, stats] of Object.entries(languages)) {
      export_sizes[`sft_${lang}`] = {
        rows: stats.approved,
        bytes_estimate: stats.approved * 500,
      };
    }

    return {
      project,
      generated_at: new Date().toISOString(),
      languages,
      labelers: Array.from(labelers.entries()).map(([email, segments_labeled]) => ({ email, segments_labeled })),
      export_sizes,
    };
  });

  // Batch import segments
  app.post<{
    Body: {
      segments: {
        source_text: string;
        translated_text: string;
        source_lang: string;
        target_lang: string;
        document_id: string;
        segment_index: number;
        mt_model?: string;
        confidence?: number;
        domain?: string;
        project?: string;
        tenant_id?: string;
        org_id?: string;
      }[];
    };
  }>("/translations/segments/batch", async (req, reply) => {
    const { segments } = req.body;

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return reply.status(400).send({ error: "segments array is required" });
    }

    // Auth headers from Knoxx
    const orgId = req.headers["x-knoxx-org-id"] as string || "";
    const tenantId = req.headers["x-knoxx-tenant-id"] as string || "";

    const ids: string[] = [];
    const now = new Date();

    for (const seg of segments) {
      const eventId = randomUUID();
      
      await upsertEvent(app.mongo.events, {
        id: eventId,
        ts: now,
        source: "mt",
        kind: "translation.segment",
        project: seg.project || seg.tenant_id || tenantId || "default",
        session: null,
        message: seg.document_id,
        role: null,
        author: null,
        model: seg.mt_model ?? null,
        tags: null,
        text: seg.translated_text,
        attachments: null,
        extra: {
          meta: {
            source_lang: seg.source_lang,
            target_lang: seg.target_lang,
            source_text: seg.source_text,
            mt_model: seg.mt_model,
            confidence: seg.confidence,
            status: "pending",
            segment_index: seg.segment_index,
          },
          tenant_id: seg.tenant_id || tenantId,
          org_id: seg.org_id || orgId,
          domain: seg.domain,
        },
      });

      ids.push(eventId);
    }

    return {
      ok: true,
      imported: ids.length,
      ids,
    };
  });
};
