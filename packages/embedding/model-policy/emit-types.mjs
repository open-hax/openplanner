// SPDX-License-Identifier: LGPL-3.0-or-later
// Generated interop declarations; no TypeScript runtime policy implementation.
import fs from 'node:fs';
fs.writeFileSync(new URL('./dist/index.d.ts', import.meta.url), `
export function parseModelMap(raw: string | undefined): Record<string, string>;
export function resolveEmbeddingModel(config: {
  readonly defaultModel: string;
  readonly bySource: Readonly<Record<string, string>>;
  readonly byKind: Readonly<Record<string, string>>;
  readonly byProject: Readonly<Record<string, string>>;
}, scope: { readonly source?: string; readonly kind?: string; readonly project?: string }): string;
`);
