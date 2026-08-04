import type { FastifyPluginAsync } from "fastify";
import { listSessionsResponse, getSessionResponse } from "@open-hax/openplanner-sdk/sessions-core";

// Session cores live in the SDK (shared with direct-mongo consumers); this
// route is the HTTP shell.
export const sessionRoutes: FastifyPluginAsync = async (app) => {
  app.get("/sessions", async (req: any) => {
    return listSessionsResponse({ mongo: app.mongo }, req.query ?? {});
  });

  app.get("/sessions/:sessionId", async (req: any, reply) => {
    const { sessionId } = req.params as any;
    if (!sessionId) {
      return reply.code(400).send({ ok: false, error: "sessionId required" });
    }
    return getSessionResponse({ mongo: app.mongo }, sessionId, req.query ?? {});
  });
};
