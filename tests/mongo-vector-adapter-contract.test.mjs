// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import ts from 'typescript';
import { buildMongoVectorDeleteFilter, batchIndexTextsInMongoVectors } from '../packages/openplanner-sdk/src/mongo-vectors.ts';
import { sourceRedactionMetadata, toMetadata, cosineSimilarity } from '../packages/openplanner-sdk/src/mongo-vector-data.ts';
import { withMongoTransaction, deletePartitionDocuments } from '../packages/openplanner-sdk/src/mongo-vector-write.ts';

function mockMongo() {
  const partitions = new Map();
  const writes = [];
  const session = { async withTransaction(work) { return work(); }, async endSession() {} };
  const collection = {
    async createIndex() {},
    listSearchIndexes() { return { async toArray() { return [{ status: 'READY', queryable: true }]; } }; },
    async deleteMany() {},
    async bulkWrite(operations) { writes.push(operations); },
  };
  return { writes, mongo: {
    client: { startSession() { return session; } },
    hotVectors: { ...collection, collectionName: 'chunks' },
    compactVectors: { ...collection, collectionName: 'compact' },
    db: { collection() { return collection; } },
    vectorPartitions: {
      async updateOne(filter, update) {
        partitions.set(filter._id, { ...partitions.get(filter._id), ...update.$setOnInsert, ...update.$set });
      },
      async findOne(filter) { return partitions.get(filter._id); },
      find() { return { sort() { return { async toArray() { return []; } }; } }; },
    },
  } };
}

test('supported authorization filters preserve operator precedence and reject unsupported paths', () => {
  const at = new Date('2026-10-25');
  assert.deepEqual(buildMongoVectorDeleteFilter({
    project: { $eq: 'workspace', $ne: 'other' }, source: { $in: ['creative-corpus'], $eq: 'ignored' },
    visibility: { $ne: 'private' }, kind: true, session: { $eq: at }, embedding_model: 'embeddinggemma-2',
    'project.$ne': 'private', $or: [], search_tier: 'compact', labels: ['secret'], parent_id: { $gt: 2 },
  }), { project: 'workspace', source: { $in: ['creative-corpus'] }, visibility: { $ne: 'private' },
    kind: true, session: at, embedding_model: 'embeddinggemma-2' });
  assert.deepEqual(buildMongoVectorDeleteFilter({ project: { $eq: null }, kind: [] }), {});
});

test('redaction retains source precedence, exact hashes and chunk coordinates', () => {
  const result = sourceRedactionMetadata({ rawText: 'original', chunkText: 'chunk', charStart: 2, charEnd: 7,
    extra: { path: '/first', metadata: { path: '/second', content_hash: 'source-hash', lake: 'studio' } } });
  assert.deepEqual(result.source_ref, { source_path: '/first', lake: 'studio', content_hash: 'source-hash' });
  assert.equal(result.text_hash_sha256, 'source-hash');
  assert.equal(result.chunk_text_hash_sha256, '6c87f68371b28954707ebb92afee7ccffb74c6f71ec8fea8a98cf6104289585b');
  assert.equal(result.char_start, 2);
  assert.equal(result.char_end, 7);
  assert.deepEqual(sourceRedactionMetadata({ rawText: 'x', chunkText: 'x', extra: { lake: 'only' } }), {});
});

test('metadata keeps zero, false and empty strings while defaulting only nullish values', () => {
  const metadata = toMetadata({ _id: 'id', ts: new Date('2026-10-25'), chunk_count: 0, chunk_index: 0,
    source_text_redacted: false, embedding_dimensions: 0, project: '', source: 's', kind: 'k',
    parent_id: 'p', search_tier: 'hot', title: null });
  assert.equal(metadata.chunk_count, 0);
  assert.equal(metadata.embedding_dimensions, 0);
  assert.equal(metadata.source_text_redacted, false);
  assert.equal(metadata.project, '');
  assert.equal(metadata.title, '');
  assert.equal(metadata.chunk_id, 'id');
  assert.equal(metadata.char_start, null);
  assert.deepEqual(metadata.labels, []);
  assert.equal(metadata.ts, '2026-10-25T00:00:00.000Z');
});

test('cosine ranking keeps zero and dimension mismatch exclusion', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0], [0, 0]), -Infinity);
  assert.equal(cosineSimilarity([1], [1, 2]), -Infinity);
});

