// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { queryMongoVectorsByText } from '../packages/openplanner-sdk/src/mongo-vectors.ts';

const filter = { source: 'creative-corpus', project: 'workspace' };
const doc = { _id: 'gold', parent_id: 'gold', embedding: [1, 0], text: 'source text',
  source: 'creative-corpus', project: 'workspace', kind: 'creative.text',
  ts: new Date('2026-10-25T00:00:00Z'), score: 1 };
function fixture({ ann = [], exact = [doc], exists = true, exactError = null, annError = null } = {}) {
  const stages = [];
  const probes = [];
  const aggregateOptions = [];
  const collection = {
    aggregate(pipeline, options) {
      aggregateOptions.push(options);
      stages.push(pipeline[0].$vectorSearch);
      return { async toArray() {
        if (pipeline[0].$vectorSearch.exact && exactError) throw exactError;
        if (!pipeline[0].$vectorSearch.exact && annError) throw annError;
        return pipeline[0].$vectorSearch.exact ? exact : ann;
      } };
    },
    find(where) {
      probes.push({ where });
      return { sort() { return { limit() { return { async toArray() { return [doc]; } }; } }; } };
    },
    async findOne(where, options) { probes.push({ where, options }); return exists ? { _id: 'gold' } : null; },
  };
  const mongo = { db: { collection() { return collection; } },
    vectorPartitions: { find() { return { sort() { return { async toArray() { return [{
      model: 'test-model', dimensions: 2, collectionName: 'test-partition',
      searchIndexName: 'vs_embedding', searchIndexStatus: 'ready',
    }]; } }; } }; } } };
  const run = () => queryMongoVectorsByText({ mongo, tier: 'hot', q: 'source', k: 5,
    where: filter, getEmbeddingFunctionForModel: () => ({ async generate() { return [[1, 0]]; } }) });
  return { run, stages, probes, aggregateOptions };
}
test('recovers an empty ANN response with native exact search in the same scope', async () => {
  const f = fixture();
  assert.deepEqual((await f.run()).ids, [['gold']]);
  assert.equal(f.stages.length, 2);
  assert.equal(f.stages[1].exact, true);
  assert.equal('numCandidates' in f.stages[1], false);
  assert.deepEqual(f.stages[1].filter, f.stages[0].filter);
  assert.deepEqual(f.stages[1].queryVector, f.stages[0].queryVector);
  assert.equal(f.stages[1].limit, f.stages[0].limit);
  assert.deepEqual(f.probes[0].where, f.stages[0].filter);
  assert.equal(f.probes[0].options.maxTimeMS, 1000);
  assert.equal(f.aggregateOptions[1].maxTimeMS, 5000);
});
test('leaves ordinary nonempty ANN results alone', async () => {
  const f = fixture({ ann: [doc] });
  assert.deepEqual((await f.run()).ids, [['gold']]);
  assert.equal(f.stages.length, 1);
  assert.equal(f.probes.length, 0);
});
test('a genuinely empty filtered scope returns empty without widening', async () => {
  const f = fixture({ exists: false });
  assert.deepEqual((await f.run()).ids, [[]]);
  assert.equal(f.stages.length, 1);
  assert.deepEqual(f.probes[0].where, f.stages[0].filter);
});
test('a populated but unsearchable index raises an inconsistency error', async () => {
  const f = fixture({ exact: [] });
  await assert.rejects(f.run, /empty.*nonempty|nonempty.*empty/i);
});
test('exact recovery failure is not converted into an authoritative empty result', async () => {
  const f = fixture({ exactError: new Error('exact unavailable') });
  await assert.rejects(f.run, /exact unavailable/);
});

test('preserves existing native-exception fallback with its original filter', async () => {
  const f = fixture({ annError: new Error('ANN unavailable') });
  assert.deepEqual((await f.run()).ids, [['gold']]);
  assert.deepEqual(f.probes[0].where, f.stages[0].filter);
  assert.equal(f.stages.length, 1);
});
