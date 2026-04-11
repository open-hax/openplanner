import type { FastifyPluginAsync } from "fastify";
import type { DocumentPatchRequest, DocumentRecord } from "../../lib/types.js";
import { documentToEvent, getDocumentById, persistAndMaybeIndex, rowToDocument } from "./documents.js";

type CmsDocument = {
  doc_id: string;
  tenant_id: string;
  title: string;
  content: string;
  visibility: "internal" | "review" | "public" | "archived";
  source: string;
  source_path: string | null;
  domain: string;
  language: string;
  created_by: string;
  published_by: string | null;
  published_at: string | null;
  last_reviewed_at: string | null;
  ai_drafted: boolean;
  ai_model: string | null;
  ai_prompt_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type CreateCmsDocumentPayload = {
  title?: string;
  content?: string;
  domain?: string;
  language?: string;
  source_path?: string | null;
  metadata?: Record<string, unknown>;
};

type DraftCmsPayload = {
  tenant_id?: string;
  topic?: string;
  tone?: string;
  audience?: string;
  source_collections?: string[];
  max_context_chunks?: number;
  metadata?: Record<string, unknown>;
};

function tenantProject(tenantId: string | undefined): string {
  const value = String(tenantId ?? "devel").trim();
  return value || "devel";
}

function toCmsDocument(document: DocumentRecord, tenantId?: string): CmsDocument {
  const project = tenantProject(tenantId ?? document.project);
  const ts = document.ts ?? new Date().toISOString();
  return {
    doc_id: document.id,
    tenant_id: project,
    title: document.title,
    content: document.content,
    visibility: document.visibility,
    source: document.source ?? "manual",
    source_path: document.sourcePath ?? null,
    domain: document.domain ?? "general",
    language: document.language ?? "en",
    created_by: document.createdBy ?? "unknown",
    published_by: document.publishedBy ?? null,
    published_at: document.publishedAt ?? null,
    last_reviewed_at: null,
    ai_drafted: Boolean(document.aiDrafted),
    ai_model: document.aiModel ?? null,
    ai_prompt_hash: document.aiPromptHash ?? null,
    metadata: document.metadata ?? {},
    created_at: ts,
    updated_at: ts,
  };
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function draftMarkdown(topic: string, tone: string, audience: string): string {
  return [
    `# ${topic || "Untitled draft"}`,
    "",
    `> Draft tone: ${tone || "professional"}`,
    `> Audience: ${audience || "general"}`,
    "",
    "## Summary",
    "",
    "Add the core message here.",
    "",
    "## Details",
    "",
    "- Key point 1",
    "- Key point 2",
    "- Key point 3",
    "",
    "## Notes",
    "",
    "Add source-backed notes, translation guidance, and publish metadata.",
    "",
  ].join("\n");
}

export const cmsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/cms/documents", async (req) => {
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const tenantId = tenantProject(query.tenant_id);
    const visibility = query.visibility;
    const domain = query.domain;
    const source = query.source;
    const gardenId = query.garden_id;
    const limit = Math.max(1, Math.min(500, Number(query.limit ?? 50)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    const filter: Record<string, unknown> = {
      kind: "docs",
      project: tenantId,
    };
    if (visibility) filter["extra.visibility"] = visibility;
    if (source) filter.source = source;
    if (domain) filter["extra.domain"] = domain;
    if (gardenId) filter["extra.metadata.garden_id"] = gardenId;

    const rows = await app.mongo.events.find(filter).sort({ ts: -1 }).limit(limit + offset).toArray();
    const documents = rows.map((row: Record<string, unknown>) => toCmsDocument(rowToDocument(row), tenantId));
    const paged = documents.slice(offset, offset + limit);

    return {
      documents: paged,
      total: documents.length,
      by_visibility: countBy(documents.map((doc) => doc.visibility)),
    };
  });

  app.get("/cms/documents/:id", async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const document = await getDocumentById(app, id);
    if (!document || document.kind !== "docs") {
      return reply.status(404).send({ detail: "Document not found" });
    }
    return toCmsDocument(document);
  });

  app.post<{ Body: CreateCmsDocumentPayload }>("/cms/documents", async (req, reply) => {
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const tenantId = tenantProject(query.tenant_id);
    const payload = req.body ?? {};
    const title = String(payload.title ?? "").trim();
    const content = String(payload.content ?? "").trim();

    if (!title || !content) {
      return reply.status(400).send({ detail: "title and content are required" });
    }

    const document: DocumentRecord = {
      id: crypto.randomUUID(),
      title,
      content,
      project: tenantId,
      kind: "docs",
      visibility: "internal",
      source: "manual",
      sourcePath: payload.source_path ?? undefined,
      domain: payload.domain ?? "general",
      language: payload.language ?? "en",
      createdBy: "openplanner-cms",
      metadata: payload.metadata ?? {},
      ts: new Date().toISOString(),
    };

    const result = await persistAndMaybeIndex(app, documentToEvent(document));
    if (result.warning) {
      return reply.status(503).send({ detail: result.warning, persisted: true, indexed: false });
    }
    return toCmsDocument(document, tenantId);
  });

  app.patch<{ Body: CreateCmsDocumentPayload }>("/cms/documents/:id", async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const existing = await getDocumentById(app, id);
    if (!existing || existing.kind !== "docs") {
      return reply.status(404).send({ detail: "Document not found" });
    }

    const payload = req.body ?? {};
    const next: DocumentRecord = {
      ...existing,
      title: payload.title ?? existing.title,
      content: payload.content ?? existing.content,
      sourcePath: payload.source_path ?? existing.sourcePath ?? undefined,
      domain: payload.domain ?? existing.domain ?? "general",
      language: payload.language ?? existing.language ?? "en",
      metadata: payload.metadata ?? existing.metadata ?? {},
      ts: new Date().toISOString(),
    };

    const result = await persistAndMaybeIndex(app, documentToEvent(next, existing));
    if (result.warning) {
      return reply.status(503).send({ detail: result.warning, persisted: true, indexed: false });
    }
    return toCmsDocument(next);
  });

  app.delete("/cms/documents/:id", async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const existing = await getDocumentById(app, id);
    if (!existing || existing.kind !== "docs") {
      return reply.status(404).send({ detail: "Document not found" });
    }

    const archived: DocumentRecord = {
      ...existing,
      visibility: "archived",
      ts: new Date().toISOString(),
    };

    const result = await persistAndMaybeIndex(app, documentToEvent(archived, existing));
    if (result.warning) {
      return reply.status(503).send({ detail: result.warning, persisted: true, indexed: false });
    }

    return { status: "archived", doc_id: id, indexed: result.indexed };
  });

  app.post<{ Body: DraftCmsPayload }>("/cms/draft", async (req) => {
    const payload = req.body ?? {};
    const tenantId = tenantProject(payload.tenant_id);
    const topic = String(payload.topic ?? "Untitled draft").trim() || "Untitled draft";
    const tone = String(payload.tone ?? "professional");
    const audience = String(payload.audience ?? "general");
    const metadata = {
      ...(payload.metadata ?? {}),
      draft_request: {
        tone,
        audience,
        source_collections: payload.source_collections ?? [tenantId],
        max_context_chunks: payload.max_context_chunks ?? 5,
      },
    };

    const document: DocumentRecord = {
      id: crypto.randomUUID(),
      title: `Draft: ${topic}`,
      content: draftMarkdown(topic, tone, audience),
      project: tenantId,
      kind: "docs",
      visibility: "internal",
      source: "ai-drafted",
      domain: "general",
      language: "en",
      createdBy: "openplanner-cms",
      aiDrafted: true,
      aiModel: null,
      metadata,
      ts: new Date().toISOString(),
    };

    await persistAndMaybeIndex(app, documentToEvent(document));
    return toCmsDocument(document, tenantId);
  });

  app.post("/cms/publish/:id", async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const existing = await getDocumentById(app, id);
    if (!existing || existing.kind !== "docs") {
      return reply.status(404).send({ detail: "Document not found" });
    }

    const metadata = existing.metadata ?? {};
    const gardenId = typeof metadata.garden_id === "string" ? metadata.garden_id.trim() : "";
    if (!gardenId) {
      return reply.status(400).send({ detail: "garden_id metadata is required before publishing" });
    }

    const published: DocumentRecord = {
      ...existing,
      visibility: "public",
      publishedAt: new Date().toISOString(),
      ts: new Date().toISOString(),
    };

    const result = await persistAndMaybeIndex(app, documentToEvent(published, existing));
    if (result.warning) {
      return reply.status(503).send({ detail: result.warning, persisted: true, indexed: false });
    }

    return { status: "published", doc_id: id, indexed: result.indexed, garden_id: gardenId };
  });

  app.post("/cms/archive/:id", async (req, reply) => {
    const id = String((req.params as { id: string }).id);
    const existing = await getDocumentById(app, id);
    if (!existing || existing.kind !== "docs") {
      return reply.status(404).send({ detail: "Document not found" });
    }

    const archived: DocumentRecord = {
      ...existing,
      visibility: "archived",
      ts: new Date().toISOString(),
    };

    const result = await persistAndMaybeIndex(app, documentToEvent(archived, existing));
    if (result.warning) {
      return reply.status(503).send({ detail: result.warning, persisted: true, indexed: false });
    }

    return { status: "archived", doc_id: id, indexed: result.indexed };
  });

  app.get("/cms/public", async (req) => {
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const tenantId = tenantProject(query.tenant_id);
    const limit = Math.max(1, Math.min(500, Number(query.limit ?? 50)));
    const offset = Math.max(0, Number(query.offset ?? 0));

    const rows = await app.mongo.events.find({
      kind: "docs",
      project: tenantId,
      "extra.visibility": "public",
    }).sort({ ts: -1 }).limit(limit + offset).toArray();

    const documents = rows.map((row: Record<string, unknown>) => toCmsDocument(rowToDocument(row), tenantId));
    const paged = documents.slice(offset, offset + limit);

    return {
      documents: paged,
      total: documents.length,
      by_visibility: countBy(documents.map((doc) => doc.visibility)),
    };
  });

  app.get("/cms/stats", async (req) => {
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const tenantId = tenantProject(query.tenant_id);

    const rows = await app.mongo.events.find({
      kind: "docs",
      project: tenantId,
    }).limit(1000).toArray();

    const documents = rows.map((row: Record<string, unknown>) => toCmsDocument(rowToDocument(row), tenantId));

    return {
      total: documents.length,
      by_visibility: countBy(documents.map((doc) => doc.visibility)),
      by_domain: countBy(documents.map((doc) => doc.domain || "general")),
    };
  });
};
