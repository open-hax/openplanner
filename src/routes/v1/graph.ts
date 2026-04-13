import type { FastifyPluginAsync } from "fastify";
import { upsertGraphLayoutOverrides, upsertGraphNodeEmbeddings, upsertGraphSemanticEdges, upsertGraphEdges } from "../../lib/mongodb.js";
import { queryMongoVectorsByText } from "../../lib/mongo-vectors.js";
import { extractTieredVectorHits } from "../../lib/vector-search.js";

// Simplified graph routes for MongoDB-only backend
// Full graph functionality requires additional implementation

type ExportNode = {
  id: string;
  kind: string;
  label: string;
  lake?: string;
  nodeType?: string;
  data?: Record<string, unknown>;
  x?: number;
  y?: number;
};

type ExportEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  lake?: string;
  edgeType?: string;
  sourceLake?: string;
  targetLake?: string;
  data?: Record<string, unknown>;
};

type ViewNode = {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  dataJson: string | null;
};

type ViewEdge = {
  source: string;
  target: string;
  kind: string;
  dataJson: string | null;
};

function inferViewNodeFromId(nodeId: string, position: { x: number; y: number }): ViewNode {
  const [lake = "misc", kind = "node", ...restParts] = String(nodeId).split(":");
  const rest = restParts.join(":");

  const label = (() => {
    if (kind === "file") {
      const parts = rest.split("/").filter(Boolean);
      return parts[parts.length - 1] ?? nodeId;
    }
    if (kind === "url") {
      try {
        const url = new URL(rest);
        return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
      } catch {
        return rest || nodeId;
      }
    }
    return rest || nodeId;
  })();

  const data: Record<string, unknown> = { lake };
  if (kind === "file") data.path = rest;
  if (kind === "url") data.url = rest;
  if (kind === "dep") data.dep = rest;

  return {
    id: nodeId,
    kind,
    label,
    x: position.x,
    y: position.y,
    dataJson: JSON.stringify(data),
  };
}

function positiveMod(value: number, mod: number): number {
  if (mod <= 0) return 0;
  return ((value % mod) + mod) % mod;
}

