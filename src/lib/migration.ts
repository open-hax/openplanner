/**
 * OpenPlanner Migration System
 *
 * Manages schema migrations between versions and storage backends.
 * Supports both DuckDB and MongoDB backends.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { ChromaClient } from "chromadb";
import { run, all, type Duck } from "./duckdb.js";
import { upsertMongoVectorDocuments } from "./mongo-vectors.js";
import type { MongoConnection, MongoVectorDocument } from "./mongodb.js";

export interface MigrationContext {
  storageBackend: "duckdb" | "mongodb";
  duck?: Duck;
  mongo?: MongoConnection;
  dataDir: string;
  migrationsPath: string;
}

export interface Migration {
  id: string;
  name: string;
  description: string;
  up: (ctx: MigrationContext) => Promise<void>;
  down?: (ctx: MigrationContext) => Promise<void>;
}

export type ChromaMigrationConfig = {
  url: string;
  hotCollection: string;
  compactCollection: string;
};

/**
 * Built-in migrations.
 */
export const migrations: Migration[] = [
  {
    id: "001_duckdb_initial",
    name: "duckdb_initial",
    description: "Initial DuckDB schema with events and compacted_memories tables",
    up: async () => {
      // Already handled by openDuckDB
    },
  },
  {
    id: "002_mongodb_support",
    name: "mongodb_support",
    description: "Add MongoDB as alternative storage backend",
    up: async (ctx) => {
      if (ctx.storageBackend !== "mongodb") return;
      // MongoDB indexes are created in openMongoDB.
    },
  },
  {
    id: "003_perception_events",
    name: "perception_events",
    description: "Add perception_events collection for Sintel signal intake",
    up: async (ctx) => {
      if (ctx.storageBackend !== "mongodb" || !ctx.mongo) return;

      const perceptionEvents = ctx.mongo.db.collection("perception_events");
      await perceptionEvents.createIndex({ createdAt: -1 });
      await perceptionEvents.createIndex({ category: 1, createdAt: -1 });
      await perceptionEvents.createIndex({ "signal.type": 1, createdAt: -1 });
      await perceptionEvents.createIndex({ "signal.author.did": 1, createdAt: -1 });
    },
  },
];

export async function loadAppliedMigrations(dataDir: string): Promise<Set<string>> {
  const migrationsPath = path.join(dataDir, "migrations.json");
  try {
    const content = await fs.readFile(migrationsPath, "utf-8");
    const applied = JSON.parse(content);
    return new Set(applied);
  } catch {
    return new Set();
  }
}

export async function saveAppliedMigrations(dataDir: string, applied: Set<string>): Promise<void> {
  const migrationsPath = path.join(dataDir, "migrations.json");
  await fs.mkdir(path.dirname(migrationsPath), { recursive: true });
  await fs.writeFile(migrationsPath, JSON.stringify([...applied], null, 2));
}

export async function runMigrations(ctx: MigrationContext): Promise<string[]> {
  const applied = await loadAppliedMigrations(ctx.dataDir);
  const results: string[] = [];

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    console.log(`[migration] Running: ${migration.id} - ${migration.name}`);
    await migration.up(ctx);
    applied.add(migration.id);
    results.push(migration.id);
  }

  await saveAppliedMigrations(ctx.dataDir, applied);
  return results;
}

