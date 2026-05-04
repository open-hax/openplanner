import { PersistentEmbeddingCache, makeEmbeddingCacheKey } from "./embedding-cache.js";
import { isContextOverflowError } from "./indexing.js";

export interface IEmbeddingFunction {
  generate(texts: string[]): Promise<number[][]>;
}

function estimateTokens(input: string): number {
  const text = String(input || "");
  if (!text.trim()) return 0;
  const chars = text.length;
  const words = text.match(/\S+/g)?.length ?? 0;
  return Math.max(Math.ceil(chars / 4), Math.ceil(words * 1.35));
}

function splitTextIntoChunks(text: string, maxTokens: number): string[] {
  if (estimateTokens(text) <= maxTokens) {
    return [text];
  }

  const maxChars = maxTokens * 4;
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && (estimateTokens(next) > maxTokens || next.length > maxChars)) {
      out.push(current.trim());
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current.trim()) out.push(current.trim());

  const result: string[] = [];
  for (const chunk of out) {
    if (estimateTokens(chunk) <= maxTokens) {
      result.push(chunk);
      continue;
    }

    const sentences = chunk.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
    let sentenceCurrent = "";
    for (const sentence of sentences) {
      const next = sentenceCurrent ? `${sentenceCurrent} ${sentence}` : sentence;
      if (sentenceCurrent && (estimateTokens(next) > maxTokens || next.length > maxChars)) {
        result.push(sentenceCurrent.trim());
        sentenceCurrent = sentence;
      } else {
        sentenceCurrent = next;
      }
    }
    if (sentenceCurrent.trim()) result.push(sentenceCurrent.trim());
  }

  const final: string[] = [];
  for (const chunk of result) {
    if (estimateTokens(chunk) <= maxTokens) {
      final.push(chunk);
      continue;
    }
    const step = Math.max(1, maxChars);
    for (let start = 0; start < chunk.length; start += step) {
      final.push(chunk.slice(start, start + step).trim());
    }
  }

  return final.filter(Boolean);
}

function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return embeddings[0]!;
  const dims = embeddings[0]!.length;
  const sum = new Array(dims).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) {
      sum[i] += emb[i] ?? 0;
    }
  }
  return sum.map((s) => s / embeddings.length);
}

export class EmbedProviderFunction implements IEmbeddingFunction {
  private model: string;
  private url: string;
  private apiKey?: string;
  private cache?: PersistentEmbeddingCache;
  private batchWindowMs: number;
  private maxBatchItems: number;
  private maxConcurrentBatches: number;
  private pending = new Map<string, { text: string; waiters: Array<{ resolve: (vector: number[]) => void; reject: (error: unknown) => void }> }>();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private activeBatches = 0;
  private batchQueue: Array<() => Promise<void>> = [];
  private readonly MAX_CHARS_PER_BATCH = 4_000;
  private readonly MAX_SINGLE_ENTRY_CHARS = 4_000;
  private readonly CHUNK_TARGET_TOKENS = 6_000;

  constructor(
    model: string,
    url: string = "http://host.docker.internal:8789",
    opts?: {
      apiKey?: string;
      cache?: PersistentEmbeddingCache;
      batchWindowMs?: number;
      maxBatchItems?: number;
      maxConcurrentBatches?: number;
    }
  ) {
    this.model = model;
    this.url = url;
    this.apiKey = typeof opts?.apiKey === "string" && opts.apiKey.length > 0 ? opts.apiKey : undefined;
    this.cache = opts?.cache;
    this.batchWindowMs = typeof opts?.batchWindowMs === "number" && Number.isFinite(opts.batchWindowMs) && opts.batchWindowMs > 0
      ? Math.floor(opts.batchWindowMs)
      : 50;
    this.maxBatchItems = typeof opts?.maxBatchItems === "number" && Number.isFinite(opts.maxBatchItems) && opts.maxBatchItems > 0
      ? Math.floor(opts.maxBatchItems)
      : 256;
    this.maxConcurrentBatches = typeof opts?.maxConcurrentBatches === "number" && Number.isFinite(opts.maxConcurrentBatches) && opts.maxConcurrentBatches > 0
      ? Math.floor(opts.maxConcurrentBatches)
      : 4;
  }

