// SPDX-License-Identifier: LGPL-3.0-or-later
import fs from 'node:fs';
fs.writeFileSync(new URL('./dist/index.d.ts', import.meta.url), `
export function estimateTokens(input: string): number;
export function packBlocks(blocks: ReadonlyArray<string>, targetTokens: number,
  targetChars: number, overlapChars: number): string[];
export function locateChunkOffsets(text: string, chunks: ReadonlyArray<string>):
  Array<{ charStart: number | null; charEnd: number | null }>;
export function batchPreparedChunks<T extends { readonly text: string }>(
  chunks: ReadonlyArray<T>,
  opts?: { readonly maxBatchTokens?: number; readonly maxBatchItems?: number }
): T[][];
`);
