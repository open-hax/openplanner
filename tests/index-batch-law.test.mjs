// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { batchPreparedChunks, prepareIndexDocument } from '../packages/openplanner-sdk/dist/indexing.js';
import { estimateTokens } from '../packages/embedding/indexing-policy/dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/index-batch-parent.json', import.meta.url), 'utf8'));
const contract = JSON.parse(fs.readFileSync(new URL('./fixtures/indexing-runtime-parent.json', import.meta.url), 'utf8'));
const chunk = text => ({ id: text, text, chunkIndex: 0, chunkCount: 1 });
const decode = value => value && typeof value === 'object' && 'number' in value
  ? ({ NaN, Infinity, '-Infinity': -Infinity })[value.number] : value;

function statements(text) {
  const parsed = ts.createSourceFile('module.js', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const tree = node => {
    const children = [];
    ts.forEachChild(node, c => { children.push(tree(c)); });
    const literal = ts.isLiteralExpression(node) || ts.isTemplateLiteralToken(node);
    return [node.kind, node.flags, ts.isIdentifier(node) || literal ? node.text : null,
      literal ? node.rawText ?? null : null, children];
  };
  return parsed.statements.filter(n => !ts.isImportDeclaration(n)
    && !contract.excluded.includes(n.name?.text ?? n.declarationList?.declarations[0]?.name?.text))
    .map(n => crypto.createHash('sha256').update(JSON.stringify(tree(n))).digest('hex'));
}

function diagnose(current, legacy, consumer) {
  const base = path.join(root, 'packages/openplanner-sdk/dist');
  const files = { [path.join(base, '__batch_current.d.ts')]: current,
    [path.join(base, '__batch_legacy.d.ts')]: legacy, [path.join(base, '__batch_client.ts')]: consumer };
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler };
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host), exists = host.fileExists.bind(host), get = host.getSourceFile.bind(host);
  host.readFile = f => files[f] ?? read(f);
  host.fileExists = f => Object.hasOwn(files, f) || exists(f);
  host.getSourceFile = (f, ...args) => Object.hasOwn(files, f)
    ? ts.createSourceFile(f, files[f], options.target, true) : get(f, ...args);
  return ts.getPreEmitDiagnostics(ts.createProgram(Object.keys(files), options, host))
    .map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

const consumer = `import type * as Current from './__batch_current.js';
import type * as Legacy from './__batch_legacy.js';
type Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2)?true:false;
type Assert<T extends true> = T;
type Chunk = Assert<Equal<Current.PreparedIndexChunk,Legacy.PreparedIndexChunk>>;
type Document = Assert<Equal<Current.PreparedIndexDocument,Legacy.PreparedIndexDocument>>;
type Batch = Assert<Equal<typeof Current.batchPreparedChunks,typeof Legacy.batchPreparedChunks>>;
type Prepare = Assert<Equal<typeof Current.prepareIndexDocument,typeof Legacy.prepareIndexDocument>>;
type Overflow = Assert<Equal<typeof Current.isContextOverflowError,typeof Legacy.isContextOverflowError>>;
function mutate(c:Current.PreparedIndexChunk,d:Current.PreparedIndexDocument,b:ReturnType<typeof Current.batchPreparedChunks>,
 o:NonNullable<Parameters<typeof Current.batchPreparedChunks>[1]>) {
 c.id=c.id;c.text=c.text;c.chunkIndex=c.chunkIndex;c.chunkCount=c.chunkCount;c.charStart=c.charStart;c.charEnd=c.charEnd;
 d.parentId=d.parentId;d.rawText=d.rawText;d.normalizedText=d.normalizedText;d.normalizedFormat=d.normalizedFormat;
 d.chunked=d.chunked;d.chunkCount=d.chunkCount;d.chunks=d.chunks;d.chunks.push(c);d.chunks[0]!.text=c.text;
 d.rawEstimatedTokens=d.rawEstimatedTokens;d.normalizedEstimatedTokens=d.normalizedEstimatedTokens;
 b.push([c]);b[0]!.push(c);o.maxBatchTokens=1;o.maxBatchItems=1;
}`;

test('128 frozen parent batches and10 estimator examples match', () => {
  assert.equal(fixture.commit, 'b5b37604f4f8967f60c2cda041ecbdabcec948a8');
  assert.equal(fixture.cases.length, 128);
  fixture.cases.forEach(c => {
    const options = Object.fromEntries(Object.entries(c.options).map(([k, v]) => [k, decode(v)]));
    assert.deepEqual(batchPreparedChunks(c.chunks, options).map(b => b.map(x => c.chunks.indexOf(x))), c.expected);
  });
  fixture.tokens.forEach(c => assert.equal(estimateTokens(c.text), c.expected));
});

