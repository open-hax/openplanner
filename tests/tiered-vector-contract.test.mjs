// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import test from 'node:test';

const moduleUrl = process.env.TIERED_VECTOR_MODULE
  ?? new URL('../packages/openplanner-sdk/src/vector-search.ts', import.meta.url).href;
const { extractTieredVectorHits, mergeTieredVectorHits } = await import(moduleUrl);
const fixturePath = new URL('./fixtures/tiered-vector-compatibility.json', import.meta.url);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const hit = (id, tier, rank) => (distance, document, metadata = {}) => ({
  id, tier, rank, distance, document, metadata,
});

test('all 192 frozen baseline ranking cases preserve their serialized results', () => {
  assert.equal(fixture.baseline_commit, '11a22b07a96683ccf7672cb7ba137fd73ff519e0');
  assert.equal(fixture.cases.length, 192);
  fixture.cases.forEach(c => {
    assert.deepEqual(JSON.parse(JSON.stringify(mergeTieredVectorHits(c.hitsByTier, c.limit))), c.expected, c.id);
  });
});

test('a better parent chunk retains earlier text when the better chunk has an empty document', () => {
  const result = mergeTieredVectorHits([
    [hit('a', 'hot', 0)(.4, 'first text', { parent_id: 'p', earlier: 'kept', source: 'old' })],
    [hit('b', 'compact', 0)(.1, '', { parent_id: 'p', source: 'new' })],
  ], 5);
  assert.deepEqual(result.ids, [['p']]);
  assert.deepEqual(result.documents, [['first text']]);
  assert.deepEqual(result.distances, [[.1]]);
  assert.deepEqual(result.metadatas[0][0], { parent_id: 'p', earlier: 'kept', source: 'new', best_match_id: 'b',
    search_tier: 'compact', search_tiers: ['hot', 'compact'], rrf_score: .03278689 });
});

test('equal distances keep the first representative and stable tier order', () => {
  const result = mergeTieredVectorHits([
    [hit('a', 'compact', 0)(.2, 'first', { parent_id: 'p', selected: 'first' })],
    [hit('b', 'hot', 0)(.2, 'second', { parent_id: 'p', selected: 'second' })],
    [hit('c', 'compact', 1)(.3, 'third', { parent_id: 'p' })],
  ], 2);
  assert.deepEqual(result.documents, [['first']]);
  assert.equal(result.metadatas[0][0].selected, 'first');
  assert.equal(result.metadatas[0][0].best_match_id, 'a');
  assert.deepEqual(result.metadatas[0][0].search_tiers, ['compact', 'hot']);
});

test('rank ties use distance then parent identity, and nonpositive limits retain the legacy minimum one', () => {
  const hits = [[hit('z', 'hot', 0)(.3, 'z'), hit('b', 'hot', 0)(.1, 'b'), hit('a', 'hot', 0)(.1, 'a')]];
  assert.deepEqual(mergeTieredVectorHits(hits, 3).ids, [['a', 'b', 'z']]);
  assert.deepEqual(mergeTieredVectorHits(hits, 0).ids, [['a']]);
  assert.deepEqual(mergeTieredVectorHits([], 3).ids, [[]]);
});

test('normalization tolerates absent nested fields and ignores nonnumeric distances', () => {
  assert.deepEqual(extractTieredVectorHits(null, 'hot'), []);
  assert.deepEqual(extractTieredVectorHits({ ids: ['flat'] }, 'hot'), []);
  assert.deepEqual(extractTieredVectorHits({ ids: [['id']], documents: [null], metadatas: [null],
    distances: [['.1']] }, 'compact'), [{ id: 'id', tier: 'compact', rank: 0, document: undefined,
    metadata: {}, distance: undefined }]);
});

test('merging does not mutate caller hits, metadata, or input arrays', () => {
  const a = Object.freeze(hit('a', 'hot', 0)(.4, 'old', Object.freeze({ parent_id: 'p', old: true })));
  const b = Object.freeze(hit('b', 'compact', 0)(.1, 'new', Object.freeze({ parent_id: 'p', fresh: true })));
  const inputs = Object.freeze([Object.freeze([a]), Object.freeze([b])]);
  const before = JSON.stringify(inputs);
  assert.deepEqual(mergeTieredVectorHits(inputs, 2).documents, [['new']]);
  assert.equal(JSON.stringify(inputs), before);
});
