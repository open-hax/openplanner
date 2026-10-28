// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import process from 'node:process';
import test from 'node:test';

const { parseModelMap, resolveEmbeddingModel } = await import(process.env.EMBEDDING_MODEL_MODULE
  ?? new URL('../packages/openplanner-sdk/dist/embedding-models.js', import.meta.url).href);
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/embedding-model-parent.json', import.meta.url), 'utf8'));
const config = () => ({ defaultModel: 'default', byProject: { x: 'project' },
  bySource: { x: 'source' }, byKind: { x: 'kind' } });
const encode = value => {
  if (typeof value === 'function') return { type: 'function', name: value.name };
  if (value === Object.prototype) return { type: 'object-prototype' };
  return { type: typeof value, value };
};

test('208 frozen parent parse cases retain ordered ordinary-object entries', () => {
  assert.equal(fixture.commit, 'eb3b5f4f47e5dafb076d9799e11a042e381e6975');
  assert.equal(fixture.parse.length, 208);
  fixture.parse.forEach(c => {
    const result = parseModelMap(c.raw.type === 'undefined' ? undefined : c.raw.value);
    assert.deepEqual(Object.entries(result), c.expected);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
  });
});

test('128 frozen parent routing cases retain JS values including inherited properties', () => {
  assert.equal(fixture.route.length, 128);
  fixture.route.forEach(c => assert.deepEqual(encode(resolveEmbeddingModel(c.config, c.scope)), c.expected));
});

test('scope precedence is project, source, kind, then default after trimming', () => {
  assert.equal(resolveEmbeddingModel(config(), { project: ' x ', source: 'x', kind: 'x' }), 'project');
  assert.equal(resolveEmbeddingModel(config(), { project: '', source: ' x ', kind: 'x' }), 'source');
  assert.equal(resolveEmbeddingModel(config(), { kind: ' x ' }), 'kind');
  assert.equal(resolveEmbeddingModel(config(), {}), 'default');
});

test('all scopes normalize before map access and later config getters remain lazy', () => {
  const maps = { get byProject() { return { x: 'project' }; },
    get bySource() { return assert.fail('later map getter called'); },
    get byKind() { return assert.fail('later map getter called'); },
    get defaultModel() { return assert.fail('default getter called'); } };
  assert.equal(resolveEmbeddingModel(maps, { project: 'x', source: 'x', kind: 'x' }), 'project');
  assert.throws(() => resolveEmbeddingModel(maps, { project: 'x', kind: null }), TypeError);
  const scopes = { get project() { return 'x'; }, get source() { throw new Error('source before lookup'); } };
  assert.throws(() => resolveEmbeddingModel(maps, scopes), /source before lookup/);
});

test('native falsiness advances while truthy objects retain identity', () => {
  [false, 0, NaN, '', null, undefined].forEach(value => {
    assert.equal(resolveEmbeddingModel({ ...config(), byProject: { x: value } },
      { project: 'x', source: 'x' }), 'source');
  });
  const model = Object.freeze({ id: 'legacy value' });
  assert.equal(resolveEmbeddingModel({ ...config(), byProject: { x: model } }, { project: 'x' }), model);
  assert.equal(resolveEmbeddingModel(config(), { project: 'toString' }), Object.prototype.toString);
});

test('pair and JSON parsing preserve special keys, native ordering and duplicate assignment', () => {
  const raw = '__proto__=ignored;constructor=x;02=two;2=second;a=first;a=last;a=b=c';
  assert.deepEqual(Object.entries(parseModelMap(raw)), [['2', 'second'], ['constructor', 'x'], ['02', 'two'], ['a', 'b=c']]);
  assert.equal(Object.hasOwn(parseModelMap(raw), '__proto__'), false);
  assert.deepEqual(Object.entries(parseModelMap('{" a ":" first ","a":"last","n":4,"empty":" "}')),
    [['a', 'last']]);
  assert.deepEqual(Object.entries(parseModelMap('{broken=x;a=y')), [['{broken', 'x'], ['a', 'y']]);
});

test('ECMAScript whitespace trims while zero width space is retained', () => {
  assert.deepEqual(parseModelMap('\uFEFF\u00A0 a = \u2029b\u3000'), { a: 'b' });
  assert.deepEqual(parseModelMap('\u200Ba=\u200Bb'), { '\u200Ba': '\u200Bb' });
});

test('frozen configuration and scope remain unchanged and fresh parse results are independent', () => {
  const input = config();
  Object.values(input).filter(v => typeof v === 'object').forEach(Object.freeze);
  Object.freeze(input);
  const scope = Object.freeze({ project: 'x' });
  assert.equal(resolveEmbeddingModel(input, scope), 'project');
  assert.deepEqual(input, config());
  assert.notEqual(parseModelMap('a=b'), parseModelMap('a=b'));
});

test('legacy invalid arguments retain synchronous native TypeErrors', () => {
  [1, true, {}, []].forEach(value => assert.throws(() => parseModelMap(value), TypeError));
  assert.throws(() => resolveEmbeddingModel(config(), null), TypeError);
  assert.throws(() => resolveEmbeddingModel(config(), { source: 1 }), TypeError);
  assert.throws(() => resolveEmbeddingModel({ defaultModel: 'd' }, { project: 'x' }), TypeError);
});

test('JSON assignment failure falls back while pair assignment failure escapes', t => {
  const key = 'embedding_assignment_probe';
  const previous = Object.getOwnPropertyDescriptor(Object.prototype, key);
  t.after(() => {
    if (previous) Object.defineProperty(Object.prototype, key, previous);
    else Reflect.deleteProperty(Object.prototype, key);
  });
  Object.defineProperty(Object.prototype, key, {
    configurable: true, set() { throw new Error('setter rejection'); },
  });
  assert.deepEqual(parseModelMap(JSON.stringify({ [key]: 'value' })), {});
  assert.throws(() => parseModelMap(`${key}=value`), /setter rejection/);
});