export async function migrateDuckDBToMongoDB(
  duck: Duck,
  mongo: MongoConnection,
  options: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (phase: string, count: number, total?: number) => void;
  } = {},
): Promise<{ eventsCount: number; memoriesCount: number; duration: number }> {
  const batchSize = options.batchSize ?? 1000;
  const dryRun = options.dryRun ?? false;
  const startTime = Date.now();

  let eventsCount = 0;
  let memoriesCount = 0;

  const [{ count: totalEvents }] = await all(duck.conn, "SELECT COUNT(*) as count FROM events");
  const [{ count: totalMemories }] = await all(duck.conn, "SELECT COUNT(*) as count FROM compacted_memories");
  const totalEventsCount = totalEvents as number;
  const totalMemoriesCount = totalMemories as number;

  console.log(`[migration] DuckDB → MongoDB: ${totalEventsCount} events, ${totalMemoriesCount} memories`);

  let offset = 0;
  while (true) {
    const rows = await all(duck.conn, `
      SELECT id, ts, source, kind, project, session, message, role, author, model, tags, text, attachments, extra
      FROM events
      ORDER BY ts ASC, id ASC
      LIMIT ? OFFSET ?
    `, [batchSize, offset]);

    if (rows.length === 0) break;

    if (!dryRun) {
      const docs = rows.map((row: any) => ({
        _id: row.id,
        id: row.id,
        ts: new Date(row.ts),
        source: row.source ?? "",
        kind: row.kind ?? "",
        project: row.project ?? null,
        session: row.session ?? null,
        message: row.message ?? null,
        role: row.role ?? null,
        author: row.author ?? null,
        model: row.model ?? null,
        tags: row.tags ? JSON.parse(row.tags) : null,
        text: row.text ?? null,
        attachments: row.attachments ? JSON.parse(row.attachments) : null,
        extra: row.extra ? JSON.parse(row.extra) : null,
        createdAt: new Date(row.ts),
        updatedAt: new Date(),
      }));

      await mongo.events.bulkWrite(
        docs.map((doc) => {
          const { createdAt, ...docWithoutCreatedAt } = doc;
          return {
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: docWithoutCreatedAt,
                $setOnInsert: { createdAt },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );
    }

    eventsCount += rows.length;
    offset += batchSize;
    options.onProgress?.("events", eventsCount, totalEventsCount);
    console.log(`[migration] Events: ${eventsCount}/${totalEventsCount}`);
  }

  offset = 0;
  while (true) {
    const rows = await all(duck.conn, `
      SELECT id, ts, source, kind, project, session, seed_id, member_count, char_count, embedding_model, text, members, extra
      FROM compacted_memories
      ORDER BY ts ASC, id ASC
      LIMIT ? OFFSET ?
    `, [batchSize, offset]);

    if (rows.length === 0) break;

    if (!dryRun) {
      const docs = rows.map((row: any) => ({
        _id: row.id,
        id: row.id,
        ts: new Date(row.ts),
        source: row.source ?? "",
        kind: row.kind ?? "",
        project: row.project ?? null,
        session: row.session ?? null,
        seed_id: row.seed_id ?? null,
        member_count: row.member_count ?? 0,
        char_count: row.char_count ?? 0,
        embedding_model: row.embedding_model ?? null,
        text: row.text ?? "",
        members: row.members ? JSON.parse(row.members) : null,
        extra: row.extra ? JSON.parse(row.extra) : null,
        createdAt: new Date(row.ts),
        updatedAt: new Date(),
      }));

      await mongo.compacted.bulkWrite(
        docs.map((doc) => {
          const { createdAt, ...docWithoutCreatedAt } = doc;
          return {
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: docWithoutCreatedAt,
                $setOnInsert: { createdAt },
              },
              upsert: true,
            },
          };
        }),
        { ordered: false },
      );
    }

    memoriesCount += rows.length;
    offset += batchSize;
    options.onProgress?.("memories", memoriesCount, totalMemoriesCount);
    console.log(`[migration] Memories: ${memoriesCount}/${totalMemoriesCount}`);
  }

  const duration = Date.now() - startTime;
  console.log(`[migration] Complete: ${eventsCount} events, ${memoriesCount} memories in ${(duration / 1000).toFixed(2)}s`);

  return { eventsCount, memoriesCount, duration };
}

export async function migrateMongoDBToDuckDB(
  mongo: MongoConnection,
  duck: Duck,
  options: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (phase: string, count: number, total?: number) => void;
  } = {},
): Promise<{ eventsCount: number; memoriesCount: number; duration: number }> {
  const batchSize = options.batchSize ?? 1000;
  const dryRun = options.dryRun ?? false;
  const startTime = Date.now();

  let eventsCount = 0;
  let memoriesCount = 0;
  const totalEventsCount = await mongo.events.countDocuments();
  const totalMemoriesCount = await mongo.compacted.countDocuments();

  for (let offset = 0; offset < totalEventsCount; offset += batchSize) {
    const rows = await mongo.events.find({}).sort({ ts: 1, _id: 1 }).skip(offset).limit(batchSize).toArray();
    if (!dryRun) {
      for (const row of rows) {
        await run(duck.conn, `
          INSERT INTO events (
            id, ts, source, kind, project, session, message, role, author, model, tags, text, attachments, extra
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            ts=excluded.ts,
            source=excluded.source,
            kind=excluded.kind,
            project=excluded.project,
            session=excluded.session,
            message=excluded.message,
            role=excluded.role,
            author=excluded.author,
            model=excluded.model,
            tags=excluded.tags,
            text=excluded.text,
            attachments=excluded.attachments,
            extra=excluded.extra
        `, [
          row.id,
          row.ts.toISOString(),
          row.source,
          row.kind,
          row.project,
          row.session,
          row.message,
          row.role,
          row.author,
          row.model,
          JSON.stringify(row.tags ?? null),
          row.text ?? "",
          JSON.stringify(row.attachments ?? null),
          JSON.stringify(row.extra ?? null),
        ]);
      }
    }
    eventsCount += rows.length;
    options.onProgress?.("events", eventsCount, totalEventsCount);
  }

  for (let offset = 0; offset < totalMemoriesCount; offset += batchSize) {
    const rows = await mongo.compacted.find({}).sort({ ts: 1, _id: 1 }).skip(offset).limit(batchSize).toArray();
    if (!dryRun) {
      for (const row of rows) {
        await run(duck.conn, `
          INSERT INTO compacted_memories (
            id, ts, source, kind, project, session, seed_id, member_count, char_count, embedding_model, text, members, extra
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            ts=excluded.ts,
            source=excluded.source,
            kind=excluded.kind,
            project=excluded.project,
            session=excluded.session,
            seed_id=excluded.seed_id,
            member_count=excluded.member_count,
            char_count=excluded.char_count,
            embedding_model=excluded.embedding_model,
            text=excluded.text,
            members=excluded.members,
            extra=excluded.extra
        `, [
          row.id,
          row.ts.toISOString(),
          row.source,
          row.kind,
          row.project,
          row.session,
          row.seed_id,
          row.member_count,
          row.char_count,
          row.embedding_model,
          row.text,
          JSON.stringify(row.members ?? null),
          JSON.stringify(row.extra ?? null),
        ]);
      }
    }
    memoriesCount += rows.length;
    options.onProgress?.("memories", memoriesCount, totalMemoriesCount);
  }

  return { eventsCount, memoriesCount, duration: Date.now() - startTime };
}

