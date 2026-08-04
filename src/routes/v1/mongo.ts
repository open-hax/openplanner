import type { FastifyPluginAsync } from "fastify";
import { listCollectionsResponse, queryCollectionResponse, sanitizeCollectionName } from "@open-hax/openplanner-sdk/mongo-browse";

/**
 * Raw MongoDB collection browsing and querying. Cores live in the SDK
 * (shared with direct-mongo consumers); this is the HTTP shell.
 *
 * NOTE: This plugin is registered with prefix `/mongo` under `/v1`.
 * So these handlers are mounted as:
 *   GET  /v1/mongo/collections
 *   POST /v1/mongo/query
 */
export const mongoRoutes: FastifyPluginAsync = async (app) => {
  app.get("/collections", async () => {
    return listCollectionsResponse({ mongo: app.mongo });
  });

  app.post("/query", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!sanitizeCollectionName(body.collection)) {
      return reply.status(400).send({ ok: false, error: "Invalid collection name" });
    }
    try {
      return await queryCollectionResponse({ mongo: app.mongo }, body);
    } catch (err: any) {
      return reply.status(400).send({ ok: false, error: err.message });
    }
  });
};
