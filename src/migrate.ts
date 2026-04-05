#!/usr/bin/env node
/**
 * OpenPlanner Migration CLI
 *
 * Commands:
 *   node dist/migrate.js status            - Show migration status
 *   node dist/migrate.js run               - Run pending schema/index migrations
 *   node dist/migrate.js duckdb-to-mongo   - Migrate DuckDB structured data to MongoDB
 *   node dist/migrate.js mongo-to-duckdb   - Migrate MongoDB structured data back to DuckDB
 *   node dist/migrate.js chroma-to-mongo   - Migrate Chroma vectors to MongoDB vector collections
 *   node dist/migrate.js mongo-to-chroma   - Migrate MongoDB vector collections back to Chroma
 *   node dist/migrate.js legacy-to-mongo   - Migrate DuckDB + Chroma into MongoDB
 *   node dist/migrate.js mongo-to-legacy   - Migrate MongoDB back into DuckDB + Chroma
 *   node dist/migrate.js export-jsonl      - Export DuckDB data to JSONL
 */

import { loadConfig } from "./lib/config.js";
import { openDuckDB, type Duck } from "./lib/duckdb.js";
import { paths } from "./lib/paths.js";
import { openMongoDB, closeMongoDB, type MongoConnection } from "./lib/mongodb.js";
import {
  exportDuckDBToJsonl,
  migrateChromaToMongoDB,
  migrateDuckDBToMongoDB,
  migrateMongoDBToChroma,
  migrateMongoDBToDuckDB,
  runMigrations,
  type MigrationContext,
} from "./lib/migration.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const positionalArgs = args.filter((arg) => !arg.startsWith("--"));
  const command = positionalArgs[0] ?? "status";
  const dryRun = args.includes("--dry-run");
  const cfg = loadConfig();
  const pathConfig = paths(cfg.dataDir);

  console.log(`[migrate] Storage backend: ${cfg.storageBackend}`);
  console.log(`[migrate] Data directory: ${cfg.dataDir}`);
  console.log(`[migrate] MongoDB DB: ${cfg.mongodb.dbName}`);
  console.log(`[migrate] MongoDB collections: ${cfg.mongodb.eventsCollection}, ${cfg.mongodb.compactedCollection}, ${cfg.mongodb.vectorHotCollection}, ${cfg.mongodb.vectorCompactCollection}`);
  console.log(`[migrate] Chroma collections: ${cfg.chromaCollection}, ${cfg.chromaCompactCollection}`);

  if (command === "status") {
    console.log("[migrate] Available commands: status, run, duckdb-to-mongo, mongo-to-duckdb, chroma-to-mongo, mongo-to-chroma, legacy-to-mongo, mongo-to-legacy, export-jsonl");
    return;
  }

  if (command === "run") {
    let duck: Duck | undefined;
    let mongo: MongoConnection | undefined;

    try {
      if (cfg.storageBackend === "duckdb" || args.includes("--from-duckdb")) {
        duck = await openDuckDB(pathConfig.dbPath);
      }
      if (cfg.storageBackend === "mongodb" || args.includes("--to-mongo")) {
        mongo = await openMongoDB(cfg.mongodb);
      }

      const ctx: MigrationContext = {
        storageBackend: cfg.storageBackend,
        duck,
        mongo,
        dataDir: cfg.dataDir,
        migrationsPath: `${cfg.dataDir}/migrations.json`,
      };

      const applied = await runMigrations(ctx);
      console.log(`[migrate] Applied ${applied.length} migrations: ${applied.join(", ") || "none"}`);
    } finally {
      if (duck) {
        await new Promise<void>((resolve) => duck!.conn.close(() => resolve()));
      }
      if (mongo) {
        await closeMongoDB(mongo);
      }
    }
    return;
  }

  if (command === "export-jsonl") {
    const outputDir = positionalArgs[1] ?? `${cfg.dataDir}/export`;
    const duck = await openDuckDB(pathConfig.dbPath);
    try {
      const result = await exportDuckDBToJsonl(duck, outputDir);
      console.log(`[migrate] Export complete: events=${result.eventsFile} memories=${result.memoriesFile}`);
    } finally {
      await new Promise<void>((resolve) => duck.conn.close(() => resolve()));
    }
    return;
  }

  const needsDuck = ["duckdb-to-mongo", "legacy-to-mongo", "mongo-to-duckdb", "mongo-to-legacy"].includes(command);
  const needsMongo = ["duckdb-to-mongo", "mongo-to-duckdb", "chroma-to-mongo", "mongo-to-chroma", "legacy-to-mongo", "mongo-to-legacy"].includes(command);
  let duck: Duck | undefined;
  let mongo: MongoConnection | undefined;

  try {
    if (needsDuck) {
      duck = await openDuckDB(pathConfig.dbPath);
      console.log(`[migrate] DuckDB opened: ${pathConfig.dbPath}`);
    }
    if (needsMongo) {
      mongo = await openMongoDB(cfg.mongodb);
      console.log(`[migrate] MongoDB connected: ${cfg.mongodb.dbName}`);
    }

    if (command === "duckdb-to-mongo") {
      const result = await migrateDuckDBToMongoDB(duck!, mongo!, { dryRun });
      console.log(`[migrate] DuckDB → MongoDB complete: events=${result.eventsCount} memories=${result.memoriesCount} duration=${(result.duration / 1000).toFixed(2)}s`);
      return;
    }

    if (command === "mongo-to-duckdb") {
      const result = await migrateMongoDBToDuckDB(mongo!, duck!, { dryRun });
      console.log(`[migrate] MongoDB → DuckDB complete: events=${result.eventsCount} memories=${result.memoriesCount} duration=${(result.duration / 1000).toFixed(2)}s`);
      return;
    }

    if (command === "chroma-to-mongo") {
      const result = await migrateChromaToMongoDB(mongo!, {
        url: cfg.chromaUrl,
        hotCollection: cfg.chromaCollection,
        compactCollection: cfg.chromaCompactCollection,
      }, { dryRun });
      console.log(`[migrate] Chroma → MongoDB complete: hot=${result.hotCount} compact=${result.compactCount} duration=${(result.duration / 1000).toFixed(2)}s`);
      return;
    }

    if (command === "mongo-to-chroma") {
      const result = await migrateMongoDBToChroma(mongo!, {
        url: cfg.chromaUrl,
        hotCollection: cfg.chromaCollection,
        compactCollection: cfg.chromaCompactCollection,
      }, { dryRun });
      console.log(`[migrate] MongoDB → Chroma complete: hot=${result.hotCount} compact=${result.compactCount} duration=${(result.duration / 1000).toFixed(2)}s`);
      return;
    }

    if (command === "legacy-to-mongo") {
      const structured = await migrateDuckDBToMongoDB(duck!, mongo!, { dryRun });
      const vectors = await migrateChromaToMongoDB(mongo!, {
        url: cfg.chromaUrl,
        hotCollection: cfg.chromaCollection,
        compactCollection: cfg.chromaCompactCollection,
      }, { dryRun });
      console.log(`[migrate] Legacy → MongoDB complete: events=${structured.eventsCount} memories=${structured.memoriesCount} hotVectors=${vectors.hotCount} compactVectors=${vectors.compactCount}`);
      return;
    }

    if (command === "mongo-to-legacy") {
      const structured = await migrateMongoDBToDuckDB(mongo!, duck!, { dryRun });
      const vectors = await migrateMongoDBToChroma(mongo!, {
        url: cfg.chromaUrl,
        hotCollection: cfg.chromaCollection,
        compactCollection: cfg.chromaCompactCollection,
      }, { dryRun });
      console.log(`[migrate] MongoDB → legacy complete: events=${structured.eventsCount} memories=${structured.memoriesCount} hotVectors=${vectors.hotCount} compactVectors=${vectors.compactCount}`);
      return;
    }

    console.log(`[migrate] Unknown command: ${command}`);
    process.exit(1);
  } finally {
    if (duck) {
      await new Promise<void>((resolve) => duck!.conn.close(() => resolve()));
    }
    if (mongo) {
      await closeMongoDB(mongo);
    }
  }
}

main().catch((error) => {
  console.error(`[migrate] Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
