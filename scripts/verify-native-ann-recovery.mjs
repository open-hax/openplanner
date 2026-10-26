// SPDX-License-Identifier: GPL-3.0-or-later
// Native Mongo verifier. Owns one unique candidate database, then drops only it.
// JSON stdin: {uri, database, records, cases, emptyCaseIds, baselineModule?}.
// URI never appears in output. Run from an isolated container with this repo mounted.
import assert from 'node:assert/strict';
import console from 'node:console';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { MongoClient } from 'mongodb';
import { queryMongoVectorsByText as candidate } from '../packages/openplanner-sdk/dist/mongo-vectors.js';

const input = JSON.parse(fs.readFileSync(0, 'utf8'));
assert.match(input.database, /^colab_ann_01a1722a_[a-f0-9]{12}$/);
assert.equal(input.records.length, 4638);
assert.equal(input.cases.length, 24);
const baseline = (await import('../packages/openplanner-sdk/dist/mongo-vectors.baseline.js')).queryMongoVectorsByText;
const hash = path => crypto.createHash('sha256').update(fs.readFileSync(new URL(path, import.meta.url))).digest('hex');
const candidateFiles = Object.fromEntries([
  'mongo-vector-data.js', 'mongo-vector-partitions.js', 'mongo-vector-query.js', 'mongo-vector-write.js', 'mongo-vectors.js',
].map(name => [name, hash(`../packages/openplanner-sdk/dist/${name}`)]));
const candidateHash = crypto.createHash('sha256').update(JSON.stringify(candidateFiles)).digest('hex');
const output = { database: input.database, candidate_sha256: candidateHash, candidate_files: candidateFiles,
  baseline_sha256: hash('../packages/openplanner-sdk/dist/mongo-vectors.baseline.js'), rows: [] };
const client = new MongoClient(input.uri, { serverSelectionTimeoutMS: 10000 });
let owned = false;
await client.connect();
try {
  const db = client.db(input.database);
  assert.equal((await db.listCollections().toArray()).length, 0, 'Candidate namespace already exists');
  await db.createCollection('_owner');
  owned = true;
  await db.collection('_owner').insertOne({ owner: '01a1722a-6907-7ff3-b756-eb75ea2d91aa' });
  output.version = (await db.admin().command({ buildInfo: 1 })).version;
  const coll = db.collection('vectors');
  const records = input.records.map(r => ({ ...r, ts: new Date(r.ts), updatedAt: new Date(r.updatedAt) }));
  await coll.insertMany(records);
  // A perfectly similar wrong-project record must never escape the filter in recovery.
  await coll.insertOne({ ...records[0], _id: 'wrong-project-canary', parent_id: 'wrong-project-canary',
    project: 'private-other-project', embedding: input.cases[0].vector });
  const definition = { fields: [ { type: 'vector', path: 'embedding', numDimensions: 768, similarity: 'cosine' },
    ...['source', 'project', 'visibility', 'kind', 'parent_id', 'embedding_model'].map(path => ({ type: 'filter', path })) ] };
  await coll.createSearchIndex({ name: 'vs_embedding', type: 'vectorSearch', definition });
  const deadline = Date.now() + 150000;
  while (true) {
    const indexes = await coll.listSearchIndexes().toArray();
    if (indexes.some(i => i.name === 'vs_embedding' && i.status === 'READY' && i.queryable)) break;
    assert.ok(Date.now() < deadline, 'Native candidate index did not become queryable');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  output.index_definition = definition;
  const descriptor = { model: 'embeddinggemma-2', dimensions: 768, collectionName: 'vectors',
    searchIndexName: 'vs_embedding', searchIndexStatus: 'ready' };
  let inject = false;
  let caseId = '';
  const requests = [];
  const wrapped = new Proxy(coll, { get(target, key) {
    if (key === 'aggregate') return (pipeline, options) => {
      const stage = pipeline[0].$vectorSearch;
      requests.push({ caseId, exact: stage.exact === true, filter: stage.filter,
        injected: inject && !stage.exact, maxTimeMS: options?.maxTimeMS });
      if (inject && !stage.exact) return { async toArray() { return []; } };
      return target.aggregate(pipeline, options);
    };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
  const mongo = { db: { collection: () => wrapped }, vectorPartitions: {
    find: () => ({ sort: () => ({ async toArray() { return [descriptor]; } }) }) } };
  const where = { source: 'creative-corpus', project: 'workspace' };
  const query = (fn, c, scoped = where) => fn({ mongo, tier: 'hot', q: c.query, k: 10, where: scoped,
    getEmbeddingFunctionForModel: () => ({ async generate() { return [c.vector]; } }) });
  for (const c of input.cases) {
    caseId = c.id;
    inject = false;
    const oldHealthy = await query(baseline, c);
    const healthy = await query(candidate, c);
    assert.deepEqual(healthy.ids, oldHealthy.ids, 'Healthy ANN rankings changed');
    const row = { id: c.id, native_count: healthy.ids[0].length, healthy_ids_equal: true };
    if (input.emptyCaseIds.includes(c.id)) {
      inject = true;
      const before = await query(baseline, c);
      const after = await query(candidate, c);
      assert.equal(before.ids[0].length, 0);
      assert.ok(after.ids[0].length > 0);
      assert.ok(!after.ids[0].includes('wrong-project-canary'));
      assert.ok(after.metadatas[0].every(m => m.project === 'workspace' && m.source === 'creative-corpus'));
      row.captured_empty_replay = { baseline_count: 0, recovered_count: after.ids[0].length, ids: after.ids[0] };
      inject = false;
    }
    output.rows.push(row);
  }
  caseId = 'legitimately-empty-project';
  const legitimatelyEmpty = await query(candidate, input.cases[0], { ...where, project: 'absent-project' });
  assert.equal(legitimatelyEmpty.ids[0].length, 0);
  assert.equal(requests.at(-1).exact, false, 'A genuinely empty project should not require recovery');
  caseId = 'missing-native-index';
  descriptor.searchIndexName = 'index-does-not-exist';
  const nativeBefore = await query(baseline, input.cases[0]);
  assert.equal(nativeBefore.ids[0].length, 0, 'Missing-index fixture must reproduce a real silent empty');
  await assert.rejects(() => query(candidate, input.cases[0]), /empty.*nonempty|nonempty.*empty/i);
  output.real_missing_index_rejected = true;
  output.legitimate_empty_scope_preserved = true;
  output.recovery_requests = requests.filter(r => r.exact);
  assert.ok(output.recovery_requests.every(r => JSON.stringify(r.filter) === JSON.stringify(where)));
  output.status = 'passed';
} finally {
  if (owned) {
    await client.db(input.database).dropDatabase();
    output.cleanup_verified = (await client.db(input.database).listCollections().toArray()).length === 0;
  }
  await client.close();
  console.log(JSON.stringify(output));
}
assert.equal(output.cleanup_verified, true, 'Candidate database cleanup unverified');
