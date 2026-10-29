import type { FastifyPluginAsync } from "fastify";
import { ingestEvents } from "@open-hax/openplanner-sdk/ingest";
import { counterInc } from "../../lib/metrics.js";
import type { EventIngestRequest } from "../../lib/types.js";

export { shouldIndexEventHotVectors } from "@open-hax/openplanner-sdk/ingest";

// The ingest pipeline lives in the SDK so internal consumers (knoxx) run it
// in-process against mongo directly. This route is the HTTP shell for external
// clients: body validation, metrics, and Kafka fan-out stay here.
export const eventRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: EventIngestRequest }>("/events", async (req, reply) => {
    const body = req.body;
    if (!body || !Array.isArray(body.events)) return reply.status(400).send({ error: "expected { events: [...] }" });

    const result = await ingestEvents(
      { mongo: app.mongo, embeddingRuntime: (app as any).embeddingRuntime, log: app.log },
      body.events,
    );
    const { acceptedEvents, backgroundIndexing, ...response } = result;
    void backgroundIndexing;

    counterInc("openplanner_events_ingested_total", { backend: "mongodb" }, response.ids.length);
    for (const ev of body.events) {
      counterInc("openplanner_events_by_source", { source: ev.source, backend: "mongodb" });
      counterInc("openplanner_events_by_kind", { kind: ev.kind, backend: "mongodb" });
    }

    const kafkaPublish = app.kafkaEvents.publishRawEvents(acceptedEvents, { requestId: req.id });
    if (process.env.OPENPLANNER_KAFKA_PUBLISH_MODE === "await") {
      await kafkaPublish;
    } else {
      void kafkaPublish.catch((err) => {
        app.log.warn({ err, count: acceptedEvents.length }, "Detached kafka raw event publish rejected");
      });
    }

    return response;
  });
};
