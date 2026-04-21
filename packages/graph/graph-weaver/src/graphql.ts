import type http from "node:http";
import { buildSchema, graphql } from "graphql";
import type { ConfigPatch, RuntimeConfig } from "./config.js";

export type GraphQLContext = {
  headers: http.IncomingHttpHeaders;
};

export type GraphQLState = {
  adminToken: string | null;

  getConfig: () => RuntimeConfig;
  updateConfig: (patch: ConfigPatch) => Promise<RuntimeConfig> | RuntimeConfig;

  getStatus: () => {
    nodes: number;
    edges: number;
    seeds: number;
    weaver: { frontier: number; inFlight: number };
    render: RuntimeConfig["render"];
    scan: RuntimeConfig["scan"];
  };

  getGraphView: (opts?: { maxNodes?: number; maxEdges?: number }) => {
    nodes: Array<{
      id: string;
      kind: string;
      label: string;
      x: number;
      y: number;
      external: boolean;
      loadedByDefault: boolean;
      layer?: string;
      data?: unknown;
    }>;
    edges: Array<{
      source: string;
      target: string;
      kind: string;
      layer?: string;
      data?: unknown;
    }>;
    meta: {
      totalNodes: number;
      totalEdges: number;
      sampledNodes: boolean;
      sampledEdges: boolean;
    };
  };

  /**
   * Build a focused, layouted subgraph view around a root node.
   * Semantics: undirected hops across edges in the combined store.
   */
  getFocusedGraphView: (opts: {
    rootId: string;
    distance: number;
    maxNodes?: number;
    maxEdges?: number;
  }) => {
    nodes: Array<{
      id: string;
      kind: string;
      label: string;
      x: number;
      y: number;
      external: boolean;
      loadedByDefault: boolean;
      layer?: string;
      data?: unknown;
    }>;
    edges: Array<{
      source: string;
      target: string;
      kind: string;
      layer?: string;
      data?: unknown;
    }>;
    meta: {
      totalNodes: number;
      totalEdges: number;
      sampledNodes: boolean;
      sampledEdges: boolean;
    };
  };

  getNode: (id: string) => {
    id: string;
    kind: string;
    label: string;
    external: boolean;
    loadedByDefault: boolean;
    layer?: string;
    data?: unknown;
  } | null;

  getEdge: (id: string) => {
    id: string;
    source: string;
    target: string;
    kind: string;
    layer?: string;
    data?: unknown;
  } | null;

  listEdges: (filter: {
    source?: string;
    target?: string;
    kind?: string;
    limit: number;
  }) => Array<{
    id: string;
    source: string;
    target: string;
    kind: string;
    layer?: string;
    data?: unknown;
  }>;

  neighbors: (filter: {
    id: string;
    direction: "in" | "out" | "both";
    kind?: string;
    limit: number;
  }) => Array<{
    id: string;
    kind: string;
    label: string;
    external: boolean;
    loadedByDefault: boolean;
    layer?: string;
    data?: unknown;
  }>;

  searchNodes: (query: string, limit: number) => Array<{
    id: string;
    kind: string;
    label: string;
    external: boolean;
    loadedByDefault: boolean;
    layer?: string;
    data?: unknown;
  }>;

  nodePreview: (id: string, maxBytes: number) =>
    | Promise<{
        id: string;
        kind: string;
        format: string;
        contentType: string;
        language: string | null;
        body: string | null;
        truncated: boolean;
        bytes: number;
        status?: number;
        error?: string;
      } | null>
    | {
        id: string;
        kind: string;
        format: string;
        contentType: string;
        language: string | null;
        body: string | null;
        truncated: boolean;
        bytes: number;
        status?: number;
        error?: string;
      }
    | null;

  rescanNow: () => Promise<void> | void;
  seedUrls: (urls: string[]) => void;

  upsertUserNode: (input: {
    id: string;
    kind?: string;
    label?: string;
    external?: boolean;
    loadedByDefault?: boolean;
    data?: Record<string, unknown>;
  }) =>
    | Promise<{
        id: string;
        kind: string;
        label: string;
        external: boolean;
        loadedByDefault: boolean;
        layer?: string;
        data?: unknown;
      }>
    | {
        id: string;
        kind: string;
        label: string;
        external: boolean;
        loadedByDefault: boolean;
        layer?: string;
        data?: unknown;
      };

  upsertUserEdge: (input: {
    id: string;
    source: string;
    target: string;
    kind?: string;
    data?: Record<string, unknown>;
  }) =>
    | Promise<{
        id: string;
        source: string;
        target: string;
        kind: string;
        layer?: string;
        data?: unknown;
      }>
    | {
        id: string;
        source: string;
        target: string;
        kind: string;
        layer?: string;
        data?: unknown;
      };

  removeUserNode: (id: string) => Promise<boolean> | boolean;
  removeUserEdge: (id: string) => Promise<boolean> | boolean;

  /** Bulk update node positions (stored as data.pos) without clobbering derived node metadata. */
  layoutUpsertPositions: (inputs: Array<{ id: string; x: number; y: number }>) => Promise<number> | number;
};

