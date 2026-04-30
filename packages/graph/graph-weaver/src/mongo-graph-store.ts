import { MongoClient, type Collection, type Db, type Document, type WithId } from "mongodb";

import type { GraphEdge, GraphNode, GraphSnapshot } from "./graph.js";

export type MongoGraphStoreConfig = {
  uri: string;
  dbName: string;
  nodeCollectionName?: string;
  edgeCollectionName?: string;
  appName?: string;
  connectAttempts?: number;
  connectDelayMs?: number;
};

type StoredNode = GraphNode & { store: string };
type StoredEdge = GraphEdge & { store: string };

export type DaimoiTrailSnapshot = {
  id: string;
  queryHash: string;
  queryText: string;
  daimoiId: string;
  originNodeId: string;
  currentNodeId: string;
  nodeIds: string[];
  edgeKeys: string[];
  trail: string[];
  activation: number;
  traversalCost: number;
  emittedAt: string;
  decayHalfLifeSeconds: number;
  data: Record<string, unknown>;
};

type DaimoiTrailDocument = Document & {
  _id?: unknown;
  query_hash?: string;
  query_text?: string;
  daimoi_id?: string;
  origin_node_id?: string;
  current_node_id?: string;
  node_ids?: string[];
  edge_keys?: string[];
  trail?: string[];
  activation?: number;
  traversal_cost?: number;
  emitted_at?: Date | string;
  decay_half_life_seconds?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripMongoId<T extends Document>(doc: WithId<T>): Omit<T, "_id"> {
  const { _id: _ignored, ...rest } = doc;
  return rest as Omit<T, "_id">;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((row) => String(row || "")).filter(Boolean) : [];
}

export class MongoGraphStore {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private nodes: Collection<StoredNode> | null = null;
  private edges: Collection<StoredEdge> | null = null;

  constructor(private readonly config: MongoGraphStoreConfig) {}

  async connect(): Promise<void> {
    if (this.client) return;

    const attempts = Math.max(1, this.config.connectAttempts ?? 20);
    const delayMs = Math.max(100, this.config.connectDelayMs ?? 1500);

    let lastErr: unknown = null;
    for (let i = 1; i <= attempts; i += 1) {
      try {
        const client = new MongoClient(this.config.uri, {
          appName: this.config.appName ?? "devel-graph-weaver",
          serverSelectionTimeoutMS: 5000,
        });
        await client.connect();

        const db = client.db(this.config.dbName);
        const nodes = db.collection<StoredNode>(this.config.nodeCollectionName ?? "graph_nodes");
        const edges = db.collection<StoredEdge>(this.config.edgeCollectionName ?? "graph_edges");

        await nodes.createIndex({ store: 1, id: 1 }, { unique: true });
        await edges.createIndex({ store: 1, id: 1 }, { unique: true });
        await edges.createIndex({ store: 1, source: 1 });
        await edges.createIndex({ store: 1, target: 1 });

        this.client = client;
        this.db = db;
        this.nodes = nodes;
        this.edges = edges;
        return;
      } catch (err) {
        lastErr = err;
        if (i < attempts) {
          await sleep(delayMs);
        }
      }
    }

    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(`failed to connect to MongoDB after ${attempts} attempts: ${message}`);
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
    this.db = null;
    this.nodes = null;
    this.edges = null;
  }

  private getNodes(): Collection<StoredNode> {
    if (!this.nodes) throw new Error("MongoGraphStore not connected");
    return this.nodes;
  }

  private getEdges(): Collection<StoredEdge> {
    if (!this.edges) throw new Error("MongoGraphStore not connected");
    return this.edges;
  }

  private getDb(): Db {
    if (!this.db) throw new Error("MongoGraphStore not connected");
    return this.db;
  }

  async loadStore(store: string): Promise<GraphSnapshot> {
    const [nodesDocs, edgesDocs] = await Promise.all([
      this.getNodes().find({ store }).toArray(),
      this.getEdges().find({ store }).toArray(),
    ]);

    return {
      nodes: nodesDocs.map((doc) => {
        const row = stripMongoId(doc);
        const { store: _store, ...node } = row;
        return node;
      }),
      edges: edgesDocs.map((doc) => {
        const row = stripMongoId(doc);
        const { store: _store, ...edge } = row;
        return edge;
      }),
    };
  }

  async isStoreEmpty(store: string): Promise<boolean> {
    const [nodeCount, edgeCount] = await Promise.all([
      this.getNodes().countDocuments({ store }, { limit: 1 }),
      this.getEdges().countDocuments({ store }, { limit: 1 }),
    ]);
    return nodeCount === 0 && edgeCount === 0;
  }

  async upsertNode(store: string, node: GraphNode): Promise<void> {
    await this.getNodes().replaceOne({ store, id: node.id }, { store, ...node }, { upsert: true });
  }

  async bulkUpsertNodes(store: string, nodes: GraphNode[]): Promise<void> {
    if (nodes.length === 0) return;
    await this.getNodes().bulkWrite(
      nodes.map((node) => ({
        replaceOne: {
          filter: { store, id: node.id },
          replacement: { store, ...node },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async upsertEdge(store: string, edge: GraphEdge): Promise<void> {
    await this.getEdges().replaceOne({ store, id: edge.id }, { store, ...edge }, { upsert: true });
  }

  async bulkUpsertEdges(store: string, edges: GraphEdge[]): Promise<void> {
    if (edges.length === 0) return;
    await this.getEdges().bulkWrite(
      edges.map((edge) => ({
        replaceOne: {
          filter: { store, id: edge.id },
          replacement: { store, ...edge },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async removeNode(store: string, id: string): Promise<void> {
    await Promise.all([
      this.getNodes().deleteOne({ store, id }),
      this.getEdges().deleteMany({
        store,
        $or: [{ source: id }, { target: id }],
      }),
    ]);
  }

  async bulkRemoveNodes(store: string, ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return;

    await Promise.all([
      this.getNodes().deleteMany({ store, id: { $in: uniqueIds } }),
      this.getEdges().deleteMany({
        store,
        $or: [{ source: { $in: uniqueIds } }, { target: { $in: uniqueIds } }],
      }),
    ]);
  }

  async removeEdge(store: string, id: string): Promise<void> {
    await this.getEdges().deleteOne({ store, id });
  }

  async listDaimoiTrailSnapshots(filter: {
    limit: number;
    minActivation?: number;
    query?: string;
    lookbackSeconds?: number;
  }): Promise<DaimoiTrailSnapshot[]> {
    const mongoFilter: Record<string, unknown> = {};
    if (typeof filter.minActivation === "number") {
      mongoFilter.activation = { $gte: filter.minActivation };
    }
    if (typeof filter.lookbackSeconds === "number" && filter.lookbackSeconds > 0) {
      mongoFilter.emitted_at = { $gte: new Date(Date.now() - (filter.lookbackSeconds * 1000)) };
    }
    const query = String(filter.query ?? "").trim();
    if (query) {
      mongoFilter.query_text = { $regex: escapeRegex(query), $options: "i" };
    }

    const rows = await this.getDb()
      .collection<DaimoiTrailDocument>("graph_daimoi_trails")
      .find(mongoFilter)
      .sort({ emitted_at: -1 })
      .limit(Math.max(1, Math.min(2000, Math.floor(filter.limit))))
      .toArray();

    return rows.map((row) => {
      const emittedAt = row.emitted_at instanceof Date ? row.emitted_at.toISOString() : String(row.emitted_at ?? "");
      return {
        id: String(row._id ?? ""),
        queryHash: String(row.query_hash ?? ""),
        queryText: String(row.query_text ?? ""),
        daimoiId: String(row.daimoi_id ?? ""),
        originNodeId: String(row.origin_node_id ?? ""),
        currentNodeId: String(row.current_node_id ?? ""),
        nodeIds: asStringArray(row.node_ids),
        edgeKeys: asStringArray(row.edge_keys),
        trail: asStringArray(row.trail),
        activation: Number(row.activation ?? 0),
        traversalCost: Number(row.traversal_cost ?? 0),
        emittedAt,
        decayHalfLifeSeconds: Number(row.decay_half_life_seconds ?? 0),
        data: stripMongoId(row as WithId<DaimoiTrailDocument>) as Record<string, unknown>,
      };
    });
  }
}