function toMongoVectorDocument(
  id: string,
  document: string | null | undefined,
  embedding: unknown,
  metadata: Record<string, unknown> | null | undefined,
  tier: "hot" | "compact",
): MongoVectorDocument {
  const safeMetadata = metadata ?? {};
  const ts = new Date(String(safeMetadata.ts ?? new Date().toISOString()));
  return {
    _id: id,
    parent_id: typeof safeMetadata.parent_id === "string" && safeMetadata.parent_id.length > 0 ? safeMetadata.parent_id : id,
    text: document ?? "",
    embedding: Array.isArray(embedding) ? embedding.filter((value): value is number => typeof value === "number") : [],
    ts: Number.isNaN(ts.getTime()) ? new Date() : ts,
    source: typeof safeMetadata.source === "string" ? safeMetadata.source : "",
    kind: typeof safeMetadata.kind === "string" ? safeMetadata.kind : "",
    project: typeof safeMetadata.project === "string" && safeMetadata.project.length > 0 ? safeMetadata.project : null,
    session: typeof safeMetadata.session === "string" && safeMetadata.session.length > 0 ? safeMetadata.session : null,
    author: typeof safeMetadata.author === "string" && safeMetadata.author.length > 0 ? safeMetadata.author : null,
    role: typeof safeMetadata.role === "string" && safeMetadata.role.length > 0 ? safeMetadata.role : null,
    model: typeof safeMetadata.model === "string" && safeMetadata.model.length > 0 ? safeMetadata.model : null,
    visibility: typeof safeMetadata.visibility === "string" && safeMetadata.visibility.length > 0 ? safeMetadata.visibility : null,
    title: typeof safeMetadata.title === "string" && safeMetadata.title.length > 0 ? safeMetadata.title : null,
    embedding_model: typeof safeMetadata.embedding_model === "string" && safeMetadata.embedding_model.length > 0 ? safeMetadata.embedding_model : null,
    embedding_dimensions: Array.isArray(embedding) ? embedding.filter((value): value is number => typeof value === "number").length : null,
    search_tier: tier,
    chunk_id: typeof safeMetadata.chunk_id === "string" && safeMetadata.chunk_id.length > 0 ? safeMetadata.chunk_id : id,
    chunk_index: typeof safeMetadata.chunk_index === "number" ? safeMetadata.chunk_index : null,
    chunk_count: typeof safeMetadata.chunk_count === "number" ? safeMetadata.chunk_count : null,
    normalized_format: typeof safeMetadata.normalized_format === "string" ? safeMetadata.normalized_format : null,
    normalized_estimated_tokens: typeof safeMetadata.normalized_estimated_tokens === "number" ? safeMetadata.normalized_estimated_tokens : null,
    raw_estimated_tokens: typeof safeMetadata.raw_estimated_tokens === "number" ? safeMetadata.raw_estimated_tokens : null,
    seed_id: typeof safeMetadata.seed_id === "string" && safeMetadata.seed_id.length > 0 ? safeMetadata.seed_id : null,
    member_count: typeof safeMetadata.member_count === "number" ? safeMetadata.member_count : null,
    char_count: typeof safeMetadata.char_count === "number" ? safeMetadata.char_count : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function migrateChromaCollectionToMongo(
  client: ChromaClient,
  mongo: MongoConnection,
  collectionName: string,
  tier: "hot" | "compact",
  options: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (phase: string, count: number) => void;
  } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 500;
  let collection: Awaited<ReturnType<ChromaClient["getCollection"]>>;

  try {
    collection = await client.getCollection({ name: collectionName } as any);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("The requested resource could not be found")) {
      console.warn(`[migration] Chroma collection missing, skipping ${collectionName}`);
      return 0;
    }
    throw error;
  }

  let offset = 0;
  let count = 0;

  while (true) {
    const response: any = await collection.get({
      limit: batchSize,
      offset,
      include: ["embeddings", "metadatas", "documents"] as any,
    });

    const ids = Array.isArray(response.ids) ? response.ids : [];
    if (ids.length === 0) break;

    if (!options.dryRun) {
      await upsertMongoVectorDocuments(mongo, tier, ids.map((id: string, index: number) => ({
        id,
        parentId: typeof response.metadatas?.[index]?.parent_id === "string" && response.metadatas[index].parent_id.length > 0
          ? response.metadatas[index].parent_id
          : id,
        text: response.documents?.[index] ?? "",
        embedding: Array.isArray(response.embeddings?.[index]) ? response.embeddings[index] : [],
        metadata: response.metadatas?.[index] ?? {},
      })));
    }

    count += ids.length;
    offset += ids.length;
    options.onProgress?.(tier, count);
  }

  return count;
}

