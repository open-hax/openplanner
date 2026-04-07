import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type EmbeddingCacheKeyInput = {
  model: string;
  text: string;
  truncate: boolean;
  numCtx?: number;
};

export function makeEmbeddingCacheKey(input: EmbeddingCacheKeyInput): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      model: input.model,
      text: input.text,
      truncate: input.truncate,
      numCtx: input.numCtx ?? null,
    }))
    .digest("hex");
}

type CacheLine = {
  key: string;
  vector: number[];
  updatedAt: string;
};

export class PersistentEmbeddingCache {
  private readonly vectors = new Map<string, number[]>();
  private loadPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath?: string) {}

  async getMany(keys: readonly string[]): Promise<Map<string, number[]>> {
    await this.ensureLoaded();
    const hits = new Map<string, number[]>();
    for (const key of keys) {
      const vector = this.vectors.get(key);
      if (vector) hits.set(key, vector);
    }
    return hits;
  }

  async putMany(entries: ReadonlyArray<{ key: string; vector: number[] }>): Promise<void> {
    if (entries.length === 0) return;
    await this.ensureLoaded();

    const freshEntries = entries.filter((entry) => {
      if (this.vectors.has(entry.key)) return false;
      this.vectors.set(entry.key, entry.vector);
      return true;
    });
    if (freshEntries.length === 0 || !this.filePath) return;

    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath!), { recursive: true });
      const now = new Date().toISOString();
      const payload = freshEntries
        .map((entry) => JSON.stringify({ key: entry.key, vector: entry.vector, updatedAt: now } satisfies CacheLine))
        .join("\n");
      await fs.appendFile(this.filePath!, `${payload}\n`, "utf8");
    });

    await this.writeChain;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }
    this.loadPromise = this.loadFromDisk();
    await this.loadPromise;
  }

  private async loadFromDisk(): Promise<void> {
    if (!this.filePath) return;

    try {
      const content = await fs.readFile(this.filePath, "utf8");
      for (const line of content.split(/\n+/)) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Partial<CacheLine>;
          if (typeof parsed.key !== "string") continue;
          if (!Array.isArray(parsed.vector) || parsed.vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
            continue;
          }
          this.vectors.set(parsed.key, parsed.vector);
        } catch {
          // Ignore malformed cache lines; they should not block service startup.
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") throw error;
    }
  }
}
