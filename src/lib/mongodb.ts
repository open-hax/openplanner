/**
 * MongoDB Storage Backend for OpenPlanner
 *
 * Provides the same interface as DuckDB but with MongoDB as the storage layer.
 * Enables horizontal scaling, better JSON handling, and real-time subscriptions.
 *
 * TTL Indexes:
 *   - Events can auto-expire after a configurable retention period
 *   - Set MONGODB_EVENTS_TTL_SECONDS=2592000 (30 days) to enable
 *   - Set to 0 or omit to disable TTL
 */

import { MongoClient, Db, Collection, IndexDirection } from "mongodb";

// Default TTL: 30 days in seconds (disabled if 0)
const DEFAULT_EVENTS_TTL_SECONDS = 0;
// Compact memories: 90 days default (they're summarized, so keep longer)
const DEFAULT_COMPACTED_TTL_SECONDS = 0;

export interface MongoConfig {
  uri: string;
  dbName: string;
  eventsCollection: string;
  compactedCollection: string;
  vectorHotCollection: string;
  vectorCompactCollection: string;
  graphLayoutCollection: string;
  graphNodeEmbeddingCollection: string;
  /** TTL for events in seconds (0 = no TTL) */
  eventsTtlSeconds?: number;
  /** TTL for compacted memories in seconds (0 = no TTL) */
  compactedTtlSeconds?: number;
}