test('transaction fallback handles synchronous unsupported error and closes the same session once', async () => {
  const events = [];
  const session = {
    withTransaction() { events.push('transaction'); throw new Error('transactions are not supported'); },
    async endSession() { events.push('end'); },
  };
  const value = await withMongoTransaction({ client: { startSession() { return session; } } }, async (current) => {
    assert.equal(current, undefined);
    events.push('fallback');
    return 42;
  });
  assert.equal(value, 42);
  assert.deepEqual(events, ['transaction', 'fallback', 'end']);
});

test('transaction work failure propagates and endSession still runs', async () => {
  const events = [];
  const session = {
    async withTransaction(work) { return work(); }, async endSession() { events.push('end'); },
  };
  await assert.rejects(() => withMongoTransaction({ client: { startSession() { return session; } } }, async () => {
    throw new Error('write failed');
  }), /write failed/);
  assert.deepEqual(events, ['end']);
});

test('partition deletes remain sequential in a transaction and preserve the filter/session', async () => {
  const events = [];
  const active = new Set();
  const session = {};
  const filter = { parent_id: 'p', project: 'workspace' };
  const mongo = { db: { collection(name) { return { async deleteMany(actual, options) {
    assert.equal(active.size, 0, 'Mongo transactions do not permit overlapping operations');
    assert.equal(actual, filter);
    assert.equal(options.session, session);
    active.add(name);
    events.push(name);
    await Promise.resolve();
    active.delete(name);
  } }; } } };
  await deletePartitionDocuments(mongo, ['first', 'second', 'third'], filter, session);
  assert.deepEqual(events, ['first', 'second', 'third']);
});

test('batch indexing continues after synchronous embedding failure and preserves progress/partial-success semantics', async () => {
  const { mongo, writes } = mockMongo();
  const calls = [];
  const progress = [];
  const result = await batchIndexTextsInMongoVectors({ mongo, tier: 'hot',
    items: ['first', 'second'].map((id) => ({ id, text: id, metadata: { embedding_model: 'test' } })),
    embeddingFunction: { generate(texts) {
      calls.push(texts);
      if (calls.length === 1) throw new Error('sync provider validation failure');
      return Promise.resolve(texts.map(() => [1, 0]));
    } },
    config: { embeddingBatchSize: 1, concurrency: 1, mongoBatchSize: 1,
      onProgress(...args) { progress.push(args); } },
  });
  assert.deepEqual(result, { indexed: 1, failed: [] });
  assert.equal(calls.length, 2);
  assert.equal(writes.length, 2, 'flat and partition mirror writes');
  assert.equal(writes[0][0].updateOne.update.$set.parent_id, 'second');
  assert.deepEqual(progress, [['embedding', 0, 2], ['embedding', 1, 2], ['embedding', 2, 2],
    ['indexing', 0, 1], ['indexing', 1, 1], ['complete', 1, 2]]);
});

test('public SDK declaration boundary still accepts existing mutable consumers', () => {
  const virtual = path.resolve('tests/sdk-public-mutation-compatibility.ts');
  const source = `
    import type {MongoVectorEntry, BatchIndexConfig} from '../packages/openplanner-sdk/dist/mongo-vectors.js';
    import {queryMongoVectorsByText, listMongoVectorPartitions, batchIndexTextsInMongoVectors}
      from '../packages/openplanner-sdk/dist/mongo-vectors.js';
    function consume(entry: MongoVectorEntry, config: BatchIndexConfig,
      query: Awaited<ReturnType<typeof queryMongoVectorsByText>>,
      partitions: Awaited<ReturnType<typeof listMongoVectorPartitions>>,
      batch: Awaited<ReturnType<typeof batchIndexTextsInMongoVectors>>) {
      entry.id = 'changed'; entry.embedding.push(1); const vector: number[] = entry.embedding;
      config.concurrency = 4; query.ids[0].sort(); query.documents[0].push('doc');
      query.metadatas[0].push(null); query.distances[0].push(null); query.ids = [['id']];
      const includes: ['documents', 'metadatas', 'distances'] = query.include;
      partitions.sort(); batch.failed.push({id: 'id', error: 'error'}); batch.indexed = 2;
      batch.failed[0].id = 'changed'; return {vector, includes};
    }
    export {consume};`;
  const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, types: ['node'] };
  const host = ts.createCompilerHost(options);
  const originalSource = host.getSourceFile.bind(host);
  host.getSourceFile = (file, ...args) => file === virtual
    ? ts.createSourceFile(file, source, options.target, true) : originalSource(file, ...args);
  const program = ts.createProgram([virtual], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
