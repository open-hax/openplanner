/**
 * Event ingest pipeline, extracted from the REST API's POST /v1/events handler
 * so it can run in-process anywhere the SDK is embedded (the API server is one
 * consumer; knoxx's direct-mongo client is another). Metrics and Kafka
 * publishing are intentionally NOT here — they are API-server concerns layered
 * on by the route.
 */
import { createProtocols } from "./protocol-adapters.js";
import { upsertGraphEdges, upsertGraphNodeEmbeddings } from "./mongodb.js";
import type { MongoConnection } from "./mongodb.js";
import {
  derivedGraphNodeExtra,
  eventProjectionLabels,
  planEventGraphProjections,
  planHotEventProjection,
  toNullableString as norm,
  type DerivedGraphNodePlan,
  type GraphEdgePlan,
  type GraphEmbeddingInput,
} from "./embedding-text.js";
import { indexTextInMongoVectors } from "./mongo-vectors.js";
import type { EventEnvelopeV1 } from "./types.js";
import { eventMigrationState, OPENPLANNER_SCHEMA_TARGETS } from "./schema-versions.js";
import type { EmbeddingRuntime } from "./embedding-runtime.js";

export interface IngestLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface IngestContext {
  mongo: MongoConnection;
  embeddingRuntime: EmbeddingRuntime;
  log?: IngestLogger;
}

export interface IngestResult {
  ok: true;
  count: number;
  ids: string[];
  projectedGraphEdges: number;
  ftsEnabled: true;
  storageBackend: "mongodb";
  indexed: true;
  indexing: "queued" | "skipped";
  queuedEventVectors: number;
  queuedGraphNodeEmbeddings: number;
  /** Events that passed validation, for downstream fan-out (e.g. Kafka). */
  acceptedEvents: EventEnvelopeV1[];
  /**
   * Settles when detached vector/embedding work finishes. Callers that need
   * read-your-writes (tests, batch jobs) can await it; the API route does not.
   */
  backgroundIndexing: Promise<void>;
}

export { shouldIndexEventHotVectors } from "./embedding-text.js";

export function validateEvent(ev: EventEnvelopeV1) {
  if (!ev || ev.schema !== "openplanner.event.v1") throw new Error("event.schema must be openplanner.event.v1");
  if (!ev.id) throw new Error("event.id required");
  if (!ev.ts) throw new Error("event.ts required (ISO)");
  if (!ev.source) throw new Error("event.source required");
  if (!ev.kind) throw new Error("event.kind required");
}

function labelSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "label";
}