export interface MongoVectorDocument {
  _id: string;
  parent_id: string;
  text: string;
  embedding: number[];
  ts: Date;
  source: string;
  kind: string;
  project: string | null;
  session: string | null;
  author: string | null;
  role: string | null;
  model: string | null;
  visibility: string | null;
  title: string | null;
  embedding_model: string | null;
  embedding_dimensions: number | null;
  search_tier: "hot" | "compact";
  chunk_id: string | null;
  chunk_index: number | null;
  chunk_count: number | null;
  normalized_format: string | null;
  normalized_estimated_tokens: number | null;
  raw_estimated_tokens: number | null;
  seed_id: string | null;
  member_count: number | null;
  char_count: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MongoVectorPartitionDocument {
  _id: string;
  tier: "hot" | "compact";
  model: string;
  dimensions: number;
  collectionName: string;
  searchIndexName: string;
  searchIndexStatus: "pending" | "ready" | "error";
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EventDocument {
  _id: string;
  id: string;
  ts: Date;
  source: string;
  kind: string;
  project: string | null;
  session: string | null;
  message: string | null;
  role: string | null;
  author: string | null;
  model: string | null;
  tags: unknown | null;
  text: string | null;
  attachments: unknown[] | null;
  extra: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompactedMemoryDocument {
  _id: string;
  id: string;
  ts: Date;
  source: string;
  kind: string;
  project: string | null;
  session: string | null;
  seed_id: string | null;
  member_count: number;
  char_count: number;
  embedding_model: string | null;
  text: string;
  members: unknown[] | null;
  extra: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphLayoutOverrideDocument {
  _id: string;
  node_id: string;
  project: string | null;
  x: number;
  y: number;
  layout_source: string | null;
  layout_version: string | null;
  updated_at: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphNodeEmbeddingDocument {
  _id: string;
  node_id: string;
  source_event_id: string;
  project: string | null;
  embedding_model: string | null;
  embedding_dimensions: number;
  embedding: number[];
  chunk_index: number;
  chunk_count: number;
  text?: string;
  updated_at: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphSemanticEdgeDocument {
  _id: string;
  source_node_id: string;
  target_node_id: string;
  similarity: number;
  edge_type: string;
  project: string | null;
  embedding_model: string | null;
  graph_version: string | null;
  clustering_version: string | null;
  source: string | null;
  updated_at: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphEdgeDocument {
  _id: string;
  source_node_id: string;
  target_node_id: string;
  edge_kind: string; // structural edge kind (e.g., "visited_to_unvisited", "code_dep", etc.)
  layer: string | null;
  project: string | null;
  source: string | null; // where this edge came from (e.g., "graph-weaver")
  data: Record<string, unknown> | null;
  updated_at: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface GraphClusterMembershipDocument {
  _id: string; // `${clustering_version}::${node_id}`
  node_id: string;
  graph_version: string | null;
  clustering_version: string | null;
  cluster_id: string | null;
  cluster_size: number | null;
  embedding_model: string | null;
  updated_at: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SemanticGraphRunDocument {
  _id: string;
  run_id: string;
  embedding_model: string | null;
  embedding_dimensions: number | null;
  node_count: number | null;
  final_k: number | null;
  candidate_factor: number | null;
  candidate_engine: string | null;
  rerank_provider: string | null;
  graph_version: string | null;
  clustering_version: string | null;
  status: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  metrics: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GardenDocument {
  _id: string;
  garden_id: string;
  title: string;
  description: string | null;
  theme?: string;
  default_language?: string;
  target_languages?: string[];
  source_filter?: {
    project?: string;
    kind?: string;
    domain?: string;
    path_prefix?: string;
  } | null;
  nav?: {
    items: {
      label: string;
      path: string;
      children?: { label: string; path: string }[];
    }[];
  } | null;
  owner_id?: string;
  created_by?: string;
  status?: "draft" | "active" | "archived";
  stats?: {
    documents_count: number;
    translations_count: number;
    last_published_at?: Date;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MongoConnection {
  client: MongoClient;
  db: Db;
  events: Collection<EventDocument>;
  compacted: Collection<CompactedMemoryDocument>;
  hotVectors: Collection<MongoVectorDocument>;
  compactVectors: Collection<MongoVectorDocument>;
  vectorPartitions: Collection<MongoVectorPartitionDocument>;
  graphLayoutOverrides: Collection<GraphLayoutOverrideDocument>;
  graphNodeEmbeddings: Collection<GraphNodeEmbeddingDocument>;
  graphSemanticEdges: Collection<GraphSemanticEdgeDocument>;
  graphEdges: Collection<GraphEdgeDocument>;
  graphClusterMemberships: Collection<GraphClusterMembershipDocument>;
  semanticGraphRuns: Collection<SemanticGraphRunDocument>;
  gardens: Collection<GardenDocument>;
  ftsEnabled: boolean; // MongoDB has text search, always true
}

/**
 * Connect to MongoDB and create indexes.
 */
export async function openMongoDB(config: MongoConfig): Promise<MongoConnection> {
  const client = new MongoClient(config.uri, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 30000,
    maxPoolSize: 50,
  });

  await client.connect();
  const db = client.db(config.dbName);

  const events = db.collection<EventDocument>(config.eventsCollection);
  const compacted = db.collection<CompactedMemoryDocument>(config.compactedCollection);
  const hotVectors = db.collection<MongoVectorDocument>(config.vectorHotCollection);
  const compactVectors = db.collection<MongoVectorDocument>(config.vectorCompactCollection);
  const vectorPartitions = db.collection<MongoVectorPartitionDocument>("vector_partitions");
  const graphLayoutOverrides = db.collection<GraphLayoutOverrideDocument>(config.graphLayoutCollection);
  const graphNodeEmbeddings = db.collection<GraphNodeEmbeddingDocument>(config.graphNodeEmbeddingCollection);
  const graphSemanticEdges = db.collection<GraphSemanticEdgeDocument>("graph_semantic_edges");
  const graphEdges = db.collection<GraphEdgeDocument>("graph_edges");
  const graphClusterMemberships = db.collection<GraphClusterMembershipDocument>("graph_cluster_memberships");
  const semanticGraphRuns = db.collection<SemanticGraphRunDocument>("semantic_graph_runs");
  const gardens = db.collection<GardenDocument>("gardens");

  // Create indexes for events
  await events.createIndex({ ts: -1 });
  await events.createIndex({ source: 1, ts: -1 });
  await events.createIndex({ kind: 1, ts: -1 });
  await events.createIndex({ project: 1, ts: -1 });
  await events.createIndex({ session: 1, ts: -1 });
  await events.createIndex({ "text": "text" }); // Full-text search index

  // Create indexes for compacted_memories
  await compacted.createIndex({ ts: -1 });
  await compacted.createIndex({ source: 1, ts: -1 });
  await compacted.createIndex({ kind: 1, ts: -1 });
  await compacted.createIndex({ project: 1, ts: -1 });
  await compacted.createIndex({ "text": "text" }); // Full-text search index

  await hotVectors.createIndex({ parent_id: 1, chunk_index: 1 });
  await hotVectors.createIndex({ ts: -1 });
  await hotVectors.createIndex({ source: 1, ts: -1 });
  await hotVectors.createIndex({ kind: 1, ts: -1 });
  await hotVectors.createIndex({ project: 1, ts: -1 });
  await hotVectors.createIndex({ session: 1, ts: -1 });
  await hotVectors.createIndex({ visibility: 1, ts: -1 });
  await hotVectors.createIndex({ embedding_model: 1, embedding_dimensions: 1, ts: -1 });

  await compactVectors.createIndex({ parent_id: 1 });
  await compactVectors.createIndex({ ts: -1 });
  await compactVectors.createIndex({ source: 1, ts: -1 });
  await compactVectors.createIndex({ kind: 1, ts: -1 });
  await compactVectors.createIndex({ project: 1, ts: -1 });
  await compactVectors.createIndex({ session: 1, ts: -1 });
  await compactVectors.createIndex({ visibility: 1, ts: -1 });
  await compactVectors.createIndex({ embedding_model: 1, embedding_dimensions: 1, ts: -1 });

  await vectorPartitions.createIndex({ collectionName: 1 }, { unique: true });
  await vectorPartitions.createIndex({ tier: 1, model: 1, dimensions: 1 }, { unique: true });

  await graphLayoutOverrides.createIndex({ node_id: 1 }, { unique: true });
  await graphLayoutOverrides.createIndex({ project: 1, updated_at: -1 as IndexDirection });
  await graphLayoutOverrides.createIndex({ updated_at: -1 as IndexDirection });
  await graphLayoutOverrides.createIndex({ layout_source: 1, updated_at: -1 as IndexDirection });

  await graphNodeEmbeddings.createIndex({ node_id: 1, embedding_model: 1, embedding_dimensions: 1 }, { unique: true });
  await graphNodeEmbeddings.createIndex({ source_event_id: 1, embedding_model: 1, embedding_dimensions: 1 });
  await graphNodeEmbeddings.createIndex({ project: 1, updated_at: -1 as IndexDirection });
  await graphNodeEmbeddings.createIndex({ updated_at: -1 as IndexDirection });

  // Semantic edges for graph clustering
  await graphSemanticEdges.createIndex({ source_node_id: 1, target_node_id: 1 }, { unique: true });
  await graphSemanticEdges.createIndex({ source_node_id: 1, updated_at: -1 as IndexDirection });
  await graphSemanticEdges.createIndex({ target_node_id: 1, updated_at: -1 as IndexDirection });
  await graphSemanticEdges.createIndex({ similarity: -1 as IndexDirection });
  await graphSemanticEdges.createIndex({ graph_version: 1, updated_at: -1 as IndexDirection });
  await graphSemanticEdges.createIndex({ clustering_version: 1, updated_at: -1 as IndexDirection });

  // ALL graph edges (structural + semantic) from graph-weaver
  await graphEdges.createIndex({ source_node_id: 1, target_node_id: 1, edge_kind: 1 }, { unique: true });
  await graphEdges.createIndex({ source_node_id: 1, updated_at: -1 as IndexDirection });
  await graphEdges.createIndex({ target_node_id: 1, updated_at: -1 as IndexDirection });
  await graphEdges.createIndex({ edge_kind: 1, updated_at: -1 as IndexDirection });
  await graphEdges.createIndex({ project: 1, updated_at: -1 as IndexDirection });

  // Cluster memberships
  await graphClusterMemberships.createIndex({ node_id: 1 });
  await graphClusterMemberships.createIndex({ graph_version: 1, cluster_id: 1 });
  await graphClusterMemberships.createIndex({ clustering_version: 1, cluster_id: 1 });

  // Semantic graph runs
  await semanticGraphRuns.createIndex({ run_id: 1 }, { unique: true });
  await semanticGraphRuns.createIndex({ graph_version: 1 }, { unique: true });
  await semanticGraphRuns.createIndex({ status: 1, finished_at: -1 as IndexDirection });

  // Gardens collection for published websites
  await gardens.createIndex({ garden_id: 1 }, { unique: true });
  await gardens.createIndex({ owner_id: 1, createdAt: -1 as IndexDirection });
  await gardens.createIndex({ status: 1, createdAt: -1 as IndexDirection });

  // TTL index for events (auto-expire old signals)
  const eventsTtl = config.eventsTtlSeconds ?? DEFAULT_EVENTS_TTL_SECONDS;
  if (eventsTtl > 0) {
    // Use createdAt field for TTL - documents expire after N seconds from creation
    await events.createIndex(
      { createdAt: 1 },
      { 
        expireAfterSeconds: eventsTtl,
        name: "events_ttl",
        background: true,
      }
    );
    console.log(`[mongodb] Created TTL index on events (expireAfterSeconds: ${eventsTtl})`);
  }

  // TTL index for compacted_memories (longer retention, optional)
  const compactedTtl = config.compactedTtlSeconds ?? DEFAULT_COMPACTED_TTL_SECONDS;
  if (compactedTtl > 0) {
    await compacted.createIndex(
      { createdAt: 1 },
      { 
        expireAfterSeconds: compactedTtl,
        name: "compacted_ttl",
        background: true,
      }
    );
    console.log(`[mongodb] Created TTL index on compacted_memories (expireAfterSeconds: ${compactedTtl})`);
  }

  if (eventsTtl > 0) {
    await hotVectors.createIndex(
      { createdAt: 1 },
      {
        expireAfterSeconds: eventsTtl,
        name: "hot_vectors_ttl",
        background: true,
      },
    );
    console.log(`[mongodb] Created TTL index on hot vectors (expireAfterSeconds: ${eventsTtl})`);
  }

  if (compactedTtl > 0) {
    await compactVectors.createIndex(
      { createdAt: 1 },
      {
        expireAfterSeconds: compactedTtl,
        name: "compact_vectors_ttl",
        background: true,
      },
    );
    console.log(`[mongodb] Created TTL index on compact vectors (expireAfterSeconds: ${compactedTtl})`);
  }

  return {
    client,
    db,
    events,
    compacted,
    hotVectors,
    compactVectors,
    vectorPartitions,
    graphLayoutOverrides,
    graphNodeEmbeddings,
    graphSemanticEdges,
    graphEdges,
    graphClusterMemberships,
    semanticGraphRuns,
    gardens,
    ftsEnabled: true, // MongoDB always has text search
  };
}

/**
 * Close MongoDB connection.
 */
export async function closeMongoDB(conn: MongoConnection): Promise<void> {
  await conn.client.close();
}

/**
 * Insert or update an event.
 */
export async function upsertEvent(
  collection: Collection<EventDocument>,
  event: Omit<EventDocument, "_id" | "createdAt" | "updatedAt">
): Promise<void> {
  const now = new Date();
  await collection.updateOne(
    { _id: event.id },
    {
      $set: {
        ...event,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

/**
 * Insert or update a compacted memory.
 */
export async function upsertCompactedMemory(
  collection: Collection<CompactedMemoryDocument>,
  memory: Omit<CompactedMemoryDocument, "_id" | "createdAt" | "updatedAt">
): Promise<void> {
  const now = new Date();
  await collection.updateOne(
    { _id: memory.id },
    {
      $set: {
        ...memory,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

export async function upsertGraphLayoutOverrides(
  collection: Collection<GraphLayoutOverrideDocument>,
  rows: Array<{
    node_id: string;
    project?: string | null;
    x: number;
    y: number;
    layout_source?: string | null;
    layout_version?: string | null;
    updated_at?: Date;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();

  await collection.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { _id: row.node_id },
        update: {
          $set: {
            node_id: row.node_id,
            project: row.project ?? null,
            x: row.x,
            y: row.y,
            layout_source: row.layout_source ?? null,
            layout_version: row.layout_version ?? null,
            updated_at: row.updated_at ?? now,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return rows.length;
}

export async function upsertGraphNodeEmbeddings(
  collection: Collection<GraphNodeEmbeddingDocument>,
  rows: Array<{
    node_id: string;
    source_event_id: string;
    project?: string | null;
    embedding_model?: string | null;
    embedding_dimensions: number;
    embedding: number[];
    chunk_index?: number;
    chunk_count: number;
    text?: string;
    updated_at?: Date;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();

  await collection.bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: {
          _id: `${row.node_id}::${row.embedding_model ?? ""}::${row.embedding_dimensions}::${row.chunk_index ?? 0}`,
        },
        update: {
          $set: {
            node_id: row.node_id,
            source_event_id: row.source_event_id,
            project: row.project ?? null,
            embedding_model: row.embedding_model ?? null,
            embedding_dimensions: row.embedding_dimensions,
            embedding: row.embedding,
            chunk_index: row.chunk_index ?? 0,
            chunk_count: row.chunk_count,
            ...(row.text != null ? { text: row.text } : {}),
            updated_at: row.updated_at ?? now,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  return rows.length;
}

export async function upsertGraphSemanticEdges(
  collection: Collection<GraphSemanticEdgeDocument>,
  rows: Array<{
    source_node_id: string;
    target_node_id: string;
    similarity: number;
    edge_type?: string;
    project?: string | null;
    embedding_model?: string | null;
    graph_version?: string | null;
    clustering_version?: string | null;
    source?: string | null;
    updated_at?: Date;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();

  await collection.bulkWrite(
    rows.map((row) => {
      // Ensure consistent ordering: source < target
      const [sourceNodeId, targetNodeId] = row.source_node_id < row.target_node_id
        ? [row.source_node_id, row.target_node_id]
        : [row.target_node_id, row.source_node_id];
      const edgeId = `${sourceNodeId}||${targetNodeId}`;

      return {
        updateOne: {
          filter: { _id: edgeId },
          update: {
            $set: {
              source_node_id: sourceNodeId,
              target_node_id: targetNodeId,
              similarity: row.similarity,
              edge_type: row.edge_type ?? "semantic_similarity",
              project: row.project ?? null,
              embedding_model: row.embedding_model ?? null,
              graph_version: row.graph_version ?? null,
              clustering_version: row.clustering_version ?? null,
              source: row.source ?? null,
              updated_at: row.updated_at ?? now,
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
            },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );

  return rows.length;
}

export async function upsertGraphEdges(
  collection: Collection<GraphEdgeDocument>,
  rows: Array<{
    source_node_id: string;
    target_node_id: string;
    edge_kind: string;
    layer?: string | null;
    project?: string | null;
    source?: string | null;
    data?: Record<string, unknown> | null;
    updated_at?: Date;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date();

  await collection.bulkWrite(
    rows.map((row) => {
      // Edge ID includes kind to allow multiple edge types between same nodes
      const edgeId = `${row.source_node_id}||${row.target_node_id}||${row.edge_kind}`;

      return {
        updateOne: {
          filter: { _id: edgeId },
          update: {
            $set: {
              source_node_id: row.source_node_id,
              target_node_id: row.target_node_id,
              edge_kind: row.edge_kind,
              layer: row.layer ?? null,
              project: row.project ?? null,
              source: row.source ?? null,
              data: row.data ?? null,
              updated_at: row.updated_at ?? now,
              updatedAt: now,
            },
            $setOnInsert: {
              createdAt: now,
            },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );

  return rows.length;
}

/**
 * Full-text search on events.
 */
export async function ftsSearch(
  collection: Collection<EventDocument>,
  query: string,
  options: {
    limit?: number;
    source?: string;
    kind?: string;
    project?: string;
    session?: string;
    visibility?: string;
  } = {}
): Promise<unknown[]> {
  const limit = options.limit ?? 20;
  const filter: Record<string, unknown> = {
    $text: { $search: query },
  };

  if (options.source) filter.source = options.source;
  if (options.kind) filter.kind = options.kind;
  if (options.project) filter.project = options.project;
  if (options.session) filter.session = options.session;
  if (options.visibility) filter["extra.visibility"] = options.visibility;

  const results = await collection
    .find(filter, {
      projection: {
        id: 1,
        ts: 1,
        source: 1,
        kind: 1,
        project: 1,
        session: 1,
        message: 1,
        role: 1,
        model: 1,
        text: { $substr: ["$text", 0, 240] },
      },
    })
    .sort({ ts: -1 })
    .limit(limit)
    .toArray();

  return results.map((r) => ({
    ...r,
    snippet: r.text,
    tier: "hot",
  }));
}

/**
 * ILIKE-style search (case-insensitive substring match).
 */
export async function ilikeSearch(
  collection: Collection<EventDocument>,
  query: string,
  options: {
    limit?: number;
    source?: string;
    kind?: string;
    project?: string;
    session?: string;
    visibility?: string;
  } = {}
): Promise<unknown[]> {
  const limit = options.limit ?? 20;
  const filter: Record<string, unknown> = {
    text: { $regex: query, $options: "i" },
  };

  if (options.source) filter.source = options.source;
  if (options.kind) filter.kind = options.kind;
  if (options.project) filter.project = options.project;
  if (options.session) filter.session = options.session;
  if (options.visibility) filter["extra.visibility"] = options.visibility;

  const results = await collection
    .find(filter, {
      projection: {
        id: 1,
        ts: 1,
        source: 1,
        kind: 1,
        project: 1,
        session: 1,
        message: 1,
        role: 1,
        model: 1,
        text: { $substr: ["$text", 0, 240] },
      },
    })
    .sort({ ts: -1 })
    .limit(limit)
    .toArray();

  return results.map((r) => ({
    ...r,
    snippet: r.text,
    tier: "hot",
  }));
}