const schema = buildSchema(`
  """A living graph of: local repo scan + ACO web weave + user mutations."""
  type Query {
    status: Status!
    config: Config!

    """A sampled, layouted view for rendering."""
    graphView(maxNodes: Int, maxEdges: Int): GraphView!

    """A focused, layouted view for rendering centered on a root node."""
    focusedGraphView(rootId: ID!, distance: Int = 1, maxNodes: Int, maxEdges: Int): GraphView!

    node(id: ID!): Node
    edge(id: ID!): Edge
    """Fetch a preview payload for a node (file head / url head)."""
    nodePreview(id: ID!, maxBytes: Int = 200000): NodePreview
    """Fetch preview payloads for many nodes in one request."""
    nodePreviews(ids: [ID!]!, maxBytes: Int = 200000): [NodePreview]
    edges(source: ID, target: ID, kind: String, limit: Int = 200): [Edge!]!
    neighbors(id: ID!, direction: String = "both", kind: String, limit: Int = 200): [Node!]!
    searchNodes(query: String!, limit: Int = 50): [Node!]!
  }

  type Mutation {
    """Update runtime config (and restart weaver/timers if needed)."""
    configUpdate(patch: ConfigPatchInput!): Config!

    """Re-scan the repo and reseed the weaver."""
    rescanNow: Status!

    """Add URLs to the weaver seed set."""
    weaverSeed(urls: [String!]!): Status!

    """Write to the user layer (future simulation state lives here)."""
    graphUpsertNode(input: NodeInput!): Node!
    graphUpsertEdge(input: EdgeInput!): Edge!
    graphRemoveNode(id: ID!): Boolean!
    graphRemoveEdge(id: ID!): Boolean!

    """Bulk-update node positions (stored as data.pos)."""
    layoutUpsertPositions(inputs: [NodePositionInput!]!): Int!
  }

  type Status {
    nodes: Int!
    edges: Int!
    seeds: Int!
    weaver: WeaverStatus!
    render: RenderConfig!
    scan: ScanConfig!
  }

  type WeaverStatus {
    frontier: Int!
    inFlight: Int!
  }

  type RenderConfig {
    maxRenderNodes: Int!
    maxRenderEdges: Int!
  }

  type WeaverConfig {
    ants: Int!
    dispatchIntervalMs: Int!
    maxConcurrency: Int!
    perHostMinIntervalMs: Int!
    revisitAfterMs: Int!
    alpha: Float!
    beta: Float!
    evaporation: Float!
    deposit: Float!
    requestTimeoutMs: Int!
  }

  type ScanConfig {
    maxFileBytes: Int!
    rescanIntervalMs: Int!
  }

  type Config {
    render: RenderConfig!
    weaver: WeaverConfig!
    scan: ScanConfig!
  }

  input RenderConfigPatch {
    maxRenderNodes: Int
    maxRenderEdges: Int
  }

  input WeaverConfigPatch {
    ants: Int
    dispatchIntervalMs: Int
    maxConcurrency: Int
    perHostMinIntervalMs: Int
    revisitAfterMs: Int
    alpha: Float
    beta: Float
    evaporation: Float
    deposit: Float
    requestTimeoutMs: Int
  }

  input ScanConfigPatch {
    maxFileBytes: Int
    rescanIntervalMs: Int
  }

  input ConfigPatchInput {
    render: RenderConfigPatch
    weaver: WeaverConfigPatch
    scan: ScanConfigPatch
  }

  type GraphMeta {
    totalNodes: Int!
    totalEdges: Int!
    sampledNodes: Boolean!
    sampledEdges: Boolean!
  }

  type GraphViewNode {
    id: ID!
    kind: String!
    label: String!
    x: Float!
    y: Float!
    external: Boolean!
    loadedByDefault: Boolean!
    layer: String!
    dataJson: String
  }

  type GraphViewEdge {
    source: ID!
    target: ID!
    kind: String!
    layer: String!
    dataJson: String
  }

  type GraphView {
    nodes: [GraphViewNode!]!
    edges: [GraphViewEdge!]!
    meta: GraphMeta!
  }

  type Node {
    id: ID!
    kind: String!
    label: String!
    external: Boolean!
    loadedByDefault: Boolean!
    layer: String!
    dataJson: String
  }

  type Edge {
    id: ID!
    source: ID!
    target: ID!
    kind: String!
    layer: String!
    dataJson: String
  }

  type NodePreview {
    id: ID!
    kind: String!
    """markdown | code | text | html | binary | none | error"""
    format: String!
    contentType: String!
    language: String
    body: String
    truncated: Boolean!
    bytes: Int!
    status: Int
    error: String
  }

  input NodeInput {
    id: ID!
    kind: String
    label: String
    external: Boolean
    loadedByDefault: Boolean
    dataJson: String
  }

  input EdgeInput {
    id: ID!
    source: ID!
    target: ID!
    kind: String
    dataJson: String
  }

  input NodePositionInput {
    id: ID!
    x: Float!
    y: Float!
  }
`);