function graphLabelId(tenantId: string, label: string): string {
  return `label:${tenantId}:${labelSlug(label)}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const noopLogger: IngestLogger = { warn: () => {} };

export async function ingestEvents(ctx: IngestContext, events: EventEnvelopeV1[]): Promise<IngestResult> {
  const { mongo, embeddingRuntime } = ctx;
  const log = ctx.log ?? noopLogger;
  const protocols = createProtocols({ mongo });

  const ids: string[] = [];
  const acceptedEvents: EventEnvelopeV1[] = [];
  const eventVectorTasks: Array<Promise<void>> = [];
  const projectedGraphEdges: GraphEdgePlan[] = [];
  const graphNodeEmbeddingInputs = new Map<string, GraphEmbeddingInput>();

  const derivedGraphNodeOps: any[] = [];
  const graphLabelNodeOps: any[] = [];
  const derivedEventIds = new Set<string>();
  const queuedGraphLabelIds = new Set<string>();
  const now = new Date();

  const queueDerivedGraphNodeEvent = (params: DerivedGraphNodePlan): void => {
    if (derivedEventIds.has(params.id)) return;
    derivedEventIds.add(params.id);

    derivedGraphNodeOps.push({
      updateOne: {
        filter: { _id: params.id },
        update: {
          $set: {
            id: params.id,
            ts: params.ts,
            source: "openplanner-derive",
            kind: "graph.node",
            project: params.project ?? null,
            session: null,
            message: params.label,
            role: null,
            author: null,
            model: null,
            tags: null,
            text: "",
            attachments: null,
            extra: derivedGraphNodeExtra(params),
            schema_version: OPENPLANNER_SCHEMA_TARGETS.event,
            migration_state: eventMigrationState(now),
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    });
  };

  for (const ev of events) {
    validateEvent(ev);
    acceptedEvents.push(ev);

    const sr = ev.source_ref ?? {};
    const meta = ev.meta ?? {};
    const extra = (ev.extra as Record<string, unknown> | undefined) ?? {};
    const role = norm((meta as any).role);
    const author = norm((meta as any).author);
    const model = norm((meta as any).model);
    const tags = (meta as any).tags;
    const project = norm((sr as any).project);

    // Protocol-based event admission
    await protocols.eventAdmission.appendEvent({
      id: ev.id,
      ts: new Date(ev.ts),
      source: ev.source,
      kind: ev.kind,
      project,
      session: norm((sr as any).session),
      message: norm((sr as any).message),
      role,
      author,
      model,
      tags: tags ?? null,
      text: norm(ev.text ?? ""),
      attachments: ev.attachments ?? null,
      extra: ev.extra ?? null,
      schema_version: ev.schema_version,
      migration_state: ev.migration_state as any,
    });

    ids.push(ev.id);

    const labels = eventProjectionLabels(extra);
    for (const label of labels) {
      const tenantId = String((extra.openplanner_labels as any)?.tenant_id ?? (extra as any).tenant_id ?? "default").trim() || "default";
      const labelId = graphLabelId(tenantId, label);
      if (!queuedGraphLabelIds.has(labelId)) {
        queuedGraphLabelIds.add(labelId);
        graphLabelNodeOps.push({
          updateOne: {
            filter: { label_id: labelId },
            update: {
              $set: {
                _id: labelId,
                label_id: labelId,
                label,
                emoji: null,
                description: `Auto-derived event label: ${label}`,
                color: null,
                tenant_id: tenantId,
                project,
                embedding_model: null,
                embedding_dimensions: 0,
                embedding: null,
                created_by: "event-ingest",
                updatedAt: now,
              },
              $setOnInsert: { createdAt: now },
            },
            upsert: true,
          },
        });
      }

      projectedGraphEdges.push({
        source_node_id: ev.id,
        target_node_id: labelId,
        edge_kind: "has_label",
        layer: null,
        project,
        source: ev.source,
        data: {
          applied_at: new Date(ev.ts).toISOString(),
          confidence: 1,
          label,
          claim_system: (extra.openplanner_labels as any)?.claim_system ?? null,
          source_event_id: ev.id,
        },
        updated_at: new Date(ev.ts),
      });
    }

    if (ev.kind === "graph.edge") {
      const sourceNodeId = norm(extra.source_node_id)?.trim() ?? "";
      const targetNodeId = norm(extra.target_node_id)?.trim() ?? "";
      const edgeKind = (norm(extra.edge_type) ?? norm(extra.edge_kind) ?? "").trim();
      if (sourceNodeId && targetNodeId && edgeKind && sourceNodeId !== targetNodeId) {
        projectedGraphEdges.push({
          source_node_id: sourceNodeId,
          target_node_id: targetNodeId,
          edge_kind: edgeKind,
          layer: norm(extra.layer),
          project,
          source: ev.source,
          data: extra,
          updated_at: new Date(ev.ts),
        });
      }
    }

    const projections = planEventGraphProjections(ev);
    for (const node of projections.derivedGraphNodes) queueDerivedGraphNodeEvent(node);
    for (const edge of projections.projectedGraphEdges) projectedGraphEdges.push(edge);
    for (const input of projections.graph) graphNodeEmbeddingInputs.set(input.node_id, input);

    const hotInput = planHotEventProjection(ev, labels);
    if (hotInput) {
      eventVectorTasks.push((async () => {
        try {
          const embeddingFunction = embeddingRuntime.hot.getBackgroundEmbeddingFunction(hotInput.scope);
          const embeddingModel = embeddingRuntime.hot.getModel(hotInput.scope);
          await withTimeout(indexTextInMongoVectors({
            mongo,
            tier: "hot",
            parentId: hotInput.parentId,
            text: hotInput.text,
            extra: hotInput.extra,
            metadata: { ...hotInput.metadata, embedding_model: embeddingModel ?? "" },
            embeddingFunction,
          }), 30_000, `event vector index ${ev.id}`);
        } catch (err) {
          log.warn({ err, eventId: ev.id }, "Failed to index event into MongoDB vectors; preserving base event without embeddings");
        }
      })());
    }
  }

  if (derivedGraphNodeOps.length > 0) {
    const batchSize = 1000;
    for (let i = 0; i < derivedGraphNodeOps.length; i += batchSize) {
      await mongo.events.bulkWrite(derivedGraphNodeOps.slice(i, i + batchSize), { ordered: false });
    }
  }

  if (graphLabelNodeOps.length > 0) {
    const batchSize = 1000;
    for (let i = 0; i < graphLabelNodeOps.length; i += batchSize) {
      await mongo.graphLabelNodes.bulkWrite(graphLabelNodeOps.slice(i, i + batchSize), { ordered: false });
    }
  }

  if (projectedGraphEdges.length > 0) {
    await upsertGraphEdges(mongo.graphEdges, projectedGraphEdges);
  }

  const graphNodeEmbeddingTask = graphNodeEmbeddingInputs.size > 0
    ? (async () => {
        try {
          const groupedByModel = new Map<string, GraphEmbeddingInput[]>();

          for (const input of graphNodeEmbeddingInputs.values()) {
            const model = embeddingRuntime.hot.getModel({
              source: "graph-event",
              kind: "graph.node",
              project: input.project ?? undefined,
            });
            const rows = groupedByModel.get(model) ?? [];
            rows.push(input);
            groupedByModel.set(model, rows);
          }

          for (const [model, rows] of groupedByModel) {
            const embeddingFunction = embeddingRuntime.hot.getBackgroundEmbeddingFunctionForModel(model);
            const nodeIds = rows.map((row) => row.node_id);
            const existing = await mongo.graphNodeEmbeddings
              .find({ node_id: { $in: nodeIds }, embedding_model: model })
              .project({ node_id: 1, text: 1 })
              .toArray();
            const existingTextById = new Map(existing.map((row: any) => [String(row.node_id), String(row.text ?? "")] as const));

            const toEmbed = rows.filter((row) => {
              const previous = existingTextById.get(row.node_id);
              return !previous || previous !== row.text;
            });

            if (toEmbed.length === 0) continue;

            const embeddings = await withTimeout(
              embeddingFunction.generate(toEmbed.map((row) => row.text)) as Promise<number[][]>,
              30_000,
              `graph node embedding batch ${model}`,
            );

            const storedRows = toEmbed.flatMap((row, idx) => {
              const embedding = embeddings[idx];
              if (!Array.isArray(embedding) || embedding.length === 0) return [];
              return [{
                node_id: row.node_id,
                source_event_id: row.source_event_id,
                project: row.project ?? null,
                embedding_model: model,
                embedding_dimensions: embedding.length,
                embedding,
                chunk_count: row.chunk_count ?? 1,
                text: row.text,
                updated_at: new Date(),
              }];
            });

            if (storedRows.length > 0) {
              await upsertGraphNodeEmbeddings(mongo.graphNodeEmbeddings, storedRows);
            }
          }
        } catch (err) {
          log.warn({ err, count: graphNodeEmbeddingInputs.size }, "Failed to materialize graph node embeddings during event ingest");
        }
      })()
    : Promise.resolve();

  const eventVectorsTask = eventVectorTasks.length > 0
    ? Promise.allSettled(eventVectorTasks).then((results) => {
        const rejected = results.filter((result) => result.status === "rejected").length;
        if (rejected > 0) {
          log.warn({ rejected, queued: eventVectorTasks.length }, "Detached event vector indexing completed with rejected tasks");
        }
      })
    : Promise.resolve();

  const backgroundIndexing = Promise.all([graphNodeEmbeddingTask, eventVectorsTask]).then(() => undefined);
  // Detached by default, mirroring the original route behavior.
  void backgroundIndexing;

  return {
    ok: true,
    count: ids.length,
    ids,
    projectedGraphEdges: projectedGraphEdges.length,
    ftsEnabled: true,
    storageBackend: "mongodb",
    indexed: true,
    indexing: eventVectorTasks.length > 0 || graphNodeEmbeddingInputs.size > 0 ? "queued" : "skipped",
    queuedEventVectors: eventVectorTasks.length,
    queuedGraphNodeEmbeddings: graphNodeEmbeddingInputs.size,
    acceptedEvents,
    backgroundIndexing,
  };
}
