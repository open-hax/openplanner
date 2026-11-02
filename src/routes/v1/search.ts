import type { FastifyPluginAsync } from "fastify";
import { ftsSearchWithQuality, vectorSearchWithQuality } from "@open-hax/openplanner-sdk/search-core";
import type { FtsSearchRequest, VectorSearchRequest } from "../../lib/types.js";
import { openApiSchemas } from "./openapi.js";

// Search cores live in the SDK (shared with direct-mongo consumers); this
// route is the HTTP shell: request validation and OpenAPI schema wiring.
export const searchRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: FtsSearchRequest }>("/search/fts", async (req, reply) => {
    if (!req.body?.q || typeof req.body.q !== "string") {
      return reply.status(400).send({ error: "q is required" });
    }
    return ftsSearchWithQuality(
      { mongo: app.mongo, embeddingRuntime: (app as any).embeddingRuntime },
      req.body,
    );
  });

  app.post<{ Body: VectorSearchRequest }>("/search/vector", {
    schema: {
      body: openApiSchemas.vectorSearchRequestSchema,
      response: {
        200: openApiSchemas.vectorSearchResponseSchema,
      },
    },
  }, async (req, reply) => {
    if (!req.body?.q || typeof req.body.q !== "string") {
      return reply.status(400).send({ error: "q is required" });
    }
    return vectorSearchWithQuality(
      { mongo: app.mongo, embeddingRuntime: (app as any).embeddingRuntime },
      req.body,
    );
  });
};