test('only the intended batch/estimator runtime statements change', () => {
  const js = fs.readFileSync(path.join(root, 'packages/openplanner-sdk/dist/indexing.js'), 'utf8');
  assert.deepEqual(statements(js), contract.statements);
  assert.notDeepEqual(statements(js.replace('3_000', '3_001')), contract.statements);
  assert.notDeepEqual(statements(js.replace('context window|', 'context changed|')), contract.statements);
});

test('all five public contracts and writable DTO/container/options operations compile unchanged', () => {
  const current = fs.readFileSync(path.join(root, 'packages/openplanner-sdk/dist/indexing.d.ts'), 'utf8');
  assert.deepEqual(diagnose(current, contract.declaration, consumer), []);
  assert.ok(diagnose(current.replace('readonly id: string;', 'readonly id: number;'), contract.declaration, consumer).length);
  assert.ok(diagnose(current.replace('SdkMutable<{', 'Readonly<{'), contract.declaration, consumer).length);
});

test('oversize, zero and nonfinite item limits never drop or clone objects', () => {
  const input = Object.freeze([Object.freeze(chunk('oversize text')), Object.freeze(chunk('x'))]);
  [0, -1, -Infinity, .5].forEach(maxBatchItems => {
    const result = batchPreparedChunks(input, { maxBatchItems });
    assert.deepEqual(result, [[input[0]], [input[1]]]);
    assert.equal(result[0][0], input[0]);
  });
  [NaN, Infinity].forEach(maxBatchItems => assert.deepEqual(batchPreparedChunks(input, { maxBatchItems }), [input]));
  assert.deepEqual(batchPreparedChunks([], { maxBatchTokens: -Infinity }), []);
});

test('nullish defaults, repeated references and native JS numeric coercion remain intact', () => {
  const value = chunk('x');
  assert.deepEqual(batchPreparedChunks([value, value], null), [[value, value]]);
  assert.deepEqual(batchPreparedChunks([value, value],
    { maxBatchItems: null, maxBatchTokens: undefined }), [[value, value]]);
  assert.deepEqual(batchPreparedChunks([value, value], { maxBatchItems: '1' }), [[value], [value]]);
});

test('option and text reads stay lazy, ordered and short-circuit numeric conversion', () => {
  const trace = [];
  const input = [0, 1].map(i => ({ get text() { trace.push(`text${i}`); return 'x'; } }));
  const options = { get maxBatchTokens() { trace.push('tokens'); return 0; },
    get maxBatchItems() { trace.push('items'); return { valueOf() { assert.fail('item conversion should be skipped'); } }; } };
  assert.deepEqual(batchPreparedChunks(input, options), [[input[0]], [input[1]]]);
  assert.deepEqual(trace, ['tokens', 'items', 'text0', 'text1']);
});

test('native iterator closes on body failure and an absent iterator does not fall back to array-like', () => {
  const trace = [];
  const input = [chunk('x'), { get text() { throw new Error('text rejected'); } }];
  input[Symbol.iterator] = () => {
    const iterator = Array.prototype.values.call(input);
    return { next: () => iterator.next(), return: () => { trace.push('closed'); return { done: true }; } };
  };
  assert.throws(() => batchPreparedChunks(input), /text rejected/);
  assert.deepEqual(trace, ['closed']);
  assert.throws(() => batchPreparedChunks({ 0: chunk('x'), length: 1 }), TypeError);
});


test('native iterator invocation ignores an own noncallable call property', () => {
  const input = [chunk('x'), chunk('y')];
  const iterator = function () { return Array.prototype.values.call(input); };
  iterator.call = 0;
  input[Symbol.iterator] = iterator;
  const result = batchPreparedChunks(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].length, input.length);
  result[0].forEach((value, index) => assert.equal(value, input[index]));
});


test('six parent document preparations retain HTML, chunk offsets and token-dependent splits', () => {
  const documents = JSON.parse(fs.readFileSync(new URL('./fixtures/index-document-parent.json', import.meta.url), 'utf8'));
  assert.equal(documents.commit, 'b5b37604f4f8967f60c2cda041ecbdabcec948a8');
  assert.equal(documents.cases.length, 6);
  documents.cases.forEach(c => assert.deepEqual(prepareIndexDocument(c.input), c.expected));
});