function selectWindowOffset(params: {
  totalRows: number;
  windowSize: number;
  shardIndex: number;
  shardCount: number;
  rotationCursor: number;
}): number {
  const { totalRows, windowSize, shardIndex, shardCount, rotationCursor } = params;
  if (totalRows <= windowSize) return 0;

  const availableStarts = Math.max(1, totalRows - windowSize + 1);
  const shardStride = Math.max(1, windowSize);
  const shardSlot = (rotationCursor * shardCount) + shardIndex;
  const slotStart = positiveMod(shardSlot * shardStride, availableStarts);
  return Math.min(totalRows - windowSize, slotStart);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesNodeType(nodeId: string, nodeTypes: string[] | null): boolean {
  if (!nodeTypes || nodeTypes.length === 0) return true;
  return nodeTypes.some((nodeType) => nodeId.includes(`:${nodeType}:`) || nodeId.endsWith(`:${nodeType}`));
}

export const graphRoutes: FastifyPluginAsync = async (app) => {
  const graphViewCache = new Map<string, { expiresAt: number; value: unknown }>();
  const graphViewCacheTtlMs = 15_000;

  // Graph export for multi-lake graph weaving
  app.get("/graph/export", async (req: any, reply) => {
    const projectsParam = typeof req.query?.projects === "string" ? req.query.projects.trim() : "";
    const includeLayout = req.query?.includeLayout === "true" || req.query?.includeLayout === true;
    const includeSemantic = req.query?.includeSemantic === "true" || req.query?.includeSemantic === true;
    const semanticMinSimilarity = Math.max(0, Math.min(1, Number(req.query?.semanticMinSimilarity ?? 0.7)));

    const projects = projectsParam ? projectsParam.split(",").map((p: string) => p.trim()).filter(Boolean) : [];
    const projectFilter = projects.length > 0 ? { project: { $in: [...projects, null] } } : {};
    const nodeProjectFilter = projects.length > 0 ? { project: { $in: projects } } : {};

    const nodeProjection = {
      "extra.node_id": 1, "extra.node_kind": 1, "extra.label": 1,
      "extra.path": 1, "extra.url": 1, "extra.lake": 1, "extra.node_type": 1,
      "extra.content_hash": 1, "extra.preview": 1, "extra.entity_key": 1,
      project: 1, message: 1,
    };

    const [nodeDocs, edgeDocs, layoutRows, semanticEdgeDocs] = await Promise.all([
      app.mongo.events.find({ kind: "graph.node", ...nodeProjectFilter }, { projection: nodeProjection }).toArray(),
      app.mongo.graphEdges.find(projectFilter).toArray(),
      includeLayout ? app.mongo.graphLayoutOverrides.find(nodeProjectFilter).toArray() : Promise.resolve([]),
      includeSemantic ? app.mongo.graphSemanticEdges.find({ similarity: { $gte: semanticMinSimilarity } }).toArray() : Promise.resolve([]),
    ]) as [any[], any[], any[], any[]];

    const layoutById = new Map<string, { x: number; y: number }>();
    for (const row of layoutRows) {
      if (typeof row.node_id === "string" && typeof row.x === "number" && typeof row.y === "number") {
        layoutById.set(row.node_id, { x: row.x, y: row.y });
      }
    }

    const nodeIds = new Set<string>();
    const nodes: ExportNode[] = nodeDocs.map((doc: any) => {
      const extra = doc.extra ?? {};
      const nodeId = extra.node_id ?? doc.message ?? doc._id;
      nodeIds.add(nodeId);
      const layout = layoutById.get(nodeId);

      const rawLabel = extra.label ?? extra.path ?? doc.message ?? "";
      const preview = typeof extra.preview === "string" ? extra.preview : "";
      let label = rawLabel;
      if (!label && preview) {
        label = preview.length > 80 ? preview.slice(0, 77) + "..." : preview;
      }
      if (!label) {
        const parts = nodeId.split(":");
        label = parts.length > 2 ? parts.slice(2).join(":").slice(0, 60) : nodeId.slice(0, 60);
      }

      return {
        id: nodeId,
        kind: extra.node_kind ?? "unknown",
        label,
        lake: extra.lake ?? doc.project,
        nodeType: extra.node_type,
        data: {
          path: extra.path,
          url: extra.url,
          content_hash: extra.content_hash,
          preview: extra.preview,
          entity_key: extra.entity_key,
        },
        ...(layout ? { x: layout.x, y: layout.y } : {}),
      };
    });

    const edges: ExportEdge[] = edgeDocs.map((doc: any) => {
      const src = doc.source_node_id ?? "";
      const tgt = doc.target_node_id ?? "";
      const data = doc.data ?? {};
      const edgeKind = doc.edge_kind ?? data.edge_type ?? "unknown";
      return {
        id: doc._id,
        source: src,
        target: tgt,
        kind: edgeKind,
        lake: data.lake ?? doc.project,
        edgeType: data.edge_type ?? edgeKind,
        sourceLake: data.source_lake,
        targetLake: data.target_lake,
        data: {
          source: data.source,
          target: data.target,
          source_host: data.source_host,
          target_host: data.target_host,
          discovery_channel: data.discovery_channel,
          anchor_text: data.anchor_text,
        },
      };
    }).filter((e: ExportEdge) => e.source && e.target);

    if (includeSemantic && semanticEdgeDocs.length > 0) {
      for (const doc of semanticEdgeDocs) {
        const src = doc.source_node_id ?? "";
        const tgt = doc.target_node_id ?? "";
        if (!src || !tgt) continue;
        if (!nodeIds.has(src) || !nodeIds.has(tgt)) continue;
        const edgeKind = doc.edge_type === "semantic_knn" ? "semantic_knn" : "semantic_similarity";
        edges.push({
          id: `${src}||${tgt}:${edgeKind}`,
          source: src,
          target: tgt,
          kind: edgeKind,
          lake: "semantic",
          edgeType: edgeKind,
          data: {
            similarity: doc.similarity,
            embedding_model: doc.embedding_model,
            source: doc.source,
          },
        });
      }
    }

    return { ok: true, nodes, edges };
  });

  // Graph layout upsert endpoint
  app.post("/graph/layout/upsert", async (req: any, reply) => {
    const source = req.body?.source ?? "graph-weaver";
    const layoutVersion = req.body?.layoutVersion ?? "v1";
    const inputs = Array.isArray(req.body?.inputs) ? req.body.inputs : [];
    
    if (inputs.length === 0) {
      return { ok: true, stored: 0 };
    }

    const rows = inputs.map((input: any) => ({
      node_id: String(input.id),
      x: Number(input.x ?? 0),
      y: Number(input.y ?? 0),
      layout_source: source,
      layout_version: layoutVersion,
      updated_at: new Date(),
    }));

    const stored = await upsertGraphLayoutOverrides(app.mongo.graphLayoutOverrides, rows);
    return { ok: true, stored };
  });

  // Graph layout endpoints
  app.post("/graph/layout", async (req: any, reply) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      return reply.status(400).send({ error: "rows array required" });
    }

    const count = await upsertGraphLayoutOverrides(app.mongo.graphLayoutOverrides, rows.map((row: any) => ({
      node_id: String(row.node_id ?? row.id),
      project: row.project,
      x: Number(row.x ?? 0),
      y: Number(row.y ?? 0),
      layout_source: row.layout_source,
      layout_version: row.layout_version,
      updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
    })));

    return { ok: true, upserted: count };
  });

  app.get("/graph/layout", async (req: any) => {
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : undefined;
    const filter: Record<string, unknown> = {};
    if (project) filter.project = project;
    
    const rows = await app.mongo.graphLayoutOverrides.find(filter).sort({ updated_at: -1 }).limit(10000).toArray();
    return { ok: true, count: rows.length, rows };
  });

  // Graph node embeddings
  app.post("/graph/embeddings", async (req: any, reply) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (rows.length === 0) {
      return reply.status(400).send({ error: "rows array required" });
    }

    const count = await upsertGraphNodeEmbeddings(app.mongo.graphNodeEmbeddings, rows.map((row: any) => ({
      node_id: String(row.node_id ?? row.id),
      source_event_id: String(row.source_event_id ?? row.node_id),
      project: row.project,
      embedding_model: row.embedding_model,
      embedding_dimensions: Number(row.embedding_dimensions ?? (Array.isArray(row.embedding) ? row.embedding.length : 0)),
      embedding: Array.isArray(row.embedding) ? row.embedding : [],
      chunk_count: Number(row.chunk_count ?? 1),
      updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
    })));

    return { ok: true, upserted: count };
  });

  app.get("/graph/embeddings", async (req: any) => {
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : undefined;
    const filter: Record<string, unknown> = {};
    if (project) filter.project = project;
    
    const rows = await app.mongo.graphNodeEmbeddings.find(filter).sort({ updated_at: -1 }).limit(10000).toArray();
    return { ok: true, count: rows.length, rows };
  });

  // Graph stats
  app.get("/graph/stats", async () => {
    const nodeCount = await app.mongo.events.countDocuments({ kind: "graph.node" });
    const edgeCount = await app.mongo.events.countDocuments({ kind: "graph.edge" });
    return {
      ok: true,
      nodeCount,
      edgeCount,
      storageBackend: "mongodb",
    };
  });

  app.post("/graph/view", async (req: any, reply) => {
    const maxNodes = Math.max(50, Math.min(20000, Number(req.body?.maxNodes ?? 6000)));
    const maxEdges = Math.max(50, Math.min(100000, Number(req.body?.maxEdges ?? 12000)));
    const poolMultiplier = Math.max(2, Math.min(8, Number(req.body?.poolMultiplier ?? 3)));
    const poolLimit = Math.max(maxNodes, Math.min(50000, Math.floor(req.body?.poolLimit ?? (maxNodes * poolMultiplier))));
    const componentCount = Math.max(1, Math.min(16, Number(req.body?.componentCount ?? 6)));
    const shardCount = Math.max(1, Math.min(64, Number(req.body?.shardCount ?? 1)));
    const shardIndex = positiveMod(Number(req.body?.shardIndex ?? 0), shardCount);
    const rotationCursor = Math.max(0, Math.floor(Number(req.body?.rotationCursor ?? 0)));
    const requestedSeedNodeIds = Array.isArray(req.body?.seedNodeIds)
      ? req.body.seedNodeIds.map(String).filter(Boolean)
      : [];
    const project = typeof req.body?.project === "string" ? req.body.project.trim() : "";
    const minTargetNodes = Math.min(maxNodes, Math.max(1000, Math.floor(maxNodes * 0.75)));
    const maxAdaptivePoolLimit = Math.max(poolLimit, Math.min(50000, poolLimit * 4));
    const cacheKey = JSON.stringify({
      maxNodes,
      maxEdges,
      poolLimit,
      componentCount,
      shardIndex,
      shardCount,
      rotationCursor,
      project,
      seeds: requestedSeedNodeIds.slice(0, 8),
    });
    const cachedView = graphViewCache.get(cacheKey);
    if (cachedView && cachedView.expiresAt > Date.now()) {
      return cachedView.value;
    }

    const projectFilter = project ? { project } : {};
    const [totalLayoutRows, totalNodes, totalEdges] = await Promise.all([
      app.mongo.graphLayoutOverrides.countDocuments(projectFilter),
      app.mongo.events.countDocuments({ kind: "graph.node", ...(project ? { project } : {}) }),
      app.mongo.graphEdges.countDocuments(project ? { project } : {}),
    ]);
    const buildViewForPoolLimit = async (activePoolLimit: number, activeRotationCursor: number) => {
      const recentPoolLimit = Math.max(1, Math.floor(activePoolLimit / 2));
      const stalePoolLimit = Math.max(1, activePoolLimit - recentPoolLimit);
      const effectiveComponentCount = Math.min(24, componentCount * Math.max(1, Math.floor(activePoolLimit / Math.max(1, poolLimit))));

      const recentOffset = selectWindowOffset({
        totalRows: totalLayoutRows,
        windowSize: recentPoolLimit,
        shardIndex,
        shardCount,
        rotationCursor: activeRotationCursor,
      });
      const staleOffset = selectWindowOffset({
        totalRows: totalLayoutRows,
        windowSize: stalePoolLimit,
        shardIndex,
        shardCount,
        rotationCursor: activeRotationCursor + 17,
      });
      const [recentLayoutRows, staleLayoutRows] = await Promise.all([
        app.mongo.graphLayoutOverrides.find(projectFilter).sort({ updated_at: -1 as any }).skip(recentOffset).limit(recentPoolLimit).toArray(),
        app.mongo.graphLayoutOverrides.find(projectFilter).sort({ updated_at: 1 as any }).skip(staleOffset).limit(stalePoolLimit).toArray(),
      ]);

      const layoutRows = [...staleLayoutRows, ...recentLayoutRows];
      if (layoutRows.length === 0) {
        return {
          ok: true,
          nodes: [],
          edges: [],
          meta: {
            totalNodes,
            totalEdges,
            sampledNodes: totalNodes > 0,
            sampledEdges: totalEdges > 0,
            shardIndex,
            shardCount,
            rotationCursor,
            rotationCursorUsed: activeRotationCursor,
            poolLimitUsed: activePoolLimit,
          },
        };
      }

      const candidateNodeIds = [...new Set([
        ...requestedSeedNodeIds,
        ...layoutRows.map((row) => String(row.node_id)).filter(Boolean),
      ])];
      const layoutById = new Map<string, { x: number; y: number }>();
      for (const row of layoutRows) {
        if (typeof row.node_id === "string" && typeof row.x === "number" && typeof row.y === "number") {
          layoutById.set(row.node_id, { x: row.x, y: row.y });
        }
      }

      const staleCandidateIds = [...new Set(staleLayoutRows.map((row) => String(row.node_id)).filter(Boolean))];
      const recentCandidateIds = [...new Set(recentLayoutRows.map((row) => String(row.node_id)).filter(Boolean))];

      const edgeFilter: Record<string, unknown> = {
        source_node_id: { $in: candidateNodeIds },
        target_node_id: { $in: candidateNodeIds },
        ...(project ? { project } : {}),
      };
      const candidateEdges = await app.mongo.graphEdges
        .find(edgeFilter, {
          projection: { source_node_id: 1, target_node_id: 1, edge_kind: 1, data: 1, updated_at: 1 },
        })
        .limit(Math.max(maxEdges * 8, 50000))
        .toArray();

      if (candidateEdges.length === 0) {
        const nodes = candidateNodeIds.slice(0, maxNodes).map((nodeId) => inferViewNodeFromId(nodeId, layoutById.get(nodeId) ?? { x: 0, y: 0 }));
        return {
          ok: true,
          nodes,
          edges: [],
          meta: {
            totalNodes,
            totalEdges,
            sampledNodes: nodes.length < totalNodes,
            sampledEdges: totalEdges > 0,
            shardIndex,
            shardCount,
            rotationCursor,
            rotationCursorUsed: activeRotationCursor,
            poolLimitUsed: activePoolLimit,
          },
        };
      }

      const adjacency = new Map<string, Array<{ neighbor: string; edgeIndex: number }>>();
      const degree = new Map<string, number>();
      for (let i = 0; i < candidateEdges.length; i += 1) {
        const edge = candidateEdges[i]!;
        const sourceId = String(edge.source_node_id);
        const targetId = String(edge.target_node_id);
        if (!sourceId || !targetId || sourceId === targetId) continue;

        const sourceNeighbors = adjacency.get(sourceId) ?? [];
        sourceNeighbors.push({ neighbor: targetId, edgeIndex: i });
        adjacency.set(sourceId, sourceNeighbors);

        const targetNeighbors = adjacency.get(targetId) ?? [];
        targetNeighbors.push({ neighbor: sourceId, edgeIndex: i });
        adjacency.set(targetId, targetNeighbors);

        degree.set(sourceId, (degree.get(sourceId) ?? 0) + 1);
        degree.set(targetId, (degree.get(targetId) ?? 0) + 1);
      }

      const connectedSeeds = requestedSeedNodeIds.filter((nodeId: string) => adjacency.has(nodeId));
      const rankCandidates = (nodeIds: string[]): string[] => nodeIds
        .filter((nodeId) => adjacency.has(nodeId))
        .sort((left, right) => (degree.get(right) ?? 0) - (degree.get(left) ?? 0));

      const staleRankedSeeds = rankCandidates(staleCandidateIds);
      const recentRankedSeeds = rankCandidates(recentCandidateIds);
      const fallbackRankedSeeds = rankCandidates(candidateNodeIds);

      const seedNodeIds: string[] = [];
      const seedExclusion = new Set<string>();
      const tryAddSeed = (nodeId: string | undefined): boolean => {
        if (!nodeId || seedExclusion.has(nodeId) || !adjacency.has(nodeId)) return false;
        seedNodeIds.push(nodeId);
        seedExclusion.add(nodeId);
        for (const neighbor of adjacency.get(nodeId) ?? []) {
          seedExclusion.add(neighbor.neighbor);
        }
        return true;
      };

      for (const nodeId of connectedSeeds) {
        if (seedNodeIds.length >= effectiveComponentCount) break;
        tryAddSeed(nodeId);
      }

      let staleIndex = 0;
      let recentIndex = 0;
      while (seedNodeIds.length < effectiveComponentCount) {
        const addedStale = tryAddSeed(staleRankedSeeds[staleIndex]);
        if (staleIndex < staleRankedSeeds.length) staleIndex += 1;
        if (seedNodeIds.length >= effectiveComponentCount) break;
        const addedRecent = tryAddSeed(recentRankedSeeds[recentIndex]);
        if (recentIndex < recentRankedSeeds.length) recentIndex += 1;
        if (!addedStale && !addedRecent && staleIndex >= staleRankedSeeds.length && recentIndex >= recentRankedSeeds.length) {
          break;
        }
      }

      for (const nodeId of fallbackRankedSeeds) {
        if (seedNodeIds.length >= effectiveComponentCount) break;
        tryAddSeed(nodeId);
      }

      if (seedNodeIds.length === 0 && candidateNodeIds.length > 0) {
        seedNodeIds.push(candidateNodeIds[0]!);
      }

      const selectedNodeIds = new Set<string>();
      const selectedEdgeIndexes = new Set<number>();
      const queue: string[] = [...seedNodeIds];

      while (queue.length > 0 && selectedNodeIds.size < maxNodes) {
        const current = queue.shift()!;
        if (selectedNodeIds.has(current)) continue;
        selectedNodeIds.add(current);

        const neighbors = [...(adjacency.get(current) ?? [])]
          .sort((left, right) => (degree.get(right.neighbor) ?? 0) - (degree.get(left.neighbor) ?? 0));

        for (const neighbor of neighbors) {
          if (selectedNodeIds.size < maxNodes) {
            selectedEdgeIndexes.add(neighbor.edgeIndex);
            if (!selectedNodeIds.has(neighbor.neighbor)) queue.push(neighbor.neighbor);
          }
        }
      }

      const treeEdges = [...selectedEdgeIndexes]
        .map((edgeIndex) => candidateEdges[edgeIndex])
        .filter((edge): edge is NonNullable<typeof edge> => !!edge)
        .filter((edge) => selectedNodeIds.has(String(edge.source_node_id)) && selectedNodeIds.has(String(edge.target_node_id)));

      const seenEdgeKeys = new Set(treeEdges.map((edge) => `${edge.edge_kind}::${edge.source_node_id}::${edge.target_node_id}`));
      const extraEdges = candidateEdges
        .filter((edge) => selectedNodeIds.has(String(edge.source_node_id)) && selectedNodeIds.has(String(edge.target_node_id)))
        .filter((edge) => !seenEdgeKeys.has(`${edge.edge_kind}::${edge.source_node_id}::${edge.target_node_id}`))
        .sort((left, right) => {
          const leftScore = (degree.get(String(left.source_node_id)) ?? 0) + (degree.get(String(left.target_node_id)) ?? 0);
          const rightScore = (degree.get(String(right.source_node_id)) ?? 0) + (degree.get(String(right.target_node_id)) ?? 0);
          return rightScore - leftScore;
        });

      const selectedEdges = [...treeEdges, ...extraEdges].slice(0, maxEdges);
      const selectedNodes = [...selectedNodeIds]
        .map((nodeId) => inferViewNodeFromId(nodeId, layoutById.get(nodeId) ?? { x: 0, y: 0 }));
      const edges: ViewEdge[] = selectedEdges.map((edge) => ({
        source: String(edge.source_node_id),
        target: String(edge.target_node_id),
        kind: String(edge.edge_kind),
        dataJson: edge.data ? JSON.stringify(edge.data) : null,
      }));

      return {
        ok: true,
        nodes: selectedNodes,
        edges,
        meta: {
          totalNodes,
          totalEdges,
          sampledNodes: selectedNodes.length < totalNodes,
          sampledEdges: edges.length < totalEdges,
          shardIndex,
          shardCount,
          rotationCursor,
          rotationCursorUsed: activeRotationCursor,
          poolLimitUsed: activePoolLimit,
        },
      };
    };

    const buildAdaptiveViewForCursor = async (activeRotationCursor: number) => {
      let activePoolLimit = poolLimit;
      let response = await buildViewForPoolLimit(activePoolLimit, activeRotationCursor);
      while (response.nodes.length < minTargetNodes && activePoolLimit < maxAdaptivePoolLimit) {
        activePoolLimit = Math.min(maxAdaptivePoolLimit, activePoolLimit * 2);
        response = await buildViewForPoolLimit(activePoolLimit, activeRotationCursor);
      }
      return response;
    };

    let response = await buildAdaptiveViewForCursor(rotationCursor);
    let bestResponse = response;
    for (let cursorOffset = 1; cursorOffset <= 3 && bestResponse.nodes.length < minTargetNodes; cursorOffset += 1) {
      const candidateResponse = await buildAdaptiveViewForCursor(rotationCursor + cursorOffset);
      if (candidateResponse.nodes.length > bestResponse.nodes.length) {
        bestResponse = candidateResponse;
      }
    }

    response = bestResponse;

    graphViewCache.set(cacheKey, { expiresAt: Date.now() + graphViewCacheTtlMs, value: response });
    return response;
  });

  // Similar nodes by vector search
  app.post("/graph/similar", async (req: any, reply) => {
    const q = req.body?.q;
    const k = req.body?.k ?? 20;

    if (!q || typeof q !== "string") {
      return reply.status(400).send({ error: "q is required" });
    }

    const embeddingRuntime = (app as any).embeddingRuntime;
    const result = await queryMongoVectorsByText({
      mongo: app.mongo,
      tier: "hot",
      q,
      k: Math.max(1, Math.min(200, Number(k))),
      getEmbeddingFunctionForModel: (model: string) => embeddingRuntime.hot.getEmbeddingFunctionForModel(model),
    });

    const hits = extractTieredVectorHits(result, "hot");
    return { ok: true, hits, storageBackend: "mongodb" };
  });

  // Query node embeddings by IDs
  app.post("/graph/node-embeddings/query", async (req: any, reply) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const eventIds = Array.isArray(req.body?.eventIds) ? req.body.eventIds : [];
    const model = req.body?.model;

    if (ids.length === 0 && eventIds.length === 0) {
      return { vectors: [] };
    }

    const filter: Record<string, unknown>[] = [];
    if (ids.length > 0) filter.push({ node_id: { $in: ids.map(String) } });
    if (eventIds.length > 0) filter.push({ source_event_id: { $in: eventIds.map(String) } });

    const query = filter.length > 1 ? { $or: filter } : filter[0] || {};
    if (model) Object.assign(query, { embedding_model: String(model) });

    const rows = await app.mongo.graphNodeEmbeddings.find(query).limit(1000).toArray();

    const vectors = rows.map((row: any) => ({
      id: row.node_id,
      sourceEventId: row.source_event_id,
      embeddingModel: row.embedding_model,
      embeddingDimensions: row.embedding_dimensions,
      embedding: row.embedding,
      chunkCount: row.chunk_count,
    }));

    return { vectors };
  });

  // Materialize node embeddings (generate + store)
  app.post("/graph/node-embeddings/materialize", async (req: any, reply) => {
    const inputs = Array.isArray(req.body?.inputs) ? req.body.inputs : [];
    const model = req.body?.model ?? "qwen3-embedding:0.6b";

    if (inputs.length === 0) {
      return { vectors: [] };
    }

    const embeddingRuntime = (app as any).embeddingRuntime;
    const embeddingFn = embeddingRuntime?.hot?.getEmbeddingFunctionForModel?.(model);

    if (!embeddingFn) {
      return reply.status(503).send({ error: "embedding runtime not available" });
    }

    const results: Array<{
      id: string;
      sourceEventId: string;
      embeddingModel: string;
      embeddingDimensions: number;
      embedding: number[];
      chunkCount: number;
    }> = [];

    // Batch embed for efficiency
    const validInputs = inputs
      .slice(0, 100)
      .filter((input: any) => input.id && input.body)
      .map((input: any) => ({
        id: String(input.id),
        sourceEventId: String(input.sourceEventId || input.source_event_id || input.id),
        body: String(input.body),
      }));

    if (validInputs.length === 0) {
      return { vectors: [] };
    }

    try {
      const texts = validInputs.map((i: { body: string }) => i.body);
      const embeddings = await embeddingFn.generate(texts);

      for (let i: number = 0; i < validInputs.length; i++) {
        const embedding = embeddings[i];
        if (!Array.isArray(embedding) || embedding.length === 0) continue;

        results.push({
          id: validInputs[i].id,
          sourceEventId: validInputs[i].sourceEventId,
          embeddingModel: model,
          embeddingDimensions: embedding.length,
          embedding,
          chunkCount: 1,
        });
      }
    } catch (err) {
      console.error("batch embedding failed:", err);
    }

    // Store embeddings
    if (results.length > 0) {
      await upsertGraphNodeEmbeddings(
        app.mongo.graphNodeEmbeddings,
        results.map((r) => ({
          node_id: r.id,
          source_event_id: r.sourceEventId,
          embedding_model: r.embeddingModel,
          embedding_dimensions: r.embeddingDimensions,
          embedding: r.embedding,
          chunk_count: r.chunkCount,
          updated_at: new Date(),
        }))
      );
    }

    return { vectors: results };
  });

  // Monitoring stats for admin dashboards
  app.get("/graph/monitoring", async (req: any, reply) => {
    const [nodeCount, edgeCount, embeddingCount, layoutCount, semanticEdgeCount, graphEdgeCount] = await Promise.all([
      app.mongo.events.countDocuments({ kind: "graph.node" }),
      app.mongo.events.countDocuments({ kind: "graph.edge" }),
      app.mongo.graphNodeEmbeddings.countDocuments({}),
      app.mongo.graphLayoutOverrides.countDocuments({}),
      app.mongo.graphSemanticEdges.countDocuments({}),
      app.mongo.graphEdges.countDocuments({}),
    ]);

    // Get project breakdown
    const projectNodes = await app.mongo.events.aggregate([
      { $match: { kind: "graph.node" } },
      { $group: { _id: "$project", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();

    // Get recent embedding activity
    const recentEmbeddings = await app.mongo.graphNodeEmbeddings.find({})
      .sort({ updated_at: -1 })
      .limit(5)
      .project({ node_id: 1, embedding_model: 1, embedding_dimensions: 1, updated_at: 1 })
      .toArray();

    return {
      ok: true,
      stats: {
        nodes: nodeCount,
        edges: edgeCount,
        embeddings: embeddingCount,
        layouts: layoutCount,
        semanticEdges: semanticEdgeCount,
        graphEdges: graphEdgeCount,
      },
      projectBreakdown: projectNodes.map((p: any) => ({
        project: p._id || "unknown",
        count: p.count,
      })),
      recentEmbeddings: recentEmbeddings.map((e: any) => ({
        nodeId: e.node_id,
        model: e.embedding_model,
        dimensions: e.embedding_dimensions,
        updatedAt: e.updated_at,
      })),
      storageBackend: "mongodb",
    };
  });

  // ============================================================
  // Semantic Edge Persistence (layout-as-search-index)
  // ============================================================

  // Upsert semantic edges for graph clustering
  app.post("/graph/semantic-edges/upsert", async (req: any, reply) => {
    const source = req.body?.source ?? "eros-eris-field";
    const clusteringVersion = req.body?.clusteringVersion ?? "v1";
    const embeddingModel = req.body?.embeddingModel;
    const project = req.body?.project;
    const edges = Array.isArray(req.body?.edges) ? req.body.edges : [];

    if (edges.length === 0) {
      return { ok: true, stored: 0 };
    }

    const rows = edges.map((edge: any) => ({
      source_node_id: String(edge.source ?? edge.a ?? edge.source_node_id),
      target_node_id: String(edge.target ?? edge.b ?? edge.target_node_id),
      similarity: Number(edge.similarity ?? edge.sim ?? 0),
      edge_type: String(edge.edge_type ?? edge.kind ?? "semantic_similarity"),
      project: project ?? null,
      embedding_model: embeddingModel ?? null,
      clustering_version: clusteringVersion,
      source,
      updated_at: new Date(),
    })).filter((r: any) => r.source_node_id && r.target_node_id && r.source_node_id !== r.target_node_id);

    const stored = await upsertGraphSemanticEdges(app.mongo.graphSemanticEdges, rows);
    return { ok: true, stored };
  });

  // Query semantic edges by node IDs
  app.post("/graph/semantic-edges/query", async (req: any, reply) => {
    const nodeIds = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds : [];
    const minSimilarity = Number(req.body?.minSimilarity ?? -1);
    const maxSimilarity = Number(req.body?.maxSimilarity ?? 1);
    const limit = Math.max(1, Math.min(10000, Number(req.body?.limit ?? 1000)));

    if (nodeIds.length === 0) {
      return { edges: [] };
    }

    const filter: Record<string, unknown> = {
      $or: [
        { source_node_id: { $in: nodeIds.map(String) } },
        { target_node_id: { $in: nodeIds.map(String) } },
      ],
      similarity: { $gte: minSimilarity, $lte: maxSimilarity },
    };

    const rows = await app.mongo.graphSemanticEdges.find(filter).limit(limit).toArray();

    const edges = rows.map((row: any) => ({
      source: row.source_node_id,
      target: row.target_node_id,
      similarity: row.similarity,
      edgeType: row.edge_type,
      embeddingModel: row.embedding_model,
      clusteringVersion: row.clustering_version,
      updatedAt: row.updated_at,
    }));

    return { edges };
  });

  // ============================================================
  // ALL Graph Edges (structural + semantic) from graph-weaver
  // ============================================================

  // Upsert ALL edges from graph-weaver
  app.post("/graph/edges/upsert", async (req: any, reply) => {
    const source = req.body?.source ?? "graph-weaver";
    const project = req.body?.project;
    const edges = Array.isArray(req.body?.edges) ? req.body.edges : [];

    if (edges.length === 0) {
      return { ok: true, stored: 0 };
    }

    const rows = edges.map((edge: any) => ({
      source_node_id: String(edge.source ?? edge.source_node_id),
      target_node_id: String(edge.target ?? edge.target_node_id),
      edge_kind: String(edge.kind ?? edge.edge_kind ?? "unknown"),
      layer: edge.layer ?? null,
      project: project ?? null,
      source,
      data: edge.data ?? null,
      updated_at: new Date(),
    })).filter((r: any) => r.source_node_id && r.target_node_id && r.source_node_id !== r.target_node_id);

    const stored = await upsertGraphEdges(app.mongo.graphEdges, rows);
    return { ok: true, stored };
  });

  // Query ALL edges by node IDs
  app.post("/graph/edges/query", async (req: any, reply) => {
    const nodeIds = Array.isArray(req.body?.nodeIds) ? req.body.nodeIds : [];
    const edgeKinds = Array.isArray(req.body?.edgeKinds) ? req.body.edgeKinds : null;
    const limit = Math.max(1, Math.min(50000, Number(req.body?.limit ?? 10000)));
    const includeEventFallback = req.body?.includeEventFallback === true;
    const includeBoundaryEdges = req.body?.includeBoundaryEdges === true;

    if (nodeIds.length === 0) {
      return { edges: [] };
    }

    const stringNodeIds = nodeIds.map(String);
    const filter: Record<string, unknown> = includeBoundaryEdges
      ? {
          $or: [
            { source_node_id: { $in: stringNodeIds } },
            { target_node_id: { $in: stringNodeIds } },
          ],
        }
      : {
          source_node_id: { $in: stringNodeIds },
          target_node_id: { $in: stringNodeIds },
        };
    if (edgeKinds) {
      filter.edge_kind = { $in: edgeKinds };
    }

    const rows = await app.mongo.graphEdges.find(filter).limit(limit).toArray();

    const edgesByKey = new Map<string, {
      source: string;
      target: string;
      edgeKind: string;
      layer: string | null;
      data: unknown;
      updatedAt: Date | null;
    }>();

    for (const row of rows) {
      const edge = {
        source: row.source_node_id,
        target: row.target_node_id,
        edgeKind: row.edge_kind,
        layer: row.layer,
        data: row.data,
        updatedAt: row.updated_at,
      };
      const key = `${edge.edgeKind}::${edge.source}::${edge.target}`;
      edgesByKey.set(key, edge);
    }

    if (includeEventFallback) {
      const eventFilter: Record<string, unknown> = {
        kind: "graph.edge",
        ...(includeBoundaryEdges
          ? {
              $or: [
                { "extra.source_node_id": { $in: stringNodeIds } },
                { "extra.target_node_id": { $in: stringNodeIds } },
              ],
            }
          : {
              "extra.source_node_id": { $in: stringNodeIds },
              "extra.target_node_id": { $in: stringNodeIds },
            }),
      };
      if (edgeKinds) {
        eventFilter["extra.edge_type"] = { $in: edgeKinds };
      }

      const eventRows = await app.mongo.events.find(eventFilter).limit(limit).toArray();

      for (const row of eventRows) {
        const extra = (row.extra ?? {}) as Record<string, unknown>;
        const source = typeof extra.source_node_id === "string" ? extra.source_node_id : "";
        const target = typeof extra.target_node_id === "string" ? extra.target_node_id : "";
        const edgeKind = typeof extra.edge_type === "string" ? extra.edge_type : "unknown";
        if (!source || !target) continue;
        const key = `${edgeKind}::${source}::${target}`;
        if (edgesByKey.has(key)) continue;
        edgesByKey.set(key, {
          source,
          target,
          edgeKind,
          layer: typeof extra.layer === "string" ? extra.layer : null,
          data: extra,
          updatedAt: row.ts instanceof Date ? row.ts : null,
        });
      }
    }

    const edges = [...edgesByKey.values()].slice(0, limit);

    return { edges };
  });

  // Get all edges for graph traversal (paginated)
  app.get("/graph/semantic-edges", async (req: any, reply) => {
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : undefined;
    const graphVersion = typeof req.query?.graph_version === "string" ? req.query.graph_version.trim() : undefined;
    const minSimilarity = Number(req.query?.minSimilarity ?? -1);
    const limit = Math.max(1, Math.min(50000, Number(req.query?.limit ?? 10000)));

    const filter: Record<string, unknown> = {
      similarity: { $gte: minSimilarity },
    };
    if (project) filter.project = project;

    if (graphVersion) {
      filter.graph_version = graphVersion;
    } else {
      const canonicalRun = await app.mongo.semanticGraphRuns.findOne(
        { status: "complete" },
        { sort: { finished_at: -1 as any } },
      );
      if (canonicalRun?.graph_version) {
        filter.graph_version = canonicalRun.graph_version;
      }
    }

    const rows = await app.mongo.graphSemanticEdges.find(filter).limit(limit).toArray();

    const edges = rows.map((row: any) => ({
      source: row.source_node_id,
      target: row.target_node_id,
      similarity: row.similarity,
      edgeType: row.edge_type,
      graphVersion: row.graph_version,
    }));

    return { ok: true, count: edges.length, edges };
  });

  // ============================================================
  // Mongot-native semantic edge builder (replaces HNSW pipeline)
  // Uses $vectorSearch on event_chunks (already indexed) to build
  // kNN edges without a separate HNSW build step.
  // ============================================================

  app.post("/jobs/build-semantic-edges", async (req: any) => {
    const body = (req.body as any) ?? {};
    const k = Math.max(2, Math.min(64, Number(body.k ?? 8)));
    const minSimilarity = Math.max(0, Math.min(1, Number(body.minSimilarity ?? 0.5)));
    const maxDegree = Math.max(2, Number(body.maxDegree ?? k * 2));
    const concurrency = Math.max(1, Math.min(16, Number(body.concurrency ?? 8)));

    // 1. Read all event_chunks with embeddings
    const chunks = await app.mongo.hotVectors.find(
      { embedding: { $exists: true, $type: "array", $ne: [] } },
      { projection: { _id: 1, chunk_id: 1, title: 1, kind: 1, project: 1, embedding: 1, embedding_model: 1, embedding_dimensions: 1 } },
    ).toArray();

    if (chunks.length === 0) {
      return { ok: true, note: "No chunks with embeddings found", nodes: 0, edges: 0 };
    }

    // 2. Create graph.node events for each chunk so the export has visible nodes
    const nodePrefix = "devel:chunk:";
    const eventBatch: Array<any> = [];
    const embeddingRows: Array<any> = [];
    const chunkIdToNodeId = new Map<string, string>();

    for (const chunk of chunks) {
      const nodeId = `${nodePrefix}${chunk._id}`;
      const eventId = `graph.node:chunk:${chunk._id}`;
      chunkIdToNodeId.set(String(chunk._id), nodeId);

      const title = chunk.title || "";
      const label = title.split("/").pop() || title || String(chunk._id);

      eventBatch.push({
        updateOne: {
          filter: { _id: eventId },
          update: {
            $set: {
              kind: "graph.node",
              project: chunk.project || "devel",
              source: "chunk-graph-builder",
              "extra.node_id": nodeId,
              "extra.node_kind": "chunk",
              "extra.label": label,
              "extra.path": title,
              "extra.node_type": chunk.kind || "code",
              "extra.lake": chunk.project || "devel",
              ts: new Date(),
            },
            $setOnInsert: { createdAt: new Date(), text: "" },
          },
          upsert: true,
        },
      });

      embeddingRows.push({
        node_id: nodeId,
        source_event_id: eventId,
        project: chunk.project || "devel",
        embedding_model: chunk.embedding_model || "qwen3-embedding:0.6b",
        embedding_dimensions: chunk.embedding_dimensions || 1024,
        embedding: chunk.embedding,
        chunk_index: chunk.chunk_index ?? 0,
        chunk_count: chunk.chunk_count ?? 1,
      });
    }

    // Batch upsert graph.node events
    const eventBatchSize = 2000;
    for (let i = 0; i < eventBatch.length; i += eventBatchSize) {
      await app.mongo.events.bulkWrite(eventBatch.slice(i, i + eventBatchSize), { ordered: false });
    }

    // Upsert graph_node_embeddings (for the embedding backfill / future HNSW use)
    await upsertGraphNodeEmbeddings(app.mongo.graphNodeEmbeddings, embeddingRows);

    // 3. Build semantic edges using mongot $vectorSearch on event_chunks
    const directedEdges: Array<{ source: string; target: string; similarity: number }> = [];

    const processChunk = async (chunk: any): Promise<void> => {
      const emb = chunk.embedding as number[];
      if (!emb || emb.length < 2) return;

      try {
        const results = await app.mongo.hotVectors.aggregate<any>([
          {
            $vectorSearch: {
              index: "chunk_vector",
              path: "embedding",
              queryVector: emb,
              numCandidates: Math.max(k * 5, 50),
              limit: k + 1,
            },
          },
          { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
        ]).toArray();

        for (const result of results) {
          if (String(result._id) === String(chunk._id)) continue;
          if ((result.score as number) < minSimilarity) continue;

          const sourceNodeId = chunkIdToNodeId.get(String(chunk._id));
          const targetNodeId = chunkIdToNodeId.get(String(result._id));
          if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) continue;

          directedEdges.push({ source: sourceNodeId, target: targetNodeId, similarity: result.score as number });
        }
      } catch {
        // Skip chunks that fail vector search (dimension mismatch, etc.)
      }
    };

    for (let i = 0; i < chunks.length; i += concurrency) {
      const batch = chunks.slice(i, Math.min(i + concurrency, chunks.length));
      await Promise.all(batch.map(processChunk));
    }

    // 4. Symmetrize: keep the higher similarity for each undirected pair
    const edgeMap = new Map<string, { source: string; target: string; similarity: number }>();
    for (const edge of directedEdges) {
      const a = edge.source < edge.target ? edge.source : edge.target;
      const b = edge.source < edge.target ? edge.target : edge.source;
      const key = `${a}||${b}`;
      const existing = edgeMap.get(key);
      if (!existing || edge.similarity > existing.similarity) {
        edgeMap.set(key, { source: a, target: b, similarity: edge.similarity });
      }
    }

    // 5. Cap at maxDegree per node (greedy: keep highest-similarity edges first)
    const ranked = [...edgeMap.values()].sort((a, b) => b.similarity - a.similarity);
    const degrees = new Map<string, number>();
    const cappedEdges: Array<{ source_node_id: string; target_node_id: string; similarity: number }> = [];

    for (const edge of ranked) {
      const degA = degrees.get(edge.source) ?? 0;
      const degB = degrees.get(edge.target) ?? 0;
      if (degA >= maxDegree || degB >= maxDegree) continue;
      cappedEdges.push({ source_node_id: edge.source, target_node_id: edge.target, similarity: edge.similarity });
      degrees.set(edge.source, degA + 1);
      degrees.set(edge.target, degB + 1);
    }

    // 6. Persist to graph_semantic_edges
    const graphVersion = `mongot-knn-${Date.now()}`;
    const persistBatchSize = 1000;
    for (let i = 0; i < cappedEdges.length; i += persistBatchSize) {
      const batch = cappedEdges.slice(i, i + persistBatchSize);
      await upsertGraphSemanticEdges(
        app.mongo.graphSemanticEdges,
        batch.map((e) => ({
          source_node_id: e.source_node_id,
          target_node_id: e.target_node_id,
          similarity: e.similarity,
          edge_type: "semantic_knn",
          embedding_model: "qwen3-embedding:0.6b",
          graph_version: graphVersion,
        })),
      );
    }

    return {
      ok: true,
      graphVersion,
      nodes: chunks.length,
      directedEdges: directedEdges.length,
      undirectedEdges: edgeMap.size,
      cappedEdges: cappedEdges.length,
      k,
      minSimilarity,
      maxDegree,
    };
  });

  // Strip document content from event_chunks — keep embeddings, metadata, identifiers only.
  // Content lives on disk; the DB stores graph topology + similarity index.
  app.post("/jobs/strip-chunk-content", async (req: any) => {
    const dryRun = req.body?.dryRun === true;
    if (dryRun) {
      const count = await app.mongo.hotVectors.countDocuments({ text: { $exists: true, $ne: "" } });
      const avgSize = await app.mongo.hotVectors.aggregate([
        { $match: { text: { $exists: true, $ne: "" } } },
        { $project: { textSize: { $strLenCP: "$text" } } },
        { $group: { _id: null, avg: { $avg: "$textSize" } } },
      ]).toArray();
      return { ok: true, dryRun: true, chunksWithContent: count, avgTextLength: avgSize[0]?.avg ?? 0 };
    }

    const result = await app.mongo.hotVectors.updateMany(
      { text: { $exists: true } },
      { $unset: { text: "" } },
    );
    return { ok: true, stripped: result.modifiedCount };
  });

  // ============================================================
  // Graph-version-aware semantic graph runs
  // ============================================================

  app.get("/graph/runs", async (req: any) => {
    const status = typeof req.query?.status === "string" ? req.query.status.trim() : undefined;
    const limit = Math.max(1, Math.min(1000, Number(req.query?.limit ?? 50)));

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const rows = await app.mongo.semanticGraphRuns
      .find(filter, { sort: { finished_at: -1 as any }, limit })
      .toArray();

    return {
      ok: true,
      count: rows.length,
      runs: rows.map((r) => ({
        runId: r.run_id,
        graphVersion: r.graph_version,
        clusteringVersion: r.clustering_version,
        embeddingModel: r.embedding_model,
        embeddingDimensions: r.embedding_dimensions,
        nodeCount: r.node_count,
        finalK: r.final_k,
        candidateFactor: r.candidate_factor,
        candidateEngine: r.candidate_engine,
        rerankProvider: r.rerank_provider,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        metrics: r.metrics,
      })),
    };
  });

  app.get("/graph/runs/latest", async (req: any, reply: any) => {
    const status = typeof req.query?.status === "string" ? req.query.status.trim() : "complete";
    const row = await app.mongo.semanticGraphRuns.findOne(
      { status: { $in: [status, "clustered"] } },
      { sort: { finished_at: -1 as any } },
    );

    if (!row) {
      return reply.status(404).send({ ok: false, error: "no canonical run found" });
    }

    return {
      ok: true,
      runId: row.run_id,
      graphVersion: row.graph_version,
      clusteringVersion: row.clustering_version,
      embeddingModel: row.embedding_model,
      embeddingDimensions: row.embedding_dimensions,
      nodeCount: row.node_count,
      finalK: row.final_k,
      candidateFactor: row.candidate_factor,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      metrics: row.metrics,
    };
  });

  // ============================================================
  // Cluster membership endpoints (S8)
  // ============================================================

  app.get("/graph/clusters", async (req: any) => {
    const graphVersion = typeof req.query?.graph_version === "string"
      ? req.query.graph_version.trim()
      : undefined;
    const clusteringVersion = typeof req.query?.clustering_version === "string"
      ? req.query.clustering_version.trim()
      : undefined;
    const limit = Math.max(1, Math.min(10000, Number(req.query?.limit ?? 1000)));

    const filter: Record<string, unknown> = {};
    if (graphVersion) filter.graph_version = graphVersion;
    if (clusteringVersion) filter.clustering_version = clusteringVersion;

    const rows = await app.mongo.graphClusterMemberships
      .find(filter, { limit: limit * 2 })
      .toArray();

    const clusterMap = new Map<string, { clusterId: string; size: number; members: Set<string> }>();
    for (const row of rows) {
      if (!row.cluster_id) continue;
      if (!clusterMap.has(row.cluster_id)) {
        clusterMap.set(row.cluster_id, {
          clusterId: row.cluster_id,
          size: 0,
          members: new Set(),
        });
      }
      clusterMap.get(row.cluster_id)!.size++;
    }

    const clusters = Array.from(clusterMap.values())
      .sort((a, b) => b.size - a.size)
      .slice(0, limit)
      .map((c) => ({ clusterId: c.clusterId, size: c.size }));

    return { ok: true, count: clusters.length, clusters };
  });

  app.get("/graph/clusters/:cluster_id/members", async (req: any) => {
    const { cluster_id: clusterId } = req.params as { cluster_id: string };
    const graphVersion = typeof req.query?.graph_version === "string"
      ? req.query.graph_version.trim()
      : undefined;
    const clusteringVersion = typeof req.query?.clustering_version === "string"
      ? req.query.clustering_version.trim()
      : undefined;
    const limit = Math.max(1, Math.min(50000, Number(req.query?.limit ?? 1000)));

    const filter: Record<string, unknown> = { cluster_id: clusterId };
    if (graphVersion) filter.graph_version = graphVersion;
    if (clusteringVersion) filter.clustering_version = clusteringVersion;

    const rows = await app.mongo.graphClusterMemberships
      .find(filter, { limit })
      .toArray();

    const nodes = rows
      .map((r) => r.node_id)
      .filter((id): id is string => !!id);

    return { ok: true, count: nodes.length, clusterId, nodes };
  });

  app.get("/graph/nodes/:node_id/cluster", async (req: any) => {
    const { node_id: nodeId } = req.params as { node_id: string };

    const row = await app.mongo.graphClusterMemberships.findOne(
      { node_id: nodeId },
      { sort: { updated_at: -1 as any } },
    );

    if (!row) {
      return { ok: true, nodeId, cluster: null };
    }

    return {
      ok: true,
      nodeId,
      cluster: row.cluster_id,
      clusteringVersion: row.clustering_version,
      graphVersion: row.graph_version,
      clusterSize: row.cluster_size,
    };
  });

  // ============================================================
  // Graph Traversal Search (layout-aware)
  // ============================================================

  // Graph neighborhood expansion via traversal
  // Uses PHYSICAL edge lengths from layout positions as cost metric
  // This encodes ALL forces: structural links + semantic attraction/repulsion
  app.post("/graph/traverse", async (req: any, reply) => {
    const seedNodeIds = Array.isArray(req.body?.seedNodeIds) ? req.body.seedNodeIds : [];
    const maxDistance = Number(req.body?.maxDistance ?? 5000); // Maximum physical distance to traverse
    const maxNodes = Number(req.body?.maxNodes ?? 100); // Maximum nodes to return
    const edgeKinds = Array.isArray(req.body?.edgeKinds) ? req.body.edgeKinds : null; // Filter by edge kinds (null = all)
    const includeSeeds = req.body?.includeSeeds !== false;

    if (seedNodeIds.length === 0) {
      return { nodes: [], edges: [], stats: { seeds: 0, visited: 0, edges: 0 } };
    }

    // Step 1: Get ALL edges connected to seed nodes
    const edgeFilter: Record<string, unknown> = {
      $or: [
        { source_node_id: { $in: seedNodeIds.map(String) } },
        { target_node_id: { $in: seedNodeIds.map(String) } },
      ],
    };
    if (edgeKinds) {
      edgeFilter.edge_kind = { $in: edgeKinds };
    }

    const directEdges = await app.mongo.graphEdges.find(edgeFilter).limit(10000).toArray();

    if (directEdges.length === 0) {
      // Fall back to semantic edges if no structural edges found
      const semanticEdges = await app.mongo.graphSemanticEdges.find({
        $or: [
          { source_node_id: { $in: seedNodeIds.map(String) } },
          { target_node_id: { $in: seedNodeIds.map(String) } },
        ],
      }).limit(10000).toArray();

      if (semanticEdges.length === 0) {
        return { nodes: [], edges: [], stats: { seeds: 0, visited: 0, edges: 0 } };
      }

      // Fall back to similarity-based cost
      const adjacency = new Map<string, Array<{ neighbor: string; similarity: number; cost: number; edgeKind: string }>>();
      for (const edge of semanticEdges) {
        const sourceId = edge.source_node_id;
        const targetId = edge.target_node_id;
        const sim = edge.similarity;
        const cost = (1 - sim) * 1000; // Scale to match physical distances

        const sourceNeighbors = adjacency.get(sourceId) ?? [];
        sourceNeighbors.push({ neighbor: targetId, similarity: sim, cost, edgeKind: "semantic_similarity" });
        adjacency.set(sourceId, sourceNeighbors);

        const targetNeighbors = adjacency.get(targetId) ?? [];
        targetNeighbors.push({ neighbor: sourceId, similarity: sim, cost, edgeKind: "semantic_similarity" });
        adjacency.set(targetId, targetNeighbors);
      }

      // Dijkstra-like traversal
      const distances = new Map<string, number>();
      const predecessors = new Map<string, { from: string; edge: { similarity: number; edgeKind: string } }>();
      const visited = new Set<string>();
      const pq: Array<{ nodeId: string; cost: number }> = [];

      for (const seedId of seedNodeIds.map(String)) {
        distances.set(seedId, 0);
        pq.push({ nodeId: seedId, cost: 0 });
      }

      while (pq.length > 0 && visited.size < maxNodes) {
        pq.sort((a, b) => a.cost - b.cost);
        const current = pq.shift()!;

        if (visited.has(current.nodeId)) continue;
        if (current.cost > maxDistance) continue;

        visited.add(current.nodeId);

        const neighbors = adjacency.get(current.nodeId) ?? [];
        for (const { neighbor, similarity, cost, edgeKind } of neighbors) {
          if (visited.has(neighbor)) continue;
          const newDist = current.cost + cost;
          if (newDist > maxDistance) continue;

          const existingDist = distances.get(neighbor);
          if (existingDist === undefined || newDist < existingDist) {
            distances.set(neighbor, newDist);
            predecessors.set(neighbor, { from: current.nodeId, edge: { similarity, edgeKind } });
            pq.push({ nodeId: neighbor, cost: newDist });
          }
        }
      }

      const traversedEdges: Array<{ source: string; target: string; similarity: number; edgeKind: string }> = [];
      for (const [nodeId, pred] of predecessors) {
        traversedEdges.push({
          source: pred.from,
          target: nodeId,
          similarity: pred.edge.similarity,
          edgeKind: pred.edge.edgeKind,
        });
      }

      const resultNodes = [...visited]
        .filter(id => includeSeeds || !seedNodeIds.map(String).includes(id))
        .map(id => ({
          id,
          distance: distances.get(id) ?? 0,
          isSeed: seedNodeIds.map(String).includes(id),
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxNodes);

      return {
        nodes: resultNodes,
        edges: traversedEdges,
        stats: { seeds: seedNodeIds.length, visited: visited.size, edges: traversedEdges.length, mode: "semantic_fallback" },
      };
    }

    // Step 2: Get layout positions for all nodes involved
    const allNodeIds = new Set<string>();
    for (const edge of directEdges) {
      allNodeIds.add(edge.source_node_id);
      allNodeIds.add(edge.target_node_id);
    }
    seedNodeIds.forEach((id: string) => {
      allNodeIds.add(String(id));
    });

    const layouts = await app.mongo.graphLayoutOverrides.find({
      node_id: { $in: [...allNodeIds] },
    }).toArray();

    const layoutMap = new Map<string, { x: number; y: number }>();
    for (const layout of layouts) {
      layoutMap.set(layout.node_id, { x: layout.x, y: layout.y });
    }

    // Step 3: Build adjacency list with physical distances
    const adjacency = new Map<string, Array<{ neighbor: string; distance: number; edgeKind: string }>>();
    const edgeData = new Map<string, { source: string; target: string; distance: number; edgeKind: string }>();

    for (const edge of directEdges) {
      const sourceId = edge.source_node_id;
      const targetId = edge.target_node_id;
      const sourcePos = layoutMap.get(sourceId);
      const targetPos = layoutMap.get(targetId);

      // Skip edges where we don't have positions for both nodes
      if (!sourcePos || !targetPos) continue;

      // Euclidean distance
      const dx = sourcePos.x - targetPos.x;
      const dy = sourcePos.y - targetPos.y;
      const physicalDistance = Math.sqrt(dx * dx + dy * dy);

      const edgeKind = edge.edge_kind;
      const edgeKey = `${sourceId}||${targetId}||${edgeKind}`;
      edgeData.set(edgeKey, { source: sourceId, target: targetId, distance: physicalDistance, edgeKind });

      // Add both directions for undirected traversal
      const sourceNeighbors = adjacency.get(sourceId) ?? [];
      sourceNeighbors.push({ neighbor: targetId, distance: physicalDistance, edgeKind });
      adjacency.set(sourceId, sourceNeighbors);

      const targetNeighbors = adjacency.get(targetId) ?? [];
      targetNeighbors.push({ neighbor: sourceId, distance: physicalDistance, edgeKind });
      adjacency.set(targetId, targetNeighbors);
    }

    // Step 4: Dijkstra-like traversal using physical distances
    const distances = new Map<string, number>();
    const predecessors = new Map<string, { from: string; edge: { distance: number; edgeKind: string } }>();
    const visited = new Set<string>();
    const pq: Array<{ nodeId: string; dist: number }> = [];

    // Initialize seeds with distance 0
    for (const seedId of seedNodeIds.map(String)) {
      distances.set(seedId, 0);
      pq.push({ nodeId: seedId, dist: 0 });
    }

    // Process queue
    while (pq.length > 0 && visited.size < maxNodes) {
      pq.sort((a, b) => a.dist - b.dist);
      const current = pq.shift()!;

      if (visited.has(current.nodeId)) continue;
      if (current.dist > maxDistance) continue;

      visited.add(current.nodeId);

      const neighbors = adjacency.get(current.nodeId) ?? [];
      for (const { neighbor, distance, edgeKind } of neighbors) {
        if (visited.has(neighbor)) continue;

        const newDist = current.dist + distance;
        if (newDist > maxDistance) continue;

        const existingDist = distances.get(neighbor);
        if (existingDist === undefined || newDist < existingDist) {
          distances.set(neighbor, newDist);
          predecessors.set(neighbor, { from: current.nodeId, edge: { distance, edgeKind } });
          pq.push({ nodeId: neighbor, dist: newDist });
        }
      }
    }

    // Collect traversed edges
    const traversedEdges: Array<{ source: string; target: string; distance: number; edgeKind: string }> = [];
    for (const [nodeId, pred] of predecessors) {
      traversedEdges.push({
        source: pred.from,
        target: nodeId,
        distance: pred.edge.distance,
        edgeKind: pred.edge.edgeKind,
      });
    }

    // Build result nodes
    const resultNodes = [...visited]
      .filter(id => includeSeeds || !seedNodeIds.map(String).includes(id))
      .map(id => ({
        id,
        distance: distances.get(id) ?? 0,
        isSeed: seedNodeIds.map(String).includes(id),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxNodes);

    return {
      nodes: resultNodes,
      edges: traversedEdges,
      stats: {
        seeds: seedNodeIds.length,
        visited: visited.size,
        edges: traversedEdges.length,
        edgesQueried: directEdges.length,
        nodesWithLayout: layoutMap.size,
        mode: "physical_distance",
      },
    };
  });

  // Combined vector search + graph traversal
  // 1. Vector search finds seed nodes
  // 2. Graph traversal expands neighborhood using edge costs
  app.post("/graph/semantic-search", async (req: any, reply) => {
    const q = req.body?.q;
    const k = Number(req.body?.k ?? 10); // Initial vector search seeds
    const maxCost = Number(req.body?.maxCost ?? 1.5); // Max traversal cost
    const maxNodes = Number(req.body?.maxNodes ?? 50); // Max nodes in result
    const minSimilarity = Number(req.body?.minSimilarity ?? 0.5); // Min edge similarity
    const minVectorSimilarity = Number(req.body?.minVectorSimilarity ?? 0.3); // Min vector search score

    if (!q || typeof q !== "string") {
      return reply.status(400).send({ error: "q is required" });
    }

    const embeddingRuntime = (app as any).embeddingRuntime;

    // Step 1: Vector search to find seed nodes
    const vectorResult = await queryMongoVectorsByText({
      mongo: app.mongo,
      tier: "hot",
      q,
      k: Math.max(1, Math.min(100, k)),
      getEmbeddingFunctionForModel: (model: string) => embeddingRuntime.hot.getEmbeddingFunctionForModel(model),
    });

    const vectorHits = extractTieredVectorHits(vectorResult, "hot");

    // Filter by minimum vector similarity (convert distance to similarity: sim = 1 - dist)
    const seedHits = vectorHits.filter((hit: any) => {
      const dist = hit.distance ?? 0;
      const sim = 1 - dist;
      return sim >= minVectorSimilarity;
    });
    const seedNodeIds = seedHits.map((hit: any) => hit.id);

    if (seedNodeIds.length === 0) {
      return {
        seeds: [],
        nodes: [],
        edges: [],
        stats: { vectorHits: vectorHits.length, seeds: 0, visited: 0, edges: 0 },
      };
    }

    // Step 2: Graph traversal from seeds
    const edgeFilter: Record<string, unknown> = {
      similarity: { $gte: minSimilarity },
    };

    const directEdges = await app.mongo.graphSemanticEdges.find({
      ...edgeFilter,
      $or: [
        { source_node_id: { $in: seedNodeIds } },
        { target_node_id: { $in: seedNodeIds } },
      ],
    }).toArray();

    // Build adjacency list
    const adjacency = new Map<string, Array<{ neighbor: string; similarity: number; cost: number }>>();
    for (const edge of directEdges) {
      const sourceId = edge.source_node_id;
      const targetId = edge.target_node_id;
      const sim = edge.similarity;
      const cost = 1 - sim;

      const sourceNeighbors = adjacency.get(sourceId) ?? [];
      sourceNeighbors.push({ neighbor: targetId, similarity: sim, cost });
      adjacency.set(sourceId, sourceNeighbors);

      const targetNeighbors = adjacency.get(targetId) ?? [];
      targetNeighbors.push({ neighbor: sourceId, similarity: sim, cost });
      adjacency.set(targetId, targetNeighbors);
    }

    // Dijkstra traversal
    const distances = new Map<string, number>();
    const predecessors = new Map<string, { from: string; edge: { similarity: number } }>();
    const visited = new Set<string>();
    const pq: Array<{ nodeId: string; cost: number }> = [];

    // Seed nodes get negative cost bonus (prefer starting points)
    const seedScores = new Map<string, number>();
    for (const hit of seedHits) {
      const dist = hit.distance ?? 0;
      const sim = 1 - dist; // Convert distance to similarity
      seedScores.set(hit.id, sim);
      distances.set(hit.id, 0);
      pq.push({ nodeId: hit.id, cost: 0 });
    }

    while (pq.length > 0 && visited.size < maxNodes) {
      pq.sort((a, b) => a.cost - b.cost);
      const current = pq.shift()!;

      if (visited.has(current.nodeId)) continue;
      if (current.cost > maxCost) continue;

      visited.add(current.nodeId);

      const neighbors = adjacency.get(current.nodeId) ?? [];
      for (const { neighbor, similarity, cost } of neighbors) {
        if (visited.has(neighbor)) continue;

        const newDist = current.cost + cost;
        if (newDist > maxCost) continue;

        const existingDist = distances.get(neighbor);
        if (existingDist === undefined || newDist < existingDist) {
          distances.set(neighbor, newDist);
          predecessors.set(neighbor, { from: current.nodeId, edge: { similarity } });
          pq.push({ nodeId: neighbor, cost: newDist });
        }
      }
    }

    // Collect traversed edges
    const traversedEdges: Array<{ source: string; target: string; similarity: number }> = [];
    for (const [nodeId, pred] of predecessors) {
      traversedEdges.push({
        source: pred.from,
        target: nodeId,
        similarity: pred.edge.similarity,
      });
    }

    // Build result nodes with combined score (vector + traversal cost)
    const resultNodes = [...visited]
      .map(id => {
        const traversalCost = distances.get(id) ?? 0;
        const vectorScore = seedScores.get(id) ?? 0;
        // Combined score: seeds keep vector score, expanded nodes get inverse cost
        const score = vectorScore > 0 ? vectorScore : 1 / (1 + traversalCost);
        return {
          id,
          score,
          traversalCost,
          isSeed: seedScores.has(id),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, maxNodes);

    return {
      seeds: seedHits.map((h: any) => {
        const dist = h.distance ?? 0;
        return { id: h.id, score: 1 - dist };
      }),
      nodes: resultNodes,
      edges: traversedEdges,
      stats: {
        vectorHits: vectorHits.length,
        seeds: seedNodeIds.length,
        visited: visited.size,
        edges: traversedEdges.length,
      },
    };
  });

  app.post("/graph/memory", async (req: any, reply) => {
    const q = req.body?.q;
    const lakes = Array.isArray(req.body?.lakes) ? req.body.lakes : null;
    const nodeTypes = Array.isArray(req.body?.nodeTypes) ? req.body.nodeTypes : null;
    const k = Number(req.body?.k ?? 15);
    const maxCost = Number(req.body?.maxCost ?? 2.0);
    const maxNodes = Number(req.body?.maxNodes ?? 60);
    const minSimilarity = Number(req.body?.minSimilarity ?? 0.55);
    const minVectorSimilarity = Number(req.body?.minVectorSimilarity ?? 0.35);
    const maxCandidates = Number(req.body?.maxCandidates ?? 10000);
    const includeText = req.body?.includeText !== false;

    if (!q || typeof q !== "string") {
      return reply.status(400).send({ error: "q is required" });
    }

    const embeddingRuntime = (app as any).embeddingRuntime;
    const embedModel = process.env.EMBED_PROVIDER_MODEL ?? "qwen3-embedding:0.6b";
    const embeddingProvider = embeddingRuntime?.hot?.getEmbeddingFunctionForModel?.(embedModel);

    if (!embeddingProvider) {
      return reply.status(503).send({ error: "embedding function unavailable" });
    }

    const lakeRegexes = lakes?.map((lake: string) => new RegExp(`^${escapeRegex(lake)}:`)) ?? [];

    let seedNodeIds: string[] = [];
    let seedScoresMap = new Map<string, number>();
    let vectorHitCount = 0;

    try {
      const [queryEmbedding] = await embeddingProvider.generate([q]);
      if (queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
        const vectorSearchLimit = Math.min(maxCandidates, Math.max(k * 4, 50));
        const vectorSearchNumCandidates = Math.max(
          vectorSearchLimit,
          Math.min(maxCandidates, Math.max(vectorSearchLimit * 10, 200)),
        );

        try {
          const rawVectorMatches = await app.mongo.graphNodeEmbeddings.aggregate([
            {
              $vectorSearch: {
                index: "embedding_vector",
                path: "embedding",
                queryVector: queryEmbedding,
                numCandidates: vectorSearchNumCandidates,
                limit: vectorSearchLimit,
              },
            },
            {
              $project: {
                _id: 0,
                node_id: 1,
                project: 1,
                score: { $meta: "vectorSearchScore" },
              },
            },
          ]).toArray() as Array<{ node_id?: string; project?: string; score?: number }>;

          const scored = rawVectorMatches
            .map((doc) => ({
              nodeId: String(doc.node_id ?? ""),
              score: typeof doc.score === "number" ? doc.score : Number.NEGATIVE_INFINITY,
              project: String(doc.project ?? ""),
            }))
            .filter((doc) => doc.nodeId.length > 0)
            .filter((doc) => doc.score >= minVectorSimilarity)
            .filter((doc) => lakeRegexes.length === 0 || lakeRegexes.some((pattern: RegExp) => pattern.test(doc.nodeId)))
            .filter((doc) => matchesNodeType(doc.nodeId, nodeTypes))
            .sort((a, b) => b.score - a.score);

          const topK = scored.slice(0, k);
          vectorHitCount = scored.length;
          seedNodeIds = topK.map((entry) => entry.nodeId);
          for (const entry of topK) seedScoresMap.set(entry.nodeId, entry.score);
        } catch (error) {
          req.log.warn({ err: error }, "memory: native vector search unavailable, using fallback");

          const embedFilter: Record<string, unknown> = { embedding: { $exists: true } };
          if (lakeRegexes.length > 0) {
            embedFilter.node_id = { $in: lakeRegexes };
          }

          const totalCandidates = await app.mongo.graphNodeEmbeddings.countDocuments(embedFilter);
          const fetchLimit = Math.min(50000, Math.max(k, maxCandidates), totalCandidates);
          const scored: Array<{ nodeId: string; score: number; project: string }> = [];

          const vexxBaseUrl = process.env.VEXX_BASE_URL || "http://host.docker.internal:8787";
          const vexxTimeoutMs = 30000;
          const fetchBatchSize = 500;

          const cursor = app.mongo.graphNodeEmbeddings.find(
            embedFilter,
            { projection: { node_id: 1, embedding: 1, project: 1 } },
          ).limit(fetchLimit).batchSize(fetchBatchSize);

          let done = false;
          while (!done) {
            const batchDocs: any[] = [];
            for (let i = 0; i < fetchBatchSize; i += 1) {
              const doc = await cursor.next();
              if (doc === null) {
                done = true;
                break;
              }
              batchDocs.push(doc);
            }

            const validDocs = batchDocs.filter((doc: any) => {
              const embedding = doc.embedding as number[];
              return embedding && embedding.length === queryEmbedding.length;
            });
            if (validDocs.length === 0) continue;

            const batchEmbeddings = validDocs.map((doc: any) => doc.embedding as number[]);

            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), vexxTimeoutMs);
              const res = await fetch(`${vexxBaseUrl}/v1/cosine/matrix`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  left: [queryEmbedding],
                  right: batchEmbeddings,
                  device: "AUTO",
                }),
                signal: controller.signal,
              });
              clearTimeout(timeout);

              if (res.ok) {
                const payload = await res.json() as { matrix?: number[] };
                const matrix = payload.matrix;
                if (Array.isArray(matrix) && matrix.length === validDocs.length) {
                  for (let i = 0; i < validDocs.length; i += 1) {
                    const similarity = matrix[i]!;
                    const doc = validDocs[i]!;
                    const nodeId = String(doc.node_id ?? doc._id ?? "");
                    if (similarity < minVectorSimilarity || !matchesNodeType(nodeId, nodeTypes)) continue;
                    scored.push({ nodeId, score: similarity, project: doc.project ?? "" });
                  }
                  continue;
                }
              }
            } catch {
              // Fall through to local cosine.
            }

            for (const doc of validDocs) {
              const embedding = doc.embedding as number[];
              let dot = 0;
              let normA = 0;
              let normB = 0;
              for (let index = 0; index < queryEmbedding.length; index += 1) {
                dot += queryEmbedding[index]! * embedding[index]!;
                normA += queryEmbedding[index]! * queryEmbedding[index]!;
                normB += embedding[index]! * embedding[index]!;
              }
              const denominator = Math.sqrt(normA) * Math.sqrt(normB);
              if (denominator === 0) continue;
              const similarity = dot / denominator;
              const nodeId = String(doc.node_id ?? doc._id ?? "");
              if (similarity < minVectorSimilarity || !matchesNodeType(nodeId, nodeTypes)) continue;
              scored.push({ nodeId, score: similarity, project: doc.project ?? "" });
            }
          }

          scored.sort((a, b) => b.score - a.score);
          const topK = scored.slice(0, k);
          vectorHitCount = scored.length;
          seedNodeIds = topK.map((entry) => entry.nodeId);
          for (const entry of topK) seedScoresMap.set(entry.nodeId, entry.score);
        }
      }
    } catch (err) {
      return reply.status(500).send({ error: "embedding generation failed", details: String(err) });
    }

    if (seedNodeIds.length === 0) {
      return {
        query: q,
        clusters: [],
        nodes: [],
        edges: [],
        stats: { vectorHits: vectorHitCount, seeds: 0, visited: 0, edges: 0 },
      };
    }

    const semanticEdgeFilters: Array<Record<string, unknown>> = [
      { similarity: { $gte: minSimilarity } },
      {
        $or: [
          { source_node_id: { $in: seedNodeIds } },
          { target_node_id: { $in: seedNodeIds } },
        ],
      },
    ];

    if (lakeRegexes.length > 0) {
      semanticEdgeFilters.push({
        $or: [
          ...lakeRegexes.map((pattern: RegExp) => ({ source_node_id: pattern })),
          ...lakeRegexes.map((pattern: RegExp) => ({ target_node_id: pattern })),
        ],
      });
    }

    const semanticEdges = await app.mongo.graphSemanticEdges.find({ $and: semanticEdgeFilters }).toArray();

    const adjacency = new Map<string, Array<{ neighbor: string; similarity: number; cost: number }>>();
    for (const edge of semanticEdges) {
      const sourceId = edge.source_node_id;
      const targetId = edge.target_node_id;
      const sim = edge.similarity;
      const cost = 1 - sim;

      const sn = adjacency.get(sourceId) ?? [];
      sn.push({ neighbor: targetId, similarity: sim, cost });
      adjacency.set(sourceId, sn);

      const tn = adjacency.get(targetId) ?? [];
      tn.push({ neighbor: sourceId, similarity: sim, cost });
      adjacency.set(targetId, tn);
    }

    const distances = new Map<string, number>();
    const predecessors = new Map<string, { from: string; edge: { similarity: number } }>();
    const visited = new Set<string>();
    const pq: Array<{ nodeId: string; cost: number }> = [];

    for (const nodeId of seedNodeIds) {
      const sim = seedScoresMap.get(nodeId) ?? 0.5;
      distances.set(nodeId, 0);
      pq.push({ nodeId, cost: 0 });
    }

    while (pq.length > 0 && visited.size < maxNodes) {
      pq.sort((a, b) => a.cost - b.cost);
      const current = pq.shift()!;
      if (visited.has(current.nodeId)) continue;
      if (current.cost > maxCost) continue;
      visited.add(current.nodeId);

      const neighbors = adjacency.get(current.nodeId) ?? [];
      for (const { neighbor, similarity, cost } of neighbors) {
        if (visited.has(neighbor)) continue;
        const newDist = current.cost + cost;
        if (newDist > maxCost) continue;
        const existingDist = distances.get(neighbor);
        if (existingDist === undefined || newDist < existingDist) {
          distances.set(neighbor, newDist);
          predecessors.set(neighbor, { from: current.nodeId, edge: { similarity } });
          pq.push({ nodeId: neighbor, cost: newDist });
        }
      }
    }

    const traversedEdges: Array<{ source: string; target: string; similarity: number }> = [];
    for (const [nodeId, pred] of predecessors) {
      traversedEdges.push({ source: pred.from, target: nodeId, similarity: pred.edge.similarity });
    }

    const lakeCluster = (id: string): string => {
      for (const lake of ["devel", "web", "bluesky", "knoxx-session"]) {
        if (id.startsWith(lake + ":")) return lake;
      }
      return "other";
    };

    const nodeTypeOf = (id: string): string => {
      const parts = id.split(":");
      return parts.length >= 2 ? parts[1] : "unknown";
    };

    const clusterMap = new Map<string, Array<typeof resultNodes extends (infer T)[] ? T : never>>();
    const resultNodes = [...visited].map(id => {
      const traversalCost = distances.get(id) ?? 0;
      const vectorScore = seedScoresMap.get(id) ?? 0;
      const score = vectorScore > 0 ? vectorScore : 1 / (1 + traversalCost);
      return {
        id,
        score,
        traversalCost,
        isSeed: seedScoresMap.has(id),
        lake: lakeCluster(id),
        nodeType: nodeTypeOf(id),
      };
    }).sort((a, b) => b.score - a.score).slice(0, maxNodes);

    for (const node of resultNodes) {
      const clusterKey = node.lake;
      if (!clusterMap.has(clusterKey)) clusterMap.set(clusterKey, []);
      clusterMap.get(clusterKey)!.push(node);
    }

    let textMap: Map<string, string> | null = null;
    if (includeText && resultNodes.length > 0) {
      textMap = new Map();
      const sample = resultNodes.slice(0, 20);
      const nodeDocs = await app.mongo.events.find(
        { id: { $in: sample.map((n: any) => n.id) } },
        { projection: { id: 1, text: 1, "extra.preview": 1 } }
      ).toArray();
      for (const doc of nodeDocs) {
        const txt = doc.text || (doc.extra as any)?.preview || "";
        if (txt) textMap.set(doc.id, typeof txt === "string" ? txt.slice(0, 300) : String(txt).slice(0, 300));
      }
    }

    const clusters = [...clusterMap.entries()].map(([lake, nodes]) => ({
      lake,
      count: nodes.length,
      topNodes: nodes.slice(0, 5).map((n: any) => ({
        id: n.id,
        score: n.score,
        nodeType: n.nodeType,
        text: textMap?.get(n.id) ?? null,
      })),
    })).sort((a, b) => b.count - a.count);

    return {
      query: q,
      clusters,
      nodes: resultNodes.map((n: any) => ({
        ...n,
        text: textMap?.get(n.id) ?? null,
      })),
      edges: traversedEdges,
      stats: {
        vectorHits: vectorHitCount,
        seeds: seedNodeIds.length,
        visited: visited.size,
        edges: traversedEdges.length,
        clusters: clusters.length,
      },
    };
  });
};
