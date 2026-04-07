import { PersistentEmbeddingCache, makeEmbeddingCacheKey } from "./embedding-cache.js";
import { isContextOverflowError } from "./indexing.js";

/**
 * Embedding function interface (compatible with ChromaDB's IEmbeddingFunction)
 */
export interface IEmbeddingFunction {
  generate(texts: string[]): Promise<number[][]>;
}

/**
 * GPU-Saturating Embedding Function
 *
 * Key optimizations for GPU saturation:
 * 1. Large batch sizes (128-512 items) to maximize GPU utilization
 * 2. Longer batch windows to collect more items
 * 3. Parallel batch processing with configurable concurrency
 * 4. Prefetching: start embedding generation before all items are collected
 */

export class OllamaEmbeddingFunction implements IEmbeddingFunction {
  private model: string;
  private url: string;
  private truncate: boolean;
  private numCtx?: number;
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

  constructor(
    model: string,
    url: string = "http://localhost:11434",
    opts?: { 
      truncate?: boolean; 
      numCtx?: number; 
      apiKey?: string; 
      cache?: PersistentEmbeddingCache; 
      batchWindowMs?: number; 
      maxBatchItems?: number;
      maxConcurrentBatches?: number;
    }
  ) {
    this.model = model;
    this.url = url;
    this.truncate = opts?.truncate ?? true;
    this.numCtx = typeof opts?.numCtx === "number" && Number.isFinite(opts.numCtx) ? opts.numCtx : undefined;
    this.apiKey = typeof opts?.apiKey === "string" && opts.apiKey.length > 0 ? opts.apiKey : undefined;
    this.cache = opts?.cache;
    // Default to larger batches for GPU saturation (256 items, 50ms window)
    this.batchWindowMs = typeof opts?.batchWindowMs === "number" && Number.isFinite(opts.batchWindowMs) && opts.batchWindowMs > 0
      ? Math.floor(opts.batchWindowMs)
      : 50;
    this.maxBatchItems = typeof opts?.maxBatchItems === "number" && Number.isFinite(opts.maxBatchItems) && opts.maxBatchItems > 0
      ? Math.floor(opts.maxBatchItems)
      : 256;
    // Allow multiple concurrent batch requests to GPU
    this.maxConcurrentBatches = typeof opts?.maxConcurrentBatches === "number" && Number.isFinite(opts.maxConcurrentBatches) && opts.maxConcurrentBatches > 0
      ? Math.floor(opts.maxConcurrentBatches)
      : 4;
  }

  async generate(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const keys = texts.map((text) => makeEmbeddingCacheKey({
      model: this.model,
      text,
      truncate: this.truncate,
      numCtx: this.numCtx,
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
    // Prefer Ollama /api/embed which supports batching and explicit truncation control.
    // Docs: https://docs.ollama.com/api/embed
    try {
      const body: any = {
        model: this.model,
        input: texts,
        truncate: this.truncate,
      };
      if (this.numCtx) {
        body.options = { num_ctx: this.numCtx };
      }

      const res = await fetch(`${this.url}/api/embed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(`Ollama embed failed: ${res.status} ${res.statusText}${msg ? `\n${msg}` : ""}`);
      }

      const data = (await res.json()) as { embeddings?: number[][] };
      const out = Array.isArray(data.embeddings) ? data.embeddings : [];
      if (out.length !== texts.length) {
        throw new Error(`Ollama embed returned ${out.length} embeddings for ${texts.length} inputs`);
      }
      return out;
    } catch (err) {
      // Fail loud by default; callers can decide how to handle upstream.
      // Returning zero vectors here silently corrupts retrieval quality and makes truncation bugs invisible.
      console.error("Ollama embedding error:", err);
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

      if (this.pending.size >= this.maxBatchItems) {
        this.clearFlushTimer();
        void this.scheduleFlush().catch((error) => {
          console.error("Ollama embedding flush error:", error);
        });
        return;
      }

      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null;
          void this.scheduleFlush().catch((error) => {
            console.error("Ollama embedding flush error:", error);
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

  /**
   * Schedule a flush, respecting maxConcurrentBatches for parallel GPU utilization
   */
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
          // Process queued batches
          const next = this.batchQueue.shift();
          if (next) {
            this.activeBatches++;
            void next().finally(() => {
              this.activeBatches--;
            });
          }
        });
      } else {
        // Queue for later execution
        this.batchQueue.push(doFlush);
      }
    });
  }

  private async flushPending(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.pending.size > 0) {
        const entries = Array.from(this.pending.entries()).slice(0, this.maxBatchItems);
        for (const [key] of entries) this.pending.delete(key);

        try {
          const embeddings = await this.resolveBatch(entries);

          // Fire-and-forget cache write to avoid blocking
          void this.cache?.putMany(entries.map(([key], index) => ({ key, vector: embeddings[index]! })));

          entries.forEach(([, entry], index) => {
            const vector = embeddings[index]!;
            entry.waiters.forEach((waiter) => waiter.resolve(vector));
          });
        } catch (error) {
          entries.forEach(([, entry]) => {
            entry.waiters.forEach((waiter) => waiter.reject(error));
          });
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
        throw new Error(`Ollama embed returned ${embeddings.length} embeddings for ${entries.length} queued inputs`);
      }
      return embeddings;
    } catch (error) {
      if (entries.length <= 1 || !isContextOverflowError(error)) {
        throw error;
      }

      const midpoint = Math.ceil(entries.length / 2);
      const left = await this.resolveBatch(entries.slice(0, midpoint));
      const right = await this.resolveBatch(entries.slice(midpoint));
      return [...left, ...right];
    }
  }
}

/**
 * Parallel Embedding Worker Pool
 * 
 * Manages multiple embedding functions for maximum GPU saturation.
 * Distributes work across workers and aggregates results.
 */
export class ParallelEmbeddingPool {
  private workers: OllamaEmbeddingFunction[];
  private currentIndex = 0;

  constructor(
    model: string,
    url: string,
    opts: {
      truncate?: boolean;
      numCtx?: number;
      apiKey?: string;
      cache?: PersistentEmbeddingCache;
      batchWindowMs?: number;
      maxBatchItems?: number;
      workerCount?: number;
    } = {}
  ) {
    const workerCount = opts.workerCount ?? 4;
    this.workers = Array.from({ length: workerCount }, () => 
      new OllamaEmbeddingFunction(model, url, {
        ...opts,
        maxConcurrentBatches: 1, // Each worker handles one batch at a time
      })
    );
  }

  /**
   * Generate embeddings in parallel across workers
   */
  async generate(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (this.workers.length === 1) {
      return this.workers[0]!.generate(texts);
    }

    // Distribute texts across workers
    const chunkSize = Math.ceil(texts.length / this.workers.length);
    const chunks: string[][] = [];
    for (let i = 0; i < texts.length; i += chunkSize) {
      chunks.push(texts.slice(i, i + chunkSize));
    }

    // Process in parallel
    const results = await Promise.all(
      chunks.map((chunk, index) => {
        const worker = this.workers[index % this.workers.length]!;
        return worker.generate(chunk);
      })
    );

    // Flatten results
    return results.flat();
  }

  /**
   * Get underlying worker for direct use
   */
  getWorker(): OllamaEmbeddingFunction {
    const worker = this.workers[this.currentIndex]!;
    this.currentIndex = (this.currentIndex + 1) % this.workers.length;
    return worker;
  }
}
