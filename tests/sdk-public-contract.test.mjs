// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(process.env.SDK_CONTRACT_ROOT ?? '.');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/sdk-public-contract-parent.json'), 'utf8'));
const sdk = path.join(root, 'packages/openplanner-sdk/dist');
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');
const options = { strict: true, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler, types: ['node'] };

function diagnose(files) {
  const host = ts.createCompilerHost(options);
  const originalExists = host.fileExists.bind(host);
  const originalRead = host.readFile.bind(host);
  const originalSource = host.getSourceFile.bind(host);
  host.fileExists = (file) => Object.hasOwn(files, file) || originalExists(file);
  host.readFile = (file) => files[file] ?? originalRead(file);
  host.getSourceFile = (file, ...args) => Object.hasOwn(files, file)
    ? ts.createSourceFile(file, files[file], options.target, true) : originalSource(file, ...args);
  const program = ts.createProgram(Object.keys(files), options, host);
  return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

function syntaxTree(node) {
  const children = [];
  ts.forEachChild(node, (child) => { children.push(syntaxTree(child)); });
  const literal = ts.isLiteralExpression(node) || ts.isTemplateLiteralToken(node);
  const value = ts.isIdentifier(node) || literal ? node.text : null;
  return [node.kind, node.flags, value, literal ? node.rawText ?? null : null, children];
}

function parseJs(text) {
  return syntaxTree(ts.createSourceFile('module.js', text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS));
}

Object.entries(fixture.modules).forEach(([name, baseline]) => {
  test(`${name}: captured declaration and runtime identities remain intact`, () => {
    assert.equal(digest(baseline.declaration), baseline['declaration-sha256']);
    assert.equal(digest(baseline.js), baseline['compiled-sha256']);
    assert.equal(fixture.commit, '7a22f5a7af2b2aa4dd014ee1086e4d64385de224');
    assert.deepEqual(parseJs(fs.readFileSync(path.join(sdk, `${name}.js`), 'utf8')), parseJs(baseline.js));
  });

  test(`${name}: every exported type/signature equals its parent declaration`, () => {
    const legacy = path.join(sdk, `__legacy_${name}.d.ts`);
    const virtual = path.join(sdk, `__check_${name}.ts`);
    const comparisons = baseline.exports.map(({ name: key, kind }, i) => {
      const prefix = kind === 'value' ? 'typeof ' : '';
      return `type Contract${i} = Assert<Equal<${prefix}Legacy.${key}, ${prefix}Current.${key}>>;`;
    });
    const declaration = ts.createSourceFile('module.d.ts', fs.readFileSync(path.join(sdk, `${name}.d.ts`), 'utf8'),
      options.target, true);
    const exported = declaration.statements
      .filter((node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
      .map((node) => ({ name: node.name.text, kind: ts.isTypeAliasDeclaration(node) ? 'type' : 'value' }));
    const byName = (left, right) => left.name.localeCompare(right.name);
    const additions = name === 'types'
      ? [{ name: 'SdkArray', kind: 'type' }, { name: 'SdkMutable', kind: 'type' }] : [];
    assert.deepEqual(exported.toSorted(byName), [...baseline.exports, ...additions].toSorted(byName));
    const source = `import * as Legacy from './__legacy_${name}.js';
      import * as Current from './${name}.js';
      type Assert<T extends true> = T;
      type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
        (<T>() => T extends B ? 1 : 2) ? true : false;
      ${comparisons.join('\n')}
      ${baseline.consumer}`;
    assert.deepEqual(diagnose({ [legacy]: baseline.declaration, [virtual]: source }), []);
  });
});

test('frozen parent covers all 27 exports and 309 client mutation operations', () => {
  assert.equal(digest(fs.readFileSync(path.join(root, 'tests/fixtures/sdk-public-contract-parent.json'))),
    '82fca0c1517e83aa75805a558a8fbe61a0b34676d8c899261c13adb899fe50b0');
  assert.equal(Object.values(fixture.modules).reduce((count, item) => count + item.exports.length, 0), 27);
  assert.equal(Object.values(fixture.modules).reduce((count, item) => count + item.mutationCount, 0), 309);
});

test('public mutability oracle detects a readonly regression', () => {
  const virtual = path.join(sdk, '__readonly_probe.ts');
  const declaration = fixture.modules.types.declaration.replace('blob: string;', 'readonly blob: string;');
  assert.notEqual(declaration, fixture.modules.types.declaration);
  const consumer = `import * as Current from './__readonly_types.js'; ${fixture.modules.types.consumer}`;
  assert.ok(diagnose({ [virtual]: consumer, [path.join(sdk, '__readonly_types.d.ts')]: declaration })
    .some((message) => message.includes('read-only')));
});

test('legacy consumers can still mutate inferred embedding scopes and runtime methods', () => {
  const baseline = fixture.modules['embedding-runtime'];
  const consumer = `import type {EmbeddingRuntime} from './embedding-runtime.js';
    function inspect(runtime: EmbeddingRuntime) {
      const scope: Parameters<EmbeddingRuntime['hot']['getModel']>[0] = {};
      scope.source = 'source'; scope.kind = 'kind'; scope.project = 'project';
      runtime.hot.getModel = () => 'model'; runtime.compact.getModel = () => 'model';
      runtime.hot = runtime.hot; runtime.compact = runtime.compact;
    }`;
  const virtual = path.join(sdk, '__scope_contract.ts');
  assert.deepEqual(diagnose({ [virtual]: consumer }), []);
  assert.deepEqual(diagnose({ [virtual]: consumer, [path.join(sdk, 'embedding-runtime.d.ts')]: baseline.declaration }), []);
});

test('public DTO declarations remain a leaf without Node or MongoDB type dependencies', () => {
  const filename = path.join(sdk, 'types.d.ts');
  const program = ts.createProgram([filename], { ...options, types: [] });
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
  assert.ok(program.getSourceFiles().every((source) => source.fileName === filename
    || source.fileName.includes('/typescript/lib/')));
});

test('runtime oracle detects changes to the captured configuration error template', () => {
  const before = fixture.modules.config.js;
  const after = before.replace('Missing env var:', 'Different env var:');
  assert.notEqual(after, before);
  assert.notDeepEqual(parseJs(before), parseJs(after));
});

test('runtime oracle detects regex, bigint and raw tagged-template changes', () => {
  assert.notDeepEqual(parseJs('const value = /before/g;'), parseJs('const value = /after/i;'));
  assert.notDeepEqual(parseJs('const value = 1n;'), parseJs('const value = 2n;'));
  assert.notDeepEqual(parseJs('tag`\\u0061`;'), parseJs('tag`a`;'));
});
