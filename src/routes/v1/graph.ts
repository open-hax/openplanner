import type { FastifyPluginAsync } from "fastify";
import { all } from "../../lib/duckdb.js";

type ExportNode = {
  id: string;
  kind: string;
  label: string;
  lake: string;
  nodeType: string;
  source: string;
  project: string;
  ts: string | null;
  data: Record<string, unknown>;
};

type ExportEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  lake: string;
  edgeType: string;
  sourceLake: string;
  targetLake: string;
  sourceEventId: string;
  data: Record<string, unknown>;
};

function toSafeNumber(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseExtra(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function splitCsv(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((row) => String(row ?? "").trim()).filter(Boolean);
  }
  return String(value ?? "")
    .split(",")
    .map((row) => row.trim())
    .filter(Boolean);
}

function basenameFromPath(value: string): string {
  const parts = value.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function normalizeUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    if (!url.pathname) url.pathname = "/";
    return url.toString();
  } catch {
    return raw;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function endpointLake(project: string, extra: Record<string, unknown>, key: "source_lake" | "target_lake"): string {
  return String(extra[key] ?? extra.lake ?? project ?? "web").trim() || project || "web";
}

function endpointFallbackValues(nodeIds: string[]): string[] {
  const values = new Set<string>();
  for (const nodeId of nodeIds) {
    if (nodeId.includes(":url:")) {
      values.add(nodeId.split(":url:")[1] ?? "");
      continue;
    }
    if (nodeId.includes(":file:")) {
      values.add(nodeId.split(":file:")[1] ?? "");
    }
  }
  return [...values].filter(Boolean);
}

function lakeFromNodeId(nodeId: string): string {
  const idx = nodeId.indexOf(":");
  return idx > 0 ? nodeId.slice(0, idx) : "unknown";
}

function deriveNodeId(project: string, extra: Record<string, unknown>, eventId: string): string {
  const explicit = String(extra.node_id ?? "").trim();
  if (explicit) return explicit;

  const normalizedUrl = normalizeUrl(extra.url);
  if (normalizedUrl) return `${project || "web"}:url:${normalizedUrl}`;

  const path = String(extra.path ?? extra.source_path ?? "").trim();
  if (path) return `${project || "devel"}:file:${path}`;

  return `graph-node:${eventId}`;
}

function deriveNodeType(project: string, extra: Record<string, unknown>): string {
  const explicit = String(extra.node_type ?? "").trim();
  if (explicit) return explicit;

  if (project === "web") {
    const visitStatus = String(extra.visit_status ?? "").trim();
    if (visitStatus === "visited" || visitStatus === "unvisited") return visitStatus;
    if (extra.lastVisitedAt || extra.lastVisitedAt || extra.discoveredAt) return "visited";
    return "unvisited";
  }

  if (project === "bluesky") {
    if (extra.did || extra.handle) return "user";
    if (extra.post_uri || extra.uri) return "post";
  }

  return String(extra.kind ?? "node").trim() || "node";
}

function deriveNodeKind(nodeType: string, extra: Record<string, unknown>): string {
  const explicit = String(extra.node_kind ?? "").trim();
  if (explicit) return explicit;
  if (extra.path || extra.source_path) return "file";
  if (extra.url) return "url";
  if (nodeType === "user" || nodeType === "post") return nodeType;
  return "node";
}

function deriveNodeLabel(nodeId: string, extra: Record<string, unknown>): string {
  const explicit = String(extra.label ?? extra.title ?? "").trim();
  if (explicit) return explicit;

  const path = String(extra.path ?? extra.source_path ?? "").trim();
  if (path) return basenameFromPath(path);

  const normalizedUrl = normalizeUrl(extra.url);
  if (normalizedUrl) {
    try {
      const url = new URL(normalizedUrl);
      return url.hostname + (url.pathname && url.pathname !== "/" ? url.pathname : "");
    } catch {
      return normalizedUrl;
    }
  }

  return nodeId;
}

function deriveEdgeSource(project: string, extra: Record<string, unknown>): string | null {
  const explicit = String(extra.source_node_id ?? "").trim();
  if (explicit) return explicit;
  const raw = normalizeUrl(extra.source);
  return raw ? `${endpointLake(project, extra, "source_lake")}:url:${raw}` : null;
}

function deriveEdgeTarget(project: string, extra: Record<string, unknown>): string | null {
  const explicit = String(extra.target_node_id ?? "").trim();
  if (explicit) return explicit;
  const raw = normalizeUrl(extra.target);
  return raw ? `${endpointLake(project, extra, "target_lake")}:url:${raw}` : null;
}

function deriveEdgeType(project: string, extra: Record<string, unknown>): string {
  const explicit = String(extra.edge_type ?? "").trim();
  if (explicit) return explicit;
  if (project === "web") return "visited_to_unvisited";
  return "relation";
}

function synthesizePlaceholderNode(nodeId: string, lake: string): ExportNode {
  const inferredLake = lake || lakeFromNodeId(nodeId);
  if (nodeId.includes(":url:")) {
    const url = nodeId.split(":url:")[1] ?? "";
    return {
      id: nodeId,
      kind: "url",
      label: deriveNodeLabel(nodeId, { url }),
      lake: inferredLake,
      nodeType: inferredLake === "web" ? "unvisited" : "node",
      source: "graph.export.placeholder",
      project: inferredLake,
      ts: null,
      data: {
        lake: inferredLake,
        node_id: nodeId,
        node_type: inferredLake === "web" ? "unvisited" : "node",
        url,
        synthesized: true,
      },
    };
  }

  if (nodeId.includes(":file:")) {
    const path = nodeId.split(":file:")[1] ?? "";
    return {
      id: nodeId,
      kind: "file",
      label: basenameFromPath(path),
      lake: inferredLake,
      nodeType: "node",
      source: "graph.export.placeholder",
      project: inferredLake,
      ts: null,
      data: {
        lake: inferredLake,
        node_id: nodeId,
        node_type: "node",
        path,
        synthesized: true,
      },
    };
  }

  return {
    id: nodeId,
    kind: "node",
    label: nodeId,
    lake: inferredLake,
    nodeType: "node",
    source: "graph.export.placeholder",
    project: inferredLake,
    ts: null,
    data: {
      lake: inferredLake,
      node_id: nodeId,
      node_type: "node",
      synthesized: true,
    },
  };
}

function mapNodeRow(row: Record<string, unknown>): ExportNode {
  const extra = parseExtra(row.extra);
  const project = String(row.project ?? extra.lake ?? "").trim() || "unknown";
  const id = deriveNodeId(project, extra, String(row.id ?? ""));
  const nodeType = deriveNodeType(project, extra);
  const kind = deriveNodeKind(nodeType, extra);
  const label = deriveNodeLabel(id, extra);

  return {
    id,
    kind,
    label,
    lake: project,
    nodeType,
    source: String(row.source ?? ""),
    project,
    ts: row.ts ? String(row.ts) : null,
    data: {
      ...extra,
      lake: project,
      node_id: id,
      node_type: nodeType,
      label,
      event_id: String(row.id ?? ""),
      source: String(row.source ?? ""),
      ts: row.ts ? String(row.ts) : null,
      path: typeof extra.path === "string" ? extra.path : (typeof extra.source_path === "string" ? extra.source_path : undefined),
      url: typeof extra.url === "string" ? normalizeUrl(extra.url) : undefined,
    },
  };
}

function mapEdgeRow(row: Record<string, unknown>): ExportEdge | null {
  const extra = parseExtra(row.extra);
  const project = String(row.project ?? extra.lake ?? "").trim() || "unknown";
  const source = deriveEdgeSource(project, extra);
  const target = deriveEdgeTarget(project, extra);
  if (!source || !target) return null;

  const edgeType = deriveEdgeType(project, extra);
  const sourceLake = String(extra.source_lake ?? lakeFromNodeId(source) ?? project).trim() || lakeFromNodeId(source);
  const targetLake = String(extra.target_lake ?? lakeFromNodeId(target) ?? project).trim() || lakeFromNodeId(target);

  return {
    id: String(extra.edge_id ?? row.id ?? `${source}->${target}`),
    source,
    target,
    kind: edgeType,
    lake: project,
    edgeType,
    sourceLake,
    targetLake,
    sourceEventId: String(row.id ?? ""),
    data: {
      ...extra,
      lake: project,
      edge_id: String(extra.edge_id ?? row.id ?? `${source}->${target}`),
      edge_type: edgeType,
      source_node_id: source,
      target_node_id: target,
      source_lake: sourceLake,
      target_lake: targetLake,
      source: String(row.source ?? ""),
      ts: row.ts ? String(row.ts) : null,
    },
  };
}

async function loadDuckGraphRows(conn: unknown, kind: "graph.node" | "graph.edge", projects: string[]): Promise<Record<string, unknown>[]> {
  let sql = "SELECT id, ts, source, kind, project, extra FROM events WHERE kind = ?";
  const params: unknown[] = [kind];
  if (projects.length > 0) {
    sql += ` AND project IN (${projects.map(() => "?").join(", ")})`;
    params.push(...projects);
  }
  sql += " ORDER BY ts DESC";
  return await all<Record<string, unknown>>((conn as any), sql, params);
}

async function searchDuckGraphNodeRows(
  conn: unknown,
  query: string,
  projects: string[],
  nodeTypes: string[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  let sql = `
    SELECT id, ts, source, kind, project, extra, text
    FROM events
    WHERE kind = 'graph.node'
  `;
  const params: unknown[] = [];

  if (projects.length > 0) {
    sql += ` AND project IN (${projects.map(() => "?").join(", ")})`;
    params.push(...projects);
  }

  if (nodeTypes.length > 0) {
    sql += ` AND json_extract_string(extra, '$.node_type') IN (${nodeTypes.map(() => "?").join(", ")})`;
    params.push(...nodeTypes);
  }

  if (query.trim()) {
    sql += `
      AND (
        text ILIKE ?
        OR json_extract_string(extra, '$.label') ILIKE ?
        OR json_extract_string(extra, '$.path') ILIKE ?
        OR json_extract_string(extra, '$.url') ILIKE ?
        OR json_extract_string(extra, '$.title') ILIKE ?
      )
    `;
    const like = `%${query}%`;
    params.push(like, like, like, like, like);
  }

  sql += " ORDER BY ts DESC LIMIT ?";
  params.push(limit);
  return await all<Record<string, unknown>>((conn as any), sql, params);
}

async function loadDuckIncidentEdgeRows(conn: unknown, nodeIds: string[], edgeTypes: string[], limit: number): Promise<Record<string, unknown>[]> {
  if (nodeIds.length === 0) return [];
  const fallbackValues = endpointFallbackValues(nodeIds);
  let sql = `
    SELECT id, ts, source, kind, project, extra
    FROM events
    WHERE kind = 'graph.edge'
      AND (
        json_extract_string(extra, '$.source_node_id') IN (${nodeIds.map(() => "?").join(", ")})
        OR json_extract_string(extra, '$.target_node_id') IN (${nodeIds.map(() => "?").join(", ")})
        ${fallbackValues.length > 0 ? `OR json_extract_string(extra, '$.source') IN (${fallbackValues.map(() => "?").join(", ")}) OR json_extract_string(extra, '$.target') IN (${fallbackValues.map(() => "?").join(", ")})` : ""}
      )
  `;
  const params: unknown[] = [...nodeIds, ...nodeIds, ...fallbackValues, ...fallbackValues];
  if (edgeTypes.length > 0) {
    sql += ` AND json_extract_string(extra, '$.edge_type') IN (${edgeTypes.map(() => "?").join(", ")})`;
    params.push(...edgeTypes);
  }
  sql += " ORDER BY ts DESC LIMIT ?";
  params.push(limit);
  return await all<Record<string, unknown>>((conn as any), sql, params);
}

async function loadMongoGraphRows(collection: any, kind: "graph.node" | "graph.edge", projects: string[]): Promise<Record<string, unknown>[]> {
  const query: Record<string, unknown> = { kind };
  if (projects.length > 0) query.project = { $in: projects };
  return await collection.find(query).sort({ ts: -1 }).toArray();
}

async function searchMongoGraphNodeRows(
  collection: any,
  query: string,
  projects: string[],
  nodeTypes: string[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  const mongoQuery: Record<string, unknown> = { kind: "graph.node" };
  if (projects.length > 0) mongoQuery.project = { $in: projects };
  if (nodeTypes.length > 0) mongoQuery["extra.node_type"] = { $in: nodeTypes };
  if (query.trim()) {
    const regex = new RegExp(escapeRegex(query), "i");
    mongoQuery.$or = [
      { text: regex },
      { "extra.label": regex },
      { "extra.path": regex },
      { "extra.url": regex },
      { "extra.title": regex },
    ];
  }
  return await collection.find(mongoQuery).sort({ ts: -1 }).limit(limit).toArray();
}

export const graphRoutes: FastifyPluginAsync = async (app) => {
  const storageBackend = (app as any).storageBackend ?? "duckdb";
  const duck = (app as any).duck as { conn: unknown } | undefined;

  app.get("/graph/stats", async () => {
    if (storageBackend === "mongodb") {
      const db = (app as any).mongo;
      const nodeCount = await db.events.countDocuments({ kind: "graph.node" });
      const edgeCount = await db.events.countDocuments({ kind: "graph.edge" });
      return { nodeCount, edgeCount, storageBackend: "mongodb" };
    }

    if (!duck) return { nodeCount: 0, edgeCount: 0, storageBackend: "duckdb" };

    const nodeRows = await all((duck as any).conn, "SELECT COUNT(*) as c FROM events WHERE kind = 'graph.node'");
    const edgeRows = await all((duck as any).conn, "SELECT COUNT(*) as c FROM events WHERE kind = 'graph.edge'");
    return {
      nodeCount: toSafeNumber((nodeRows[0] as any)?.c),
      edgeCount: toSafeNumber((edgeRows[0] as any)?.c),
      storageBackend: "duckdb",
    };
  });

  app.get("/graph/nodes", async (req: any) => {
    const url = req.query?.url;
    if (!url) return { error: "url query param required" };

    if (storageBackend === "mongodb") {
      const db = (app as any).mongo;
      const nodes = await db.events.find({ kind: "graph.node", "extra.url": normalizeUrl(url) }).limit(1).toArray();
      return { node: nodes[0] ?? null };
    }

    if (!duck) return { node: null };
    const nodes = await all((duck as any).conn, "SELECT * FROM events WHERE kind = 'graph.node' AND json_extract_string(extra, '$.url') = ?", [normalizeUrl(url)]);
    return { node: nodes[0] ?? null };
  });

  app.get("/graph/edges", async (req: any) => {
    const source = req.query?.source;
    const target = req.query?.target;

    if (storageBackend === "mongodb") {
      const db = (app as any).mongo;
      const query: any = { kind: "graph.edge" };
      if (source) query.$or = [{ "extra.source_node_id": source }, { "extra.source": source }];
      if (target) query.$and = [...(query.$and ?? []), { $or: [{ "extra.target_node_id": target }, { "extra.target": target }] }];
      const edges = await db.events.find(query).limit(100).toArray();
      return { edges };
    }

    if (!duck) return { edges: [] };

    let sql = "SELECT * FROM events WHERE kind = 'graph.edge'";
    const params: string[] = [];
    if (source) {
      sql += " AND (json_extract_string(extra, '$.source_node_id') = ? OR json_extract_string(extra, '$.source') = ?)";
      params.push(source, source);
    }
    if (target) {
      sql += " AND (json_extract_string(extra, '$.target_node_id') = ? OR json_extract_string(extra, '$.target') = ?)";
      params.push(target, target);
    }
    sql += " LIMIT 100";
    const edges = await all((duck as any).conn, sql, params);
    return { edges };
  });

  app.get("/graph/export", async (req: any) => {
    const projects = splitCsv(req.query?.projects);
    const nodeTypes = new Set(splitCsv(req.query?.nodeTypes));
    const edgeTypes = new Set(splitCsv(req.query?.edgeTypes));

    const [nodeRows, edgeRows] = storageBackend === "mongodb"
      ? await Promise.all([
          loadMongoGraphRows((app as any).mongo.events, "graph.node", projects),
          loadMongoGraphRows((app as any).mongo.events, "graph.edge", projects),
        ])
      : duck
        ? await Promise.all([
            loadDuckGraphRows((duck as any).conn, "graph.node", projects),
            loadDuckGraphRows((duck as any).conn, "graph.edge", projects),
          ])
        : [[], []];

    const nodes: ExportNode[] = nodeRows
      .map(mapNodeRow)
      .filter((node) => nodeTypes.size === 0 || nodeTypes.has(node.nodeType));

    const edges: ExportEdge[] = edgeRows
      .map(mapEdgeRow)
      .filter((edge): edge is ExportEdge => Boolean(edge))
      .filter((edge) => edgeTypes.size === 0 || edgeTypes.has(edge.edgeType));

    const nodeMap = new Map<string, ExportNode>(nodes.map((node) => [node.id, node]));
    for (const edge of edges) {
      if (!nodeMap.has(edge.source)) {
        nodeMap.set(edge.source, synthesizePlaceholderNode(edge.source, edge.sourceLake));
      }
      if (!nodeMap.has(edge.target)) {
        nodeMap.set(edge.target, synthesizePlaceholderNode(edge.target, edge.targetLake));
      }
    }

    return {
      ok: true,
      storageBackend,
      projects,
      nodes: [...nodeMap.values()],
      edges,
      counts: {
        nodes: nodeMap.size,
        edges: edges.length,
      },
    };
  });

  app.get("/graph/query", async (req: any) => {
    const query = String(req.query?.q ?? "").trim();
    const projects = splitCsv(req.query?.projects);
    const nodeTypes = splitCsv(req.query?.nodeTypes);
    const edgeTypes = splitCsv(req.query?.edgeTypes);
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit ?? 12)));
    const edgeLimit = Math.max(0, Math.min(200, Number(req.query?.edgeLimit ?? 40)));

    const nodeRows = storageBackend === "mongodb"
      ? await searchMongoGraphNodeRows((app as any).mongo.events, query, projects, nodeTypes, limit)
      : duck
        ? await searchDuckGraphNodeRows((duck as any).conn, query, projects, nodeTypes, limit)
        : [];

    const nodes = (storageBackend === "mongodb"
      ? (nodeRows as Record<string, unknown>[]).map(mapNodeRow)
      : (nodeRows as Record<string, unknown>[]).map(mapNodeRow));

    const nodeIds = nodes.map((node) => node.id);
    const fallbackValues = endpointFallbackValues(nodeIds);
    const edgeRows = edgeLimit > 0
      ? storageBackend === "mongodb"
        ? await (app as any).mongo.events.find({
            kind: "graph.edge",
            $or: [
              { "extra.source_node_id": { $in: nodeIds } },
              { "extra.target_node_id": { $in: nodeIds } },
              ...(fallbackValues.length > 0
                ? [{ "extra.source": { $in: fallbackValues } }, { "extra.target": { $in: fallbackValues } }]
                : []),
            ],
            ...(projects.length > 0 ? { project: { $in: projects } } : {}),
            ...(edgeTypes.length > 0 ? { "extra.edge_type": { $in: edgeTypes } } : {}),
          }).sort({ ts: -1 }).limit(edgeLimit).toArray()
        : duck
          ? await loadDuckIncidentEdgeRows((duck as any).conn, nodeIds, edgeTypes, edgeLimit)
          : []
      : [];

    const edges = (edgeRows as Record<string, unknown>[])
      .map(mapEdgeRow)
      .filter((edge): edge is ExportEdge => Boolean(edge));

    return {
      ok: true,
      storageBackend,
      query,
      projects,
      nodeTypes,
      edgeTypes,
      nodes,
      edges,
      counts: {
        nodes: nodes.length,
        edges: edges.length,
      },
    };
  });

  app.post("/graph/traverse", async (req: any) => {
    const from = req.body?.from;
    const depth = req.body?.depth ?? 2;
    const limit = req.body?.limit ?? 50;
    if (!from) return { error: "from is required" };

    if (storageBackend === "mongodb") {
      const db = (app as any).mongo;
      const visited = new Set<string>();
      const queue: Array<{ url: string; distance: number }> = [{ url: from, distance: 0 }];
      visited.add(from);
      const results: Array<{ url: string; distance: number }> = [];

      while (queue.length > 0 && results.length < limit) {
        const current = queue.shift()!;
        if (current.distance > 0) results.push(current);
        if (current.distance >= depth) continue;

        const edges = await db.events.find({ kind: "graph.edge", "extra.source": current.url }).toArray();
        for (const edge of edges) {
          const targetUrl = edge.extra?.target;
          if (targetUrl && !visited.has(targetUrl)) {
            visited.add(targetUrl);
            queue.push({ url: targetUrl, distance: current.distance + 1 });
          }
        }
      }
      return { from, depth, limit, results };
    }

    if (!duck) return { from, depth, limit, results: [] };

    const visited = new Set<string>();
    const queue: Array<{ url: string; distance: number }> = [{ url: from, distance: 0 }];
    visited.add(from);
    const results: Array<{ url: string; distance: number }> = [];

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;
      if (current.distance > 0) results.push(current);
      if (current.distance >= depth) continue;

      const edges = await all((duck as any).conn, "SELECT json_extract_string(extra, '$.target') as target FROM events WHERE kind = 'graph.edge' AND json_extract_string(extra, '$.source') = ?", [current.url]);
      for (const edge of edges as Array<{ target: string }>) {
        if (edge.target && !visited.has(edge.target)) {
          visited.add(edge.target);
          queue.push({ url: edge.target, distance: current.distance + 1 });
        }
      }
    }
    return { from, depth, limit, results };
  });
};