  async generate(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const keys = texts.map((text) => makeEmbeddingCacheKey({
      model: this.model,
      text,
    }));
    const cached = this.cache ? await this.cache.getMany(keys) : new Map<string, number[]>();
    const inFlight = new Map<string, Promise<number[]>>();

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (cached.has(key) || inFlight.has(key)) continue;
      inFlight.set(key, this.enqueue(key, texts[index]!));
    }

    return await Promise.all(keys.map(async (key) => {
      const cachedVector = cached.get(key);
      if (cachedVector) return cachedVector;
      return await inFlight.get(key)!;
    }));
  }

  private async fetchBatch(texts: string[]): Promise<number[][]> {
    try {
      const body = {
        model: this.model,
        input: texts,
      };

      const res = await fetch(`${this.url}/v1/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(`Embed provider failed: ${res.status} ${res.statusText}${msg ? `\n${msg}` : ""}`);
      }

      const data = (await res.json()) as { data?: Array<{ embedding?: number[] }>; embeddings?: number[][] };
      const out = Array.isArray(data.embeddings)
        ? data.embeddings
        : Array.isArray(data.data)
          ? data.data.map((d) => d.embedding ?? []).filter((e) => e.length > 0)
          : [];
      if (out.length !== texts.length) {
        throw new Error(`Embed provider returned ${out.length} embeddings for ${texts.length} inputs`);
      }
      return out;
    } catch (err) {
      console.error("Embed provider error:", err);
      throw err;
    }
  }

  private enqueue(key: string, text: string): Promise<number[]> {
    return new Promise<number[]>((resolve, reject) => {
      const pending = this.pending.get(key);
      if (pending) {
        pending.waiters.push({ resolve, reject });
      } else {
        this.pending.set(key, { text, waiters: [{ resolve, reject }] });
      }

      let totalChars = 0;
      for (const [, entry] of this.pending) {
        totalChars += entry.text.length;
      }

      if (this.pending.size >= this.maxBatchItems || totalChars >= this.MAX_CHARS_PER_BATCH) {
        this.clearFlushTimer();
        void this.scheduleFlush().catch((error) => {
          console.error("Embed provider flush error:", error);
        });
        return;
      }

      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          void this.scheduleFlush().catch((error) => {
            console.error("Embed provider flush error:", error);
          });
        }, this.batchWindowMs);
      }
    });
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async scheduleFlush(): Promise<void> {
    return new Promise((resolve) => {
      const doFlush = async () => {
        await this.flushPending();
        resolve();
      };

      if (this.activeBatches < this.maxConcurrentBatches) {
        this.activeBatches++;
        void doFlush().finally(() => {
          this.activeBatches--;
          const next = this.batchQueue.shift();
          if (next) {
            this.activeBatches++;
            void next().finally(() => {
              this.activeBatches--;
            });
          }
        });
      } else {
        this.batchQueue.push(doFlush);
      }
    });
  }

  private async flushPending(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.pending.size > 0) {
        const entries:
          Array<[string, { text: string; waiters: Array<{ resolve: (vector: number[]) => void; reject: (error: unknown) => void }> }]> = [];
        let entriesChars = 0;
        const allEntries = Array.from(this.pending.entries());
        for (const entry of allEntries) {
          if (entries.length >= this.maxBatchItems) break;
          if (entriesChars + entry[1].text.length > this.MAX_CHARS_PER_BATCH && entries.length > 0) break;
          entries.push(entry);
          entriesChars += entry[1].text.length;
        }
        for (const [key] of entries) this.pending.delete(key);

        try {
          const embeddings = await this.resolveBatch(entries);

          void this.cache?.putMany(entries.map(([key], index) => ({ key, vector: embeddings[index]! })));

          for (let i = 0; i < entries.length; i++) {
            const entry = entries[i]![1];
            const vector = embeddings[i]!;
            for (const waiter of entry.waiters) waiter.resolve(vector);
          }
        } catch (error) {
          for (const [, entry] of entries) {
            for (const waiter of entry.waiters) waiter.reject(error);
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private async resolveBatch(
    entries: Array<[string, { text: string; waiters: Array<{ resolve: (vector: number[]) => void; reject: (error: unknown) => void }> }]>,
  ): Promise<number[][]> {
    const texts = entries.map(([, entry]) => entry.text);

    try {
      const embeddings = await this.fetchBatch(texts);
      if (embeddings.length !== entries.length) {
        throw new Error(`Embed provider returned ${embeddings.length} embeddings for ${entries.length} queued inputs`);
      }
      return embeddings;
    } catch (error) {
      if (!isContextOverflowError(error)) {
        throw error;
      }

      const oversizedEntries: typeof entries = [];
      const normalEntries: typeof entries = [];
      for (const entry of entries) {
        if (entry[1].text.length > this.MAX_SINGLE_ENTRY_CHARS) {
          oversizedEntries.push(entry);
        } else {
          normalEntries.push(entry);
        }
      }

      const results: number[][] = [];
      const remaining = [...normalEntries];
      while (remaining.length > 0) {
        const batch: typeof entries = [];
        let batchChars = 0;
        while (remaining.length > 0 && batchChars < this.MAX_CHARS_PER_BATCH) {
          const next = remaining[0]!;
          if (batchChars + next[1].text.length > this.MAX_CHARS_PER_BATCH && batch.length > 0) break;
          batch.push(remaining.shift()!);
          batchChars += next[1].text.length;
        }
        if (batch.length === 0) break;
        try {
          const batchEmbeddings = await this.resolveBatch(batch);
          results.push(...batchEmbeddings);
        } catch (batchError) {
          if (!isContextOverflowError(batchError)) throw batchError;
          if (batch.length === 1) {
            const singleEntry = batch[0]!;
            const chunks = splitTextIntoChunks(singleEntry[1].text, this.CHUNK_TARGET_TOKENS);
            const chunkEmbeddings = await this.resolveBatch(
              chunks.map((chunk) => [singleEntry[0], { text: chunk, waiters: [] }]),
            );
            const averaged = averageEmbeddings(chunkEmbeddings);
            results.push(averaged);
            continue;
          }
          const mid = Math.ceil(batch.length / 2);
          const left = await this.resolveBatch(batch.slice(0, mid));
          const right = await this.resolveBatch(batch.slice(mid));
          results.push(...left, ...right);
        }
      }

      for (const [key, entry] of oversizedEntries) {
        const chunks = splitTextIntoChunks(entry.text, this.CHUNK_TARGET_TOKENS);
        try {
          const chunkEmbeddings = await this.resolveBatch(
            chunks.map((chunk) => [key, { text: chunk, waiters: [] }]),
          );
          const averaged = averageEmbeddings(chunkEmbeddings);
          results.push(averaged);
        } catch {
          // Last resort: zero vector (will be filtered out by callers)
          const fallbackDims = 1024;
          results.push(new Array(fallbackDims).fill(0));
        }
      }

      return results;
    }
  }
}

export class ParallelEmbeddingPool {
  private workers: EmbedProviderFunction[];
  private currentIndex = 0;

  constructor(
    model: string,
    url: string,
    opts: {
      apiKey?: string;
      cache?: PersistentEmbeddingCache;
      batchWindowMs?: number;
      maxBatchItems?: number;
      workerCount?: number;
    } = {}
  ) {
    const workerCount = opts.workerCount ?? 4;
    this.workers = Array.from({ length: workerCount }, () =>
      new EmbedProviderFunction(model, url, {
        ...opts,
        maxConcurrentBatches: 1,
      })
    );
  }

  async generate(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (this.workers.length === 1) {
      return this.workers[0]!.generate(texts);
    }

    const chunkSize = Math.ceil(texts.length / this.workers.length);
    const chunks: string[][] = [];
    for (let i = 0; i < texts.length; i += chunkSize) {
      chunks.push(texts.slice(i, i + chunkSize));
    }

    const results = await Promise.all(
      chunks.map((chunk, index) => {
        const worker = this.workers[index % this.workers.length]!;
        return worker.generate(chunk);
      })
    );

    return results.flat();
  }

  getWorker(): EmbedProviderFunction {
    const worker = this.workers[this.currentIndex]!;
    this.currentIndex = (this.currentIndex + 1) % this.workers.length;
    return worker;
  }
}
