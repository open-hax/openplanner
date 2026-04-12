#!/usr/bin/env node
/**
 * Translation Worker
 *
 * Consumes translation_jobs from MongoDB and produces translation_segments.
 *
 * Environment variables:
 *   MONGODB_URI              - MongoDB connection URI (default: mongodb://localhost:27017)
 *   MONGODB_DB               - Database name (default: openplanner)
 *   MT_PROVIDER_URL          - Machine translation service URL (default: http://localhost:8789)
 *   MT_PROVIDER_API_KEY      - API key for MT service (optional)
 *   MT_PROVIDER_MODEL        - Model to use for translation (default: gpt-4o-mini)
 *   TRANSLATION_POLL_MS      - Polling interval in ms (default: 5000)
 *   TRANSLATION_BATCH_SIZE   - Max segments per document (default: 100)
 *   TRANSLATION_SEGMENT_SIZE - Max chars per segment (default: 500)
 */

import { MongoClient, Db, Collection, ObjectId } from "mongodb";

// Types
interface TranslationJob {
  _id: ObjectId;
  document_id: string;
  garden_id: string;
  project: string;
  source_lang: string;
  target_language: string;
  status: "queued" | "processing" | "complete" | "failed";
  error?: string;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
}

interface TranslationSegment {
  _id?: ObjectId;
  source_text: string;
  translated_text: string;
  source_lang: string;
  target_lang: string;
  document_id: string;
  segment_index: number;
  status: "pending" | "in_review" | "approved" | "rejected";
  mt_model?: string;
  confidence?: number;
  domain?: string;
  content_type?: string;
  url_context?: string;
  org_id?: string;
  project?: string;
  created_at: Date;
  updated_at: Date;
}

interface DocumentEvent {
  _id: string;
  text: string;
  extra?: {
    title?: string;
    domain?: string;
    language?: string;
  };
  project?: string;
}

interface MtTranslateRequest {
  text: string;
  source_lang: string;
  target_lang: string;
}

interface MtTranslateResponse {
  translated_text: string;
  confidence?: number;
}

// Config
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const MONGODB_DB = process.env.MONGODB_DB ?? "openplanner";
const MT_PROVIDER_URL = process.env.MT_PROVIDER_URL ?? process.env.EMBED_PROVIDER_BASE_URL ?? "http://localhost:8789";
const MT_PROVIDER_API_KEY = process.env.MT_PROVIDER_API_KEY ?? process.env.EMBED_PROVIDER_API_KEY ?? process.env.OPEN_HAX_OPENAI_PROXY_AUTH_TOKEN;
const MT_PROVIDER_MODEL = process.env.MT_PROVIDER_MODEL ?? "gpt-4o-mini";
const POLL_MS = parseInt(process.env.TRANSLATION_POLL_MS ?? "5000", 10);
const BATCH_SIZE = parseInt(process.env.TRANSLATION_BATCH_SIZE ?? "100", 10);
const SEGMENT_SIZE = parseInt(process.env.TRANSLATION_SEGMENT_SIZE ?? "500", 10);

let isShuttingDown = false;

// Handle shutdown signals
process.on("SIGINT", () => {
  console.log("[translation-worker] Received SIGINT, shutting down...");
  isShuttingDown = true;
});

process.on("SIGTERM", () => {
  console.log("[translation-worker] Received SIGTERM, shutting down...");
  isShuttingDown = true;
});

/**
 * Split text into segments respecting sentence boundaries
 */
function splitIntoSegments(text: string, maxChars: number = SEGMENT_SIZE): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const segments: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length <= maxChars) {
      current = current ? current + " " + sentence : sentence;
    } else {
      if (current) segments.push(current.trim());
      current = sentence;
    }
  }

  if (current) segments.push(current.trim());

  // Handle very long segments without sentence breaks
  return segments.flatMap(seg => {
    if (seg.length <= maxChars) return [seg];
    // Split on word boundaries
    const words = seg.split(/\s+/);
    const chunks: string[] = [];
    let chunk = "";
    for (const word of words) {
      if ((chunk + " " + word).trim().length <= maxChars) {
        chunk = chunk ? chunk + " " + word : word;
      } else {
        if (chunk) chunks.push(chunk.trim());
        chunk = word;
      }
    }
    if (chunk) chunks.push(chunk.trim());
    return chunks;
  });
}

