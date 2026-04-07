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

export const graphRoutes: FastifyPluginAsync = async (app) => {
  // Graph export for multi-lake graph weaving
  app.get("/graph/export", async (req: any, reply) => {
    const projectsParam = typeof req.query?.projects === "string" ? req.query.projects.trim() : "";
    const includeLayout = req.query?.includeLayout === "true" || req.query?.includeLayout === true;
    
    const projects = projectsParam ? projectsParam.split(",").map((p: string) => p.trim()).filter(Boolean) : [];
    const projectFilter = projects.length > 0 ? { project: { $in: projects } } : {};

    // Query nodes and edges in parallel
    const [nodeDocs, edgeDocs, layoutRows] = await Promise.all([
      app.mongo.events.find({ kind: "graph.node", ...projectFilter }).toArray(),
      app.mongo.events.find({ kind: "graph.edge", ...projectFilter }).toArray(),
      includeLayout ? app.mongo.graphLayoutOverrides.find(projectFilter).toArray() : Promise.resolve([]),
    ]);

    // Build layout lookup
    const layoutById = new Map<string, { x: number; y: number }>();
    for (const row of layoutRows) {
      if (typeof row.node_id === "string" && typeof row.x === "number" && typeof row.y === "number") {
        layoutById.set(row.node_id, { x: row.x, y: row.y });
      }
    }

    // Transform nodes
    const nodes: ExportNode[] = nodeDocs.map((doc: any) => {
      const extra = doc.extra ?? {};
      const nodeId = extra.node_id ?? doc.message ?? doc._id;
      const layout = layoutById.get(nodeId);
      return {
        id: nodeId,
        kind: extra.node_kind ?? "unknown",
        label: extra.label ?? extra.path ?? doc.message ?? nodeId,
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

    // Transform edges
    const edges: ExportEdge[] = edgeDocs.map((doc: any) => {
      const extra = doc.extra ?? {};
      return {
        id: extra.edge_id ?? doc._id,
        source: extra.source_node_id ?? "",
        target: extra.target_node_id ?? "",
        kind: extra.edge_type ?? "unknown",
        lake: extra.lake ?? doc.project,
        edgeType: extra.edge_type,
        sourceLake: extra.source_lake,
        targetLake: extra.target_lake,
        data: {
          source: extra.source,
          target: extra.target,
          source_host: extra.source_host,
          target_host: extra.target_host,
          discovery_channel: extra.discovery_channel,
          anchor_text: extra.anchor_text,
        },
      };
    }).filter((e: ExportEdge) => e.source && e.target);

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

    if (nodeIds.length === 0) {
      return { edges: [] };
    }

    const filter: Record<string, unknown> = {
      $or: [
        { source_node_id: { $in: nodeIds.map(String) } },
        { target_node_id: { $in: nodeIds.map(String) } },
      ],
    };
    if (edgeKinds) {
      filter.edge_kind = { $in: edgeKinds };
    }

    const rows = await app.mongo.graphEdges.find(filter).limit(limit).toArray();

    const edges = rows.map((row: any) => ({
      source: row.source_node_id,
      target: row.target_node_id,
      edgeKind: row.edge_kind,
      layer: row.layer,
      data: row.data,
      updatedAt: row.updated_at,
    }));

    return { edges };
  });

  // Get all edges for graph traversal (paginated)
  app.get("/graph/semantic-edges", async (req: any, reply) => {
    const project = typeof req.query?.project === "string" ? req.query.project.trim() : undefined;
    const minSimilarity = Number(req.query?.minSimilarity ?? -1);
    const limit = Math.max(1, Math.min(50000, Number(req.query?.limit ?? 10000)));

    const filter: Record<string, unknown> = {
      similarity: { $gte: minSimilarity },
    };
    if (project) filter.project = project;

    const rows = await app.mongo.graphSemanticEdges.find(filter).limit(limit).toArray();

    const edges = rows.map((row: any) => ({
      source: row.source_node_id,
      target: row.target_node_id,
      similarity: row.similarity,
      edgeType: row.edge_type,
    }));

    return { ok: true, count: edges.length, edges };
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
    seedNodeIds.forEach((id: string) => allNodeIds.add(String(id)));

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
};
