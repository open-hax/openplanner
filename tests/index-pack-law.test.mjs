// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { packBlocks, locateChunkOffsets } from '../packages/embedding/indexing-policy/dist/index.js';
import { prepareIndexDocument } from '../packages/openplanner-sdk/dist/indexing.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/index-pack-parent.json', import.meta.url), 'utf8'));
const decode = value => value && typeof value === 'object' && 'number' in value
  ? ({ NaN, Infinity, '-Infinity': -Infinity })[value.number] : value;

test('192 frozen parent packing cases preserve boundaries, overlap and nonfinite arithmetic', () => {
  assert.equal(fixture.commit, '16c57038e18954980e5c1db87ae0fde153fdb1d9');
  assert.equal(fixture.pack.length, 192);
  fixture.pack.forEach(c => assert.deepEqual(packBlocks(c.blocks, decode(c.tokens), decode(c.chars), decode(c.overlap)),
    c.expected));
});

test('parent repeated, missing, empty and UTF16 fragment offsets retain exact cursor behavior', () => {
  assert.equal(fixture.offsets.length, 3);
  fixture.offsets.forEach(c => assert.deepEqual(locateChunkOffsets(c.text, c.chunks), c.expected));
});

test('fractional overlap uses native slice truncation, not subtraction before truncation', () => {
  assert.deepEqual(packBlocks(['abcdef', '123456'], 1, 14, 1.5), ['abcdef', 'f\n\n123456']);
});

test('raw limit coercion remains lazy and ordered through overlap arithmetic', () => {
  const trace = [];
  const tokens = { valueOf() { trace.push('tokens'); return 0; } };
  const chars = { valueOf() { trace.push('chars'); return 14; } };
  const overlap = { valueOf() { trace.push('overlap'); return 1; } };
  assert.deepEqual(packBlocks(['abcdef', '123456'], tokens, chars, overlap), ['abcdef', 'f\n\n123456']);
  assert.deepEqual(trace, ['tokens', 'chars', 'overlap']);
});

test('offset objects and arrays remain fresh ordinary writable outputs', () => {
  const first = locateChunkOffsets('abc', ['abc', 'missing']);
  first[0].charStart = 7;
  first.push({ charStart: null, charEnd: null });
  assert.equal(Object.getPrototypeOf(first[0]), Object.prototype);
  assert.deepEqual(locateChunkOffsets('abc', ['abc', 'missing']),
    [{ charStart: 0, charEnd: 3 }, { charStart: null, charEnd: null }]);
});

test('empty blocks, no blocks and final trimming preserve the packing contract', () => {
  assert.deepEqual(packBlocks([], 0, 0, 400), []);
  assert.deepEqual(packBlocks(['', ' x ', ''], 4000, 16000, 400), ['x']);
  assert.deepEqual(packBlocks(['one'], 0, 0, 400), ['one']);
});

test('variable-overlap whole document matches a separately frozen full parent result', () => {
  const record = JSON.parse(fs.readFileSync(new URL('./fixtures/index-pack-document-parent.json', import.meta.url), 'utf8'));
  assert.equal(record.commit, '16c57038e18954980e5c1db87ae0fde153fdb1d9');
  assert.deepEqual(prepareIndexDocument(record.input), record.expected);
});

test('found and missing offset literals bypass inherited property setters', t => {
  const names = ['charStart', 'charEnd'];
  const previous = names.map(name => Object.getOwnPropertyDescriptor(Object.prototype, name));
  t.after(() => names.forEach((name, index) => {
    if (previous[index]) Object.defineProperty(Object.prototype, name, previous[index]);
    else Reflect.deleteProperty(Object.prototype, name);
  }));
  names.forEach(name => Object.defineProperty(Object.prototype, name,
    { configurable: true, set() { throw new Error('inherited setter touched'); } }));
  assert.deepEqual(locateChunkOffsets('abc', ['abc', 'missing']),
    [{ charStart: 0, charEnd: 3 }, { charStart: null, charEnd: null }]);
});

test('parent emission trim precedes overlap coercion and overlap trim', t => {
  const trace = [];
  const original = String.prototype.trim;
  t.after(() => { String.prototype.trim = original; });
  String.prototype.trim = function () {
    const value = String(this);
    const label = value === 'abcdef\n\n123456' ? 'estimate-trim'
      : value === 'abcdef' ? 'current-trim' : value === 'f' ? 'overlap-trim' : 'final-trim';
    trace.push(label);
    return original.call(this);
  };
  const tokens = { valueOf() { trace.push('tokens'); return 0; } };
  const chars = { valueOf() { trace.push('chars'); return 14; } };
  const overlap = { valueOf() { trace.push('overlap'); return 1; } };
  assert.deepEqual(packBlocks(['abcdef', '123456'], tokens, chars, overlap), ['abcdef', 'f\n\n123456']);
  assert.deepEqual(trace, ['estimate-trim', 'tokens', 'current-trim', 'chars', 'overlap', 'overlap-trim',
    'final-trim', 'final-trim']);
});

test('an emitted-current trim failure preserves Error identity before overlap coercion', t => {
  const original = String.prototype.trim;
  const failure = new Error('current trim rejected');
  t.after(() => { String.prototype.trim = original; });
  String.prototype.trim = function () {
    if (String(this) === 'abcdef') throw failure;
    return original.call(this);
  };
  const chars = { valueOf() { assert.fail('overlap arithmetic ran before the trim failure'); } };
  assert.throws(() => packBlocks(['abcdef', '123456'], 0, chars, 1), error => error === failure);
});