/**
 * Call MT service to translate text
 */
async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  fewShotExamples?: Array<{ source_text: string; target_text: string }>
): Promise<MtTranslateResponse> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (MT_PROVIDER_API_KEY) {
    headers["Authorization"] = `Bearer ${MT_PROVIDER_API_KEY}`;
  }

  // Build prompt with few-shot examples if available
  let prompt: string;

  if (fewShotExamples && fewShotExamples.length > 0) {
    const examplesSection = fewShotExamples
      .map((ex, i) => `Example ${i + 1}:\nSource (${sourceLang}): ${ex.source_text.slice(0, 200)}...\nTarget (${targetLang}): ${ex.target_text.slice(0, 200)}...`)
      .join("\n\n");

    prompt = `You are a professional translator. Translate the following text from ${sourceLang} to ${targetLang}. Preserve formatting, technical terms, and code examples.

Here are some example translations for reference:
${examplesSection}

Now translate this text:
${text}

Output only the translated text without any explanation.`;
  } else {
    prompt = `Translate the following text from ${sourceLang} to ${targetLang}. Preserve formatting, technical terms, and code examples. Output only the translated text without any explanation.

Text to translate:
${text}`;
  }

  const response = await fetch(`${MT_PROVIDER_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MT_PROVIDER_MODEL,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: Math.max(100, Math.ceil(text.length * 2)),
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MT service error: ${response.status} ${errorText}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const translatedText = data.choices?.[0]?.message?.content?.trim() ?? "";

  return {
    translated_text: translatedText,
    confidence: 0.8, // Default confidence for LLM translations
  };
}

/**
 * Query graph memory for similar translation examples
 */
async function getFewShotExamples(
  db: Db,
  sourceText: string,
  sourceLang: string,
  targetLang: string,
  limit: number = 3
): Promise<Array<{ source_text: string; target_text: string }>> {
  try {
    const nodes = await db
      .collection("graph_nodes")
      .find({
        kind: "translation_example",
        "data.source_lang": sourceLang,
        "data.target_lang": targetLang,
        $or: [
          { "data.source_text": { $regex: sourceText.slice(0, 30), $options: "i" } },
          { "data.domain": { $exists: true } },
        ],
      })
      .limit(limit)
      .toArray();

    return nodes
      .filter((n) => n.data?.source_text && n.data?.target_text)
      .map((n) => ({
        source_text: n.data.source_text,
        target_text: n.data.target_text,
      }));
  } catch (err) {
    console.error("[translation-worker] Failed to query few-shot examples:", err);
    return [];
  }
}

/**
 * Process a single translation job
 */
async function processJob(
  db: Db,
  jobsCollection: Collection<TranslationJob>,
  segmentsCollection: Collection<TranslationSegment>,
  eventsCollection: Collection<DocumentEvent>,
  job: TranslationJob
): Promise<void> {
  console.log(`[translation-worker] Processing job ${job._id} for document ${job.document_id}`);

  // Mark job as processing
  await jobsCollection.updateOne(
    { _id: job._id },
    {
      $set: {
        status: "processing",
        started_at: new Date(),
      },
    }
  );

  try {
    // Get document text
    const document = await eventsCollection.findOne({ _id: job.document_id });

    if (!document) {
      throw new Error(`Document ${job.document_id} not found`);
    }

    const text = document.text ?? "";
    if (!text.trim()) {
      throw new Error(`Document ${job.document_id} has no text content`);
    }

    // Split into segments
    const sourceSegments = splitIntoSegments(text);
    const segmentsToProcess = sourceSegments.slice(0, BATCH_SIZE);

    console.log(`[translation-worker] Translating ${segmentsToProcess.length} segments for job ${job._id}`);

    // Get few-shot examples from graph memory for zero-shot learning
    const fewShotExamples = await getFewShotExamples(
      db,
      text.slice(0, 500),
      job.source_lang,
      job.target_language,
      3
    );

    if (fewShotExamples.length > 0) {
      console.log(`[translation-worker] Using ${fewShotExamples.length} few-shot examples from graph memory`);
    }

    // Translate each segment
    const translatedSegments: TranslationSegment[] = [];

    for (let i = 0; i < segmentsToProcess.length; i++) {
      const sourceText = segmentsToProcess[i];

      try {
        const result = await translateText(
          sourceText,
          job.source_lang,
          job.target_language,
          fewShotExamples
        );

        translatedSegments.push({
          source_text: sourceText,
          translated_text: result.translated_text,
          source_lang: job.source_lang,
          target_lang: job.target_language,
          document_id: job.document_id,
          segment_index: i,
          status: "pending",
          mt_model: MT_PROVIDER_MODEL,
          confidence: result.confidence,
          domain: document.extra?.domain,
          project: job.project ?? document.project,
          created_at: new Date(),
          updated_at: new Date(),
        });

        console.log(`[translation-worker] Translated segment ${i + 1}/${segmentsToProcess.length}`);
      } catch (segmentError) {
        console.error(`[translation-worker] Failed to translate segment ${i}:`, segmentError);
        // Add partial segment with error status
        translatedSegments.push({
          source_text: sourceText,
          translated_text: "",
          source_lang: job.source_lang,
          target_lang: job.target_language,
          document_id: job.document_id,
          segment_index: i,
          status: "rejected",
          mt_model: MT_PROVIDER_MODEL,
          project: job.project ?? document.project,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }
    }

    // Insert all segments
    if (translatedSegments.length > 0) {
      await segmentsCollection.insertMany(translatedSegments);
    }

    // Mark job as complete
    await jobsCollection.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "complete",
          completed_at: new Date(),
        },
      }
    );

    console.log(`[translation-worker] Job ${job._id} complete: ${translatedSegments.length} segments translated`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[translation-worker] Job ${job._id} failed:`, errorMessage);

    // Mark job as failed
    await jobsCollection.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "failed",
          error: errorMessage,
          completed_at: new Date(),
        },
      }
    );
  }
}