function getBearer(headers: http.IncomingHttpHeaders): string | null {
  const raw = headers.authorization || headers.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const m = /^Bearer\s+(.+)$/i.exec(value);
  return m?.[1]?.trim() || null;
}

function assertAdmin(state: GraphQLState, ctx: GraphQLContext): void {
  if (!state.adminToken) return;
  const token = getBearer(ctx.headers);
  if (token !== state.adminToken) {
    throw new Error("unauthorized (set GRAPH_WEAVER_ADMIN_TOKEN or omit for dev)");
  }
}

function toDataJson(data: unknown): string | null {
  if (data === undefined) return null;
  try {
    return JSON.stringify(data);
  } catch {
    return JSON.stringify({ note: "unserializable" });
  }
}

function parseDataJson(dataJson: string | null | undefined): Record<string, unknown> | undefined {
  const raw = String(dataJson ?? "").trim();
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { value: parsed };
}

async function readBody(req: http.IncomingMessage, maxBytes = 2_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buf);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error("request too large");
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createGraphQLHandler(state: GraphQLState) {
  const root = {
    status: (_args: unknown, _ctx: GraphQLContext) => state.getStatus(),
    config: (_args: unknown, _ctx: GraphQLContext) => state.getConfig(),

    graphView: (
      args: { maxNodes?: number | null; maxEdges?: number | null },
      _ctx: GraphQLContext,
    ) => {
      const view = state.getGraphView({
        maxNodes: args.maxNodes ?? undefined,
        maxEdges: args.maxEdges ?? undefined,
      });

      return {
        nodes: view.nodes.map((n) => ({
          id: n.id,
          kind: n.kind,
          label: n.label,
          x: n.x,
          y: n.y,
          external: n.external,
          loadedByDefault: n.loadedByDefault,
          layer: n.layer || "unknown",
          dataJson: toDataJson(n.data),
        })),
        edges: view.edges.map((e) => ({
          source: e.source,
          target: e.target,
          kind: e.kind,
          layer: e.layer || "unknown",
          dataJson: toDataJson(e.data),
        })),
        meta: view.meta,
      };
    },

    focusedGraphView: (
      args: { rootId: string; distance?: number | null; maxNodes?: number | null; maxEdges?: number | null },
      _ctx: GraphQLContext,
    ) => {
      const rootId = String(args.rootId || "").trim();
      const distance = Math.max(0, Math.min(12, Math.floor(Number(args.distance ?? 1))));
      const view = state.getFocusedGraphView({
        rootId,
        distance,
        maxNodes: args.maxNodes ?? undefined,
        maxEdges: args.maxEdges ?? undefined,
      });

      return {
        nodes: view.nodes.map((n) => ({
          id: n.id,
          kind: n.kind,
          label: n.label,
          x: n.x,
          y: n.y,
          external: n.external,
          loadedByDefault: n.loadedByDefault,
          layer: n.layer || "unknown",
          dataJson: toDataJson(n.data),
        })),
        edges: view.edges.map((e) => ({
          source: e.source,
          target: e.target,
          kind: e.kind,
          layer: e.layer || "unknown",
          dataJson: toDataJson(e.data),
        })),
        meta: view.meta,
      };
    },

    node: (args: { id: string }, _ctx: GraphQLContext) => {
      const n = state.getNode(args.id);
      if (!n) return null;
      return {
        ...n,
        layer: n.layer || "unknown",
        dataJson: toDataJson(n.data),
      };
    },

    nodePreview: async (args: { id: string; maxBytes?: number | null }, _ctx: GraphQLContext) => {
      const maxBytes = Math.max(1024, Math.min(2_000_000, Math.floor(Number(args.maxBytes ?? 200_000))));
      return await state.nodePreview(args.id, maxBytes);
    },

    nodePreviews: async (args: { ids: string[]; maxBytes?: number | null }, _ctx: GraphQLContext) => {
      const maxBytes = Math.max(1024, Math.min(2_000_000, Math.floor(Number(args.maxBytes ?? 200_000))));
      const ids = Array.isArray(args.ids) ? args.ids.map((id) => String(id || "")).filter(Boolean) : [];
      return await Promise.all(ids.map((id) => state.nodePreview(id, maxBytes)));
    },

    edge: (args: { id: string }, _ctx: GraphQLContext) => {
      const e = state.getEdge(args.id);
      if (!e) return null;
      return {
        ...e,
        layer: e.layer || "unknown",
        dataJson: toDataJson(e.data),
      };
    },

    edges: (
      args: { source?: string | null; target?: string | null; kind?: string | null; limit?: number },
      _ctx: GraphQLContext,
    ) => {
      const rows = state.listEdges({
        source: args.source ?? undefined,
        target: args.target ?? undefined,
        kind: args.kind ?? undefined,
        limit: Math.max(1, Math.min(2000, Number(args.limit ?? 200))),
      });
      return rows.map((e) => ({
        ...e,
        layer: e.layer || "unknown",
        dataJson: toDataJson(e.data),
      }));
    },

    neighbors: (
      args: { id: string; direction?: string | null; kind?: string | null; limit?: number },
      _ctx: GraphQLContext,
    ) => {
      const dirRaw = String(args.direction ?? "both").toLowerCase();
      const direction = dirRaw === "in" || dirRaw === "out" ? dirRaw : "both";
      const rows = state.neighbors({
        id: args.id,
        direction,
        kind: args.kind ?? undefined,
        limit: Math.max(1, Math.min(2000, Number(args.limit ?? 200))),
      });
      return rows.map((n) => ({
        ...n,
        layer: n.layer || "unknown",
        dataJson: toDataJson(n.data),
      }));
    },

    searchNodes: (args: { query: string; limit?: number }, _ctx: GraphQLContext) => {
      const rows = state.searchNodes(args.query, Math.max(1, Math.min(500, Number(args.limit ?? 50))));
      return rows.map((n) => ({
        ...n,
        layer: n.layer || "unknown",
        dataJson: toDataJson(n.data),
      }));
    },

    // --- mutations
    configUpdate: async (args: { patch: ConfigPatch }, ctx: GraphQLContext) => {
      assertAdmin(state, ctx);
      return await state.updateConfig(args.patch);
    },

    rescanNow: async (_args: unknown, ctx: GraphQLContext) => {
      assertAdmin(state, ctx);
      await state.rescanNow();
      return state.getStatus();
    },

    weaverSeed: (args: { urls: string[] }, ctx: GraphQLContext) => {
      assertAdmin(state, ctx);
      state.seedUrls(args.urls);
      return state.getStatus();
    },

    graphUpsertNode: async (args: { input: { id: string; kind?: string; label?: string; external?: boolean; loadedByDefault?: boolean; dataJson?: string | null } }, ctx: GraphQLContext) => {
      assertAdmin(state, ctx);
      const data = parseDataJson(args.input.dataJson);
      const node = await state.upsertUserNode({
        id: args.input.id,
        kind: args.input.kind ?? undefined,
        label: args.input.label ?? undefined,
        external: args.input.external ?? undefined,
        loadedByDefault: args.input.loadedByDefault ?? undefined,
        data,
      });
      return {
        ...node,
        layer: node.layer || "unknown",
        dataJson: toDataJson(node.data),
      };
    },

    graphUpsertEdge: async (args: { input: { id: string; source: string; target: string; kind?: string; dataJson?: string | null } }, ctx: GraphQLContext) => {
      assertAdmin(state, ctx);
      const data = parseDataJson(args.input.dataJson);
      const edge = await state.upsertUserEdge({
        id: args.input.id,
        source: args.input.source,
        target: args.input.target,
        kind: args.input.kind ?? undefined,
        data,
      });
      return {
        ...edge,
        layer: edge.layer || "unknown",
        dataJson: toDataJson(edge.data),
      };
    },

    graphRemoveNode: async (args: { id: string }, ctx: GraphQLContext) => {
      assertAdmin(state, ctx);
      return await state.removeUserNode(args.id);
    },

    graphRemoveEdge: async (args: { id: string }, ctx: GraphQLContext) => {
      assertAdmin(state, ctx);
      return await state.removeUserEdge(args.id);
    },

    layoutUpsertPositions: async (args: { inputs: Array<{ id: string; x: number; y: number }> }, ctx: GraphQLContext) => {
      assertAdmin(state, ctx);
      return await state.layoutUpsertPositions(args.inputs);
    },
  };

  return async function handleGraphQL(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS (dev-friendly)
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type,authorization");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || "/graphql", `http://${req.headers.host || "localhost"}`);

      let query = "";
      let variables: Record<string, unknown> | undefined;
      let operationName: string | undefined;

      if (req.method === "GET") {
        query = String(url.searchParams.get("query") || "");
        const varsRaw = url.searchParams.get("variables");
        variables = varsRaw ? (JSON.parse(varsRaw) as Record<string, unknown>) : undefined;
        operationName = url.searchParams.get("operationName") || undefined;
      } else if (req.method === "POST") {
        const body = await readBody(req);
        const parsed = JSON.parse(body) as {
          query?: unknown;
          variables?: unknown;
          operationName?: unknown;
        };
        query = String(parsed.query || "");
        variables = (parsed.variables as Record<string, unknown> | undefined) ?? undefined;
        operationName = parsed.operationName ? String(parsed.operationName) : undefined;
      }

      if (!query.trim()) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ errors: [{ message: "missing query" }] }));
        return;
      }

      const result = await graphql({
        schema,
        source: query,
        rootValue: root,
        contextValue: { headers: req.headers } satisfies GraphQLContext,
        variableValues: variables,
        operationName,
      });

      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ errors: [{ message }] }));
    }
  };
}
