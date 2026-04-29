export interface DocumentSourceRef {
  sourcePath?: string;
  url?: string;
  hostname?: string;
  lake?: string;
  contentHash?: string;
  cacheKey: string;
}

export interface HydrationResult {
  row: Record<string, unknown>;
  hydrated: boolean;
  sourceRef?: DocumentSourceRef;
}

export interface CacheStats {
  size: number;
  maxEntries: number;
  defaultTtlMs: number;
}

export interface CacheHandle {
  __openplannerCache: true;
}

export function documentNeedsHydration(row: Record<string, unknown>): boolean;
export function documentSourceRef(row: Record<string, unknown>): DocumentSourceRef | null;
export function documentCacheKey(row: Record<string, unknown>): string | null;
export function hydrateDocumentRow(row: Record<string, unknown>, sourceText?: string | null): HydrationResult;
export function rowToDocument(row: Record<string, unknown>): Record<string, unknown>;

export function createMemoryLruCache(options?: { maxEntries?: number; defaultTtlMs?: number }): CacheHandle;
export function cacheGet(cache: CacheHandle, key: string): string | null;
export function cachePut(cache: CacheHandle, key: string, value: string, ttlMs?: number): boolean;
export function cacheEvict(cache: CacheHandle, key: string): boolean;
export function cacheTouch(cache: CacheHandle, key: string, ttlMs?: number): boolean;
export function cacheCleanup(cache: CacheHandle): number;
export function cacheStats(cache: CacheHandle): CacheStats;