export async function migrateChromaToMongoDB(
  mongo: MongoConnection,
  chroma: ChromaMigrationConfig,
  options: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (phase: string, count: number) => void;
  } = {},
): Promise<{ hotCount: number; compactCount: number; duration: number }> {
  const startTime = Date.now();
  const client = new ChromaClient({ path: chroma.url });
  const hotCount = await migrateChromaCollectionToMongo(client, mongo, chroma.hotCollection, "hot", options);
  const compactCount = await migrateChromaCollectionToMongo(client, mongo, chroma.compactCollection, "compact", options);
  return { hotCount, compactCount, duration: Date.now() - startTime };
}

async function migrateMongoVectorsToChromaCollection(
  source: MongoConnection["hotVectors"] | MongoConnection["compactVectors"],
  client: ChromaClient,
  collectionName: string,
  options: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (phase: string, count: number) => void;
  } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 500;
  const collection = await client.getOrCreateCollection({ name: collectionName } as any);
  const total = await source.countDocuments();
  let migrated = 0;

  for (let offset = 0; offset < total; offset += batchSize) {
    const rows = await source.find({}).sort({ ts: 1, _id: 1 }).skip(offset).limit(batchSize).toArray();
    if (!options.dryRun && rows.length > 0) {
      await collection.upsert({
        ids: rows.map((row) => row._id),
        documents: rows.map((row) => row.text),
        embeddings: rows.map((row) => row.embedding),
        metadatas: rows.map((row) => ({
          ts: row.ts.toISOString(),
          source: row.source,
          kind: row.kind,
          project: row.project ?? "",
          session: row.session ?? "",
          author: row.author ?? "",
          role: row.role ?? "",
          model: row.model ?? "",
          visibility: row.visibility ?? "",
          title: row.title ?? "",
          embedding_model: row.embedding_model ?? "",
          search_tier: row.search_tier,
          parent_id: row.parent_id,
          chunk_id: row.chunk_id ?? row._id,
          chunk_index: row.chunk_index ?? 0,
          chunk_count: row.chunk_count ?? 1,
          normalized_format: row.normalized_format ?? null,
          normalized_estimated_tokens: row.normalized_estimated_tokens ?? null,
          raw_estimated_tokens: row.raw_estimated_tokens ?? null,
          seed_id: row.seed_id ?? null,
          member_count: row.member_count ?? null,
          char_count: row.char_count ?? null,
        })) as any,
      });
    }
    migrated += rows.length;
    options.onProgress?.(collectionName, migrated);
  }

  return migrated;
}

