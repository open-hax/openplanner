import type { FastifyPluginAsync, FastifyInstance } from "fastify";
import type { WithId, Collection } from "mongodb";
import type { GardenDocument, EventDocument } from "../../lib/mongodb.js";

interface PublicDocumentResponse {
  doc_id: string;
  title: string;
  content: string;
  language: string;
  source_path: string | null;
  domain: string | null;
  published_at: string | null;
  available_languages: string[];
  translations: { language: string; status: string }[];
}

interface DocExtra {
  title?: string;
  content?: string;
  domain?: string;
  language?: string;
  visibility?: string;
  source_path?: string;
  updated_at?: string;
  metadata?: {
    garden_publications?: Array<Record<string, unknown>>;
  };
}

function getAvailableLanguages(
  gardenLangs: string[],
  docLang: string,
  gardenPubs: Array<Record<string, unknown>>
): string[] {
  const langs = new Set<string>([docLang]);
  const thisPub = gardenPubs[0];
  if (thisPub?.translated_languages) {
    for (const lang of thisPub.translated_languages as string[]) {
      langs.add(lang);
    }
  }
  return Array.from(langs);
}

/**
 * Find a document by ID or path within a garden
 */
async function findDocumentByIdOrPath(
  eventsCollection: Collection<EventDocument>,
  garden_id: string,
  doc_id_or_path: string
): Promise<WithId<EventDocument> | null> {
  // First try exact doc_id match (UUID)
  let doc = await eventsCollection.findOne({
    _id: doc_id_or_path,
    kind: "docs",
    "extra.visibility": "public",
    "extra.metadata.garden_publications.garden_id": garden_id,
  });

  // If not found, try path-based lookup against source_path
  if (!doc) {
    // Normalize the path: handle variations like "getting-started", "/getting-started", "getting-started.md"
    const normalizedPath = doc_id_or_path.replace(/^\//, "").replace(/\.md$/, "");
    
    // Try to find document with matching source_path
    // Match patterns like: /docs/getting-started.md, getting-started.md, /getting-started, etc.
    doc = await eventsCollection.findOne({
      kind: "docs",
      "extra.visibility": "public",
      "extra.metadata.garden_publications.garden_id": garden_id,
      $or: [
        // Exact match on normalized path
        { "extra.source_path": `/${normalizedPath}.md` },
        { "extra.source_path": `${normalizedPath}.md` },
        { "extra.source_path": `/${normalizedPath}` },
        { "extra.source_path": normalizedPath },
        // Match filename at end of path
        { "extra.source_path": { $regex: `/${normalizedPath}\\.md$` } },
        { "extra.source_path": { $regex: `/${normalizedPath}$` } },
        // Match slug in metadata
        { "extra.metadata.slug": normalizedPath },
      ],
    });
  }

  return doc;
}

export const publicRoutes: FastifyPluginAsync = async (app) => {
  const gardens = app.mongo.gardens;
  const events = app.mongo.events;

  /**
   * GET /v1/public/gardens/:garden_id
   * Public endpoint for garden landing page (no auth required)
   */
  app.get("/public/gardens/:garden_id", async (req, reply) => {
    const garden_id = String((req.params as { garden_id: string }).garden_id);

    const garden = await gardens.findOne({ garden_id, status: "active" });
    if (!garden) {
      return reply.status(404).send({ error: "garden not found or inactive" });
    }

    // Get document count
    const documentsCount = await events.countDocuments({
      kind: "docs",
      "extra.visibility": "public",
      "extra.metadata.garden_publications.garden_id": garden_id,
    });

    return {
      garden: {
        garden_id: garden.garden_id,
        title: garden.title,
        description: garden.description,
        default_language: garden.default_language ?? "en",
      },
      languages: [garden.default_language ?? "en", ...(garden.target_languages ?? [])],
      stats: {
        documents_count: documentsCount,
      },
    };
  });

  /**
   * GET /v1/public/gardens/:garden_id/documents
   * Public documents in a garden (only visibility: public)
   */
  app.get("/public/gardens/:garden_id/documents", async (req, reply) => {
    const garden_id = String((req.params as { garden_id: string }).garden_id);
    const query = (req.query ?? {}) as Record<string, string | undefined>;

    const garden = await gardens.findOne({ garden_id, status: "active" });
    if (!garden) {
      return reply.status(404).send({ error: "garden not found or inactive" });
    }

    const language = query.language ?? garden.default_language ?? "en";
    const pathPrefix = query.path;
    const search = query.search;
    const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);
    const offset = parseInt(query.offset ?? "0", 10);

    // Build filter - only public documents
    const filter: Record<string, unknown> = {
      kind: "docs",
      "extra.visibility": "public",
      "extra.metadata.garden_publications.garden_id": garden_id,
    };

    if (pathPrefix) {
      filter["extra.source_path"] = { $regex: `^${pathPrefix}` };
    }

    // Text search if provided
    if (search && search.trim()) {
      filter["$text"] = { $search: search.trim() };
    }

    const total = await events.countDocuments(filter);
    const docs = await events
      .find(filter)
      .sort({ ts: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    const documents = docs.map((doc) => {
      const extra = (doc.extra ?? {}) as DocExtra;
      const metadata = extra.metadata ?? {};
      const gardenPubs = (metadata.garden_publications as Array<Record<string, unknown>>) ?? [];
      const thisPub = gardenPubs.find((p) => p.garden_id === garden_id) ?? {};
      const availableLanguages = getAvailableLanguages(
        garden.target_languages ?? [],
        extra.language ?? "en",
        gardenPubs
      );

      return {
        doc_id: doc._id,
        title: extra.title,
        language: extra.language,
        source_path: extra.source_path,
        domain: extra.domain,
        published_at: (thisPub.published_at as string) ?? null,
        available_languages: availableLanguages,
        translation_status: (thisPub.translation_status as string) ?? null,
      };
    });

    return {
      garden: {
        garden_id: garden.garden_id,
        title: garden.title,
        default_language: garden.default_language ?? "en",
      },
      requested_language: language,
      total,
      offset,
      limit,
      documents,
    };
  });

  /**
   * GET /v1/public/gardens/:garden_id/documents/:doc_id
   * Single document in a garden with language negotiation
   */
  app.get("/public/gardens/:garden_id/documents/:doc_id", async (req, reply) => {
    const garden_id = String((req.params as { garden_id: string }).garden_id);
    const doc_id_or_path = String((req.params as { doc_id: string }).doc_id);
    const query = (req.query ?? {}) as Record<string, string | undefined>;

    const garden = await gardens.findOne({ garden_id, status: "active" });
    if (!garden) {
      return reply.status(404).send({ error: "garden not found or inactive" });
    }

    const requestedLanguage = query.language ?? garden.default_language ?? "en";

    // Find the document by ID or path
    const doc = await findDocumentByIdOrPath(events, garden_id, doc_id_or_path);

    if (!doc) {
      return reply.status(404).send({ error: "document not found in this garden" });
    }

    const extra = (doc.extra ?? {}) as DocExtra;
    const metadata = extra.metadata ?? {};
    const gardenPubs = (metadata.garden_publications as Array<Record<string, unknown>>) ?? [];
    const thisPub = gardenPubs.find((p) => p.garden_id === garden_id) ?? {};
    const availableLanguages = getAvailableLanguages(
      garden.target_languages ?? [],
      extra.language ?? "en",
      gardenPubs
    );

    // Check if we need to serve a translation
    const docLanguage = extra.language ?? "en";
    let content = extra.content ?? "";
    let servedLanguage = docLanguage;

    if (requestedLanguage !== docLanguage && availableLanguages.includes(requestedLanguage)) {
      // Look for translation in translation_segments collection
      const translation = await app.mongo.db.collection("translation_segments").findOne({
        document_id: doc._id,
        garden_id,
        target_language: requestedLanguage,
        status: "approved",
      });

      if (translation && translation.translated_text) {
        content = translation.translated_text as string;
        servedLanguage = requestedLanguage;
      }
    }

    // Build translations metadata
    const translations: { language: string; status: string }[] = [];
    for (const lang of garden.target_languages ?? []) {
      const status = availableLanguages.includes(lang) ? "available" : "pending";
      translations.push({ language: lang, status });
    }

    const response: PublicDocumentResponse = {
      doc_id: String(doc._id),
      title: extra.title ?? "Untitled",
      content,
      language: servedLanguage,
      source_path: extra.source_path ?? null,
      domain: extra.domain ?? null,
      published_at: (thisPub.published_at as string) ?? null,
      available_languages: availableLanguages,
      translations,
    };

    return response;
  });

  /**
   * GET /v1/public/gardens/:garden_id/search
   * Full-text search within a garden
   */
  app.get("/public/gardens/:garden_id/search", async (req, reply) => {
    const garden_id = String((req.params as { garden_id: string }).garden_id);
    const query = (req.query ?? {}) as Record<string, string | undefined>;

    const garden = await gardens.findOne({ garden_id, status: "active" });
    if (!garden) {
      return reply.status(404).send({ error: "garden not found or inactive" });
    }

    const q = query.q ?? query.search;
    if (!q || !q.trim()) {
      return reply.status(400).send({ error: "search query required (q or search param)" });
    }

    const limit = Math.min(parseInt(query.limit ?? "20", 10), 50);
    const offset = parseInt(query.offset ?? "0", 10);

    const filter: Record<string, unknown> = {
      kind: "docs",
      "extra.visibility": "public",
      "extra.metadata.garden_publications.garden_id": garden_id,
      $text: { $search: q.trim() },
    };

    const total = await events.countDocuments(filter);
    const docs = await events
      .find(filter, {
        projection: {
          _id: 1,
          "extra.title": 1,
          "extra.source_path": 1,
          "extra.domain": 1,
          "extra.language": 1,
          "extra.metadata.garden_publications": 1,
          score: { $meta: "textScore" },
        },
      })
      .sort({ score: { $meta: "textScore" } })
      .skip(offset)
      .limit(limit)
      .toArray();

    const results = docs.map((doc) => {
      const extra = (doc.extra ?? {}) as DocExtra;
      const metadata = extra.metadata ?? {};
      const gardenPubs = (metadata.garden_publications as Array<Record<string, unknown>>) ?? [];
      const thisPub = gardenPubs.find((p) => p.garden_id === garden_id) ?? {};

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const score = (doc as any).score as number | undefined;

      return {
        doc_id: doc._id,
        title: extra.title,
        source_path: extra.source_path,
        domain: extra.domain,
        language: extra.language,
        published_at: (thisPub.published_at as string) ?? null,
        score,
      };
    });

    return {
      garden: {
        garden_id: garden.garden_id,
        title: garden.title,
      },
      query: q,
      total,
      offset,
      limit,
      results,
    };
  });

  /**
   * GET /v1/public/gardens/:garden_id/html
   * Render garden index page as themed HTML
   */
  app.get("/public/gardens/:garden_id/html", async (req, reply) => {
    const garden_id = String((req.params as { garden_id: string }).garden_id);

    const { renderGardenIndex } = await import("../../lib/garden-renderer.js");

    const garden = await gardens.findOne({ garden_id, status: "active" });
    if (!garden) {
      return reply.status(404).send({ error: "garden not found or inactive" });
    }

    // Get documents in this garden
    const docs = await events
      .find({
        kind: "docs",
        "extra.visibility": "public",
        "extra.metadata.garden_publications.garden_id": garden_id,
      })
      .sort({ ts: -1 })
      .limit(100)
      .toArray();

    const documents = docs.map((doc) => {
      const extra = (doc.extra ?? {}) as DocExtra;
      return {
        doc_id: doc._id,
        title: extra.title ?? "Untitled",
        source_path: extra.source_path,
        language: extra.language,
      };
    });

    const html = await renderGardenIndex(garden, documents, {
      fullDocument: true,
      includeNav: true,
      baseUrl: `/api/openplanner/v1/public/gardens/${garden_id}/html`,
    });

    reply.type("text/html; charset=utf-8");
    return html;
  });

  /**
   * GET /v1/public/gardens/:garden_id/html/:doc_id
   * Render single document as themed HTML
   * Supports both UUID doc_id and path-based lookups (e.g., /getting-started)
   */
  app.get("/public/gardens/:garden_id/html/:doc_id", async (req, reply) => {
    const garden_id = String((req.params as { garden_id: string }).garden_id);
    const doc_id_or_path = String((req.params as { doc_id: string }).doc_id);

    const { renderGardenPage } = await import("../../lib/garden-renderer.js");

    const garden = await gardens.findOne({ garden_id, status: "active" });
    if (!garden) {
      return reply.status(404).send({ error: "garden not found or inactive" });
    }

    // Find the document by ID or path
    const doc = await findDocumentByIdOrPath(events, garden_id, doc_id_or_path);

    if (!doc) {
      return reply.status(404).send({ error: "document not found in this garden" });
    }

    const extra = (doc.extra ?? {}) as DocExtra;

    const html = await renderGardenPage(
      garden,
      {
        title: extra.title ?? "Untitled",
        content: doc.text ?? extra.content ?? "",
        source_path: extra.source_path,
        language: extra.language,
      },
      {
        fullDocument: true,
        includeNav: true,
        baseUrl: `/api/openplanner/v1/public/gardens/${garden_id}/html`,
      }
    );

    reply.type("text/html; charset=utf-8");
    return html;
  });
};