/**
 * Main worker loop
 */
async function run(): Promise<void> {
  console.log("[translation-worker] Starting translation worker");
  console.log(`[translation-worker] MongoDB: ${MONGODB_URI}/${MONGODB_DB}`);
  console.log(`[translation-worker] MT Provider: ${MT_PROVIDER_URL}`);
  console.log(`[translation-worker] MT Model: ${MT_PROVIDER_MODEL}`);

  const client = new MongoClient(MONGODB_URI, {
    connectTimeoutMS: 10000,
    socketTimeoutMS: 60000,
  });

  try {
    await client.connect();
    console.log("[translation-worker] Connected to MongoDB");

    const db = client.db(MONGODB_DB);
    const jobsCollection = db.collection<TranslationJob>("translation_jobs");
    const segmentsCollection = db.collection<TranslationSegment>("translation_segments");
    const eventsCollection = db.collection<DocumentEvent>("events");

    // Create indexes
    await jobsCollection.createIndex({ status: 1, created_at: 1 });
    await segmentsCollection.createIndex({ document_id: 1, segment_index: 1 });
    await segmentsCollection.createIndex({ status: 1 });
    await segmentsCollection.createIndex({ target_lang: 1 });

    console.log("[translation-worker] Starting poll loop...");

    while (!isShuttingDown) {
      try {
        // Find next queued job
        const job = await jobsCollection.findOne(
          { status: "queued" },
          { sort: { created_at: 1 } }
        );

        if (job) {
          await processJob(db, jobsCollection, segmentsCollection, eventsCollection, job);
        } else {
          // No jobs, wait before polling again
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
      } catch (error) {
        console.error("[translation-worker] Error in poll loop:", error);
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    }

    console.log("[translation-worker] Shutting down gracefully");
  } finally {
    await client.close();
    console.log("[translation-worker] Disconnected from MongoDB");
  }
}

// Run the worker
run().catch((error) => {
  console.error("[translation-worker] Fatal error:", error);
  process.exit(1);
});