export async function migrateMongoDBToChroma(
  mongo: MongoConnection,
  chroma: ChromaMigrationConfig,
  options: {
    batchSize?: number;
    dryRun?: boolean;
    onProgress?: (phase: string, count: number) => void;
  } = {},
): Promise<{ hotCount: number; compactCount: number; duration: number }> {
  const startTime = Date.now();
  const client = new ChromaClient({ path: chroma.url });
  const hotCount = await migrateMongoVectorsToChromaCollection(mongo.hotVectors, client, chroma.hotCollection, options);
  const compactCount = await migrateMongoVectorsToChromaCollection(mongo.compactVectors, client, chroma.compactCollection, options);
  return { hotCount, compactCount, duration: Date.now() - startTime };
}

export async function exportDuckDBToJsonl(
  duck: Duck,
  outputDir: string,
  options: {
    batchSize?: number;
    onProgress?: (phase: string, count: number) => void;
  } = {},
): Promise<{ eventsFile: string; memoriesFile: string }> {
  const batchSize = options.batchSize ?? 1000;
  await fs.mkdir(outputDir, { recursive: true });

  const eventsFile = path.join(outputDir, "events.jsonl");
  const memoriesFile = path.join(outputDir, "compacted_memories.jsonl");

  console.log("[export] Exporting events to JSONL...");
  const eventsStream = await fs.open(eventsFile, "w");
  let offset = 0;
  let count = 0;

  while (true) {
    const rows = await all(duck.conn, `
      SELECT id, ts, source, kind, project, session, message, role, author, model, tags, text, attachments, extra
      FROM events
      ORDER BY ts ASC, id ASC
      LIMIT ? OFFSET ?
    `, [batchSize, offset]);

    if (rows.length === 0) break;

    for (const row of rows) {
      const doc = {
        id: row.id,
        ts: row.ts,
        source: row.source ?? "",
        kind: row.kind ?? "",
        project: row.project ?? null,
        session: row.session ?? null,
        message: row.message ?? null,
        role: row.role ?? null,
        author: row.author ?? null,
        model: row.model ?? null,
        tags: row.tags ? JSON.parse(row.tags) : null,
        text: row.text ?? null,
        attachments: row.attachments ? JSON.parse(row.attachments) : null,
        extra: row.extra ? JSON.parse(row.extra) : null,
      };
      await eventsStream.write(JSON.stringify(doc) + "\n");
      count++;
    }

    options.onProgress?.("events", count);
    offset += batchSize;
  }

  await eventsStream.close();
  console.log(`[export] Events: ${count} records → ${eventsFile}`);

  console.log("[export] Exporting compacted_memories to JSONL...");
  const memoriesStream = await fs.open(memoriesFile, "w");
  offset = 0;
  count = 0;

  while (true) {
    const rows = await all(duck.conn, `
      SELECT id, ts, source, kind, project, session, seed_id, member_count, char_count, embedding_model, text, members, extra
      FROM compacted_memories
      ORDER BY ts ASC, id ASC
      LIMIT ? OFFSET ?
    `, [batchSize, offset]);

    if (rows.length === 0) break;

    for (const row of rows) {
      const doc = {
        id: row.id,
        ts: row.ts,
        source: row.source ?? "",
        kind: row.kind ?? "",
        project: row.project ?? null,
        session: row.session ?? null,
        seed_id: row.seed_id ?? null,
        member_count: row.member_count ?? 0,
        char_count: row.char_count ?? 0,
        embedding_model: row.embedding_model ?? null,
        text: row.text ?? "",
        members: row.members ? JSON.parse(row.members) : null,
        extra: row.extra ? JSON.parse(row.extra) : null,
      };
      await memoriesStream.write(JSON.stringify(doc) + "\n");
      count++;
    }

    options.onProgress?.("memories", count);
    offset += batchSize;
  }

  await memoriesStream.close();
  console.log(`[export] Memories: ${count} records → ${memoriesFile}`);

  return { eventsFile, memoriesFile };
}
