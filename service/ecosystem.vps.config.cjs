const fs = require("REDACTED_SECRET:fs");
const os = require("REDACTED_SECRET:os");
const path = require("REDACTED_SECRET:path");

const serviceRoot = __dirname;
const develRoot = path.resolve(serviceRoot, "../..");
const home = os.homedir();
const REDACTED_SECRETPath = path.join(home, ".local/opt/REDACTED_SECRET-v22.21.1-linux-x64/bin/REDACTED_SECRET");
const mongodPath = path.join(home, ".local/opt/mongodb-linux-x86_64-ubuntu2404-8.0.14/bin/mongod");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    out[key] = value;
  }
  return out;
}

const envFile = path.join(serviceRoot, ".env.vps");
const fileEnv = readEnvFile(envFile);
const baseEnv = {
  ...process.env,
  ...fileEnv,
  PATH: `${path.join(home, ".local/bin")}:${path.join(home, ".local/opt/REDACTED_SECRET-v22.21.1-linux-x64/bin")}:${process.env.PATH ?? ""}`,
};
for (const key of ["CHROMA_URL", "CHROMA_COLLECTION", "DATABASE_URL"]) {
  if (!baseEnv[key]) delete baseEnv[key];
}

const logsDir = path.join(serviceRoot, "cloud/logs");
const mongoDbPath = path.join(serviceRoot, "cloud/mongodb");
const proxxDataDir = path.join(serviceRoot, "cloud/proxx-data");
const openplannerLakeDir = path.join(serviceRoot, "cloud/openplanner-lake");
for (const dir of [logsDir, mongoDbPath, proxxDataDir, openplannerLakeDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const proxxRoot = path.join(develRoot, "orgs/open-hax/proxx");
const openplannerRoot = path.join(develRoot, "orgs/open-hax/openplanner");

module.exports = {
  apps: [
    {
      name: "cloud-mongodb",
      script: mongodPath,
      args: [
        "--dbpath", mongoDbPath,
        "--bind_ip", "127.0.0.1",
        "--port", "27017",
        "--wiredTigerCacheSizeGB", "1",
        "--logpath", path.join(logsDir, "mongod.log"),
        "--logappend",
      ],
      cwd: serviceRoot,
      interpreter: "none",
      autorestart: true,
      watch: false,
      time: true,
      kill_timeout: 10000,
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "10s",
    },
    {
      name: "cloud-proxx",
      script: path.join(proxxRoot, "dist/main.js"),
      cwd: proxxRoot,
      interpreter: REDACTED_SECRETPath,
      env: {
        ...baseEnv,
        NODE_ENV: "production",
        PROXY_HOST: "0.0.0.0",
        PROXY_PORT: "8789",
        PORT: "8789",
        PROXY_KEYS_FILE: path.join(develRoot, "services/proxx/seeds/keys.json"),
        PROXY_MODELS_FILE: path.join(develRoot, "services/proxx/models.json"),
        PROXY_REQUEST_LOGS_FILE: path.join(proxxDataDir, "request-logs.jsonl"),
        PROXY_REQUEST_LOGS_MAX_ENTRIES: baseEnv.PROXY_REQUEST_LOGS_MAX_ENTRIES ?? "25000",
        PROXY_REQUEST_LOGS_FLUSH_MS: baseEnv.PROXY_REQUEST_LOGS_FLUSH_MS ?? "2000",
        PROXY_PROMPT_AFFINITY_FLUSH_MS: baseEnv.PROXY_PROMPT_AFFINITY_FLUSH_MS ?? "500",
        PROXX_EVENT_STORE_TTL_MS: baseEnv.PROXX_EVENT_STORE_TTL_MS ?? "3600000",
        PROXX_EVENT_STORE_TTL_SWEEP_MS: baseEnv.PROXX_EVENT_STORE_TTL_SWEEP_MS ?? "300000",
        PROXX_CLJS_RUNTIME_REQUIRED: baseEnv.PROXX_CLJS_RUNTIME_REQUIRED ?? "true",
        PROXX_CLJS_POLICY_SHADOW: baseEnv.PROXX_CLJS_POLICY_SHADOW ?? "true",
        PROXX_CLJS_POLICY_AUTHORITATIVE: baseEnv.PROXX_CLJS_POLICY_AUTHORITATIVE ?? "true",
        PROXX_CLJS_POLICY_MANIFEST: path.join(develRoot, "services/proxx/policies/runtime/00-manifest.edn"),
        PROXY_ALLOW_UNAUTHENTICATED: baseEnv.PROXY_ALLOW_UNAUTHENTICATED ?? "false",
        UPSTREAM_PROVIDER_ID: baseEnv.UPSTREAM_PROVIDER_ID ?? "openai",
        UPSTREAM_BASE_URL: baseEnv.UPSTREAM_BASE_URL ?? "https://chatgpt.com/backend-api",
        OPENAI_PROVIDER_ID: baseEnv.OPENAI_PROVIDER_ID ?? "openai",
        OPENAI_BASE_URL: baseEnv.OPENAI_BASE_URL ?? "https://chatgpt.com/backend-api",
        OPENAI_API_BASE_URL: baseEnv.OPENAI_API_BASE_URL ?? "https://api.openai.com",
        OPENAI_OAUTH_CLIENT_ID: baseEnv.OPENAI_OAUTH_CLIENT_ID ?? "app_EMoamEEZ73f0CkXaXp7hrann",
        OPENAI_OAUTH_ISSUER: baseEnv.OPENAI_OAUTH_ISSUER ?? "https://auth.openai.com",
        OPENAI_OAUTH_SCOPES: baseEnv.OPENAI_OAUTH_SCOPES ?? "openid profile email offline_access",
        OPENAI_IMAGES_UPSTREAM_MODE: baseEnv.OPENAI_IMAGES_UPSTREAM_MODE ?? "auto",
        OLLAMA_BASE_URL: baseEnv.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
        UPSTREAM_CHAT_COMPLETIONS_PATH: baseEnv.UPSTREAM_CHAT_COMPLETIONS_PATH ?? "/v1/chat/completions",
        OPENAI_CHAT_COMPLETIONS_PATH: baseEnv.OPENAI_CHAT_COMPLETIONS_PATH ?? "/codex/responses/compact",
        UPSTREAM_RESPONSES_PATH: baseEnv.UPSTREAM_RESPONSES_PATH ?? "/v1/responses",
        OPENAI_RESPONSES_PATH: baseEnv.OPENAI_RESPONSES_PATH ?? "/codex/responses",
        UPSTREAM_MESSAGES_PATH: baseEnv.UPSTREAM_MESSAGES_PATH ?? "/v1/messages",
        UPSTREAM_MESSAGES_MODEL_PREFIXES: baseEnv.UPSTREAM_MESSAGES_MODEL_PREFIXES ?? "claude-",
        UPSTREAM_RESPONSES_MODEL_PREFIXES: baseEnv.UPSTREAM_RESPONSES_MODEL_PREFIXES ?? "gpt-",
        OPENAI_MODEL_PREFIXES: baseEnv.OPENAI_MODEL_PREFIXES ?? "openai/,openai:",
        OLLAMA_CHAT_PATH: baseEnv.OLLAMA_CHAT_PATH ?? "/api/chat",
        OLLAMA_MODEL_PREFIXES: baseEnv.OLLAMA_MODEL_PREFIXES ?? "ollama/,ollama:,ollama-lan/,ollama-lan:",
        PROXY_KEY_RELOAD_MS: baseEnv.PROXY_KEY_RELOAD_MS ?? "5000",
        PROXY_KEY_COOLDOWN_MS: baseEnv.PROXY_KEY_COOLDOWN_MS ?? "30000",
        UPSTREAM_REQUEST_TIMEOUT_MS: baseEnv.UPSTREAM_REQUEST_TIMEOUT_MS ?? "900000",
        UPSTREAM_STREAM_BOOTSTRAP_TIMEOUT_MS: baseEnv.UPSTREAM_STREAM_BOOTSTRAP_TIMEOUT_MS ?? "900000",
        NODE_OPTIONS: baseEnv.NODE_OPTIONS ?? "--max-old-space-size=2048",
        ...(baseEnv.CHROMA_URL ? {
          CHROMA_URL: baseEnv.CHROMA_URL,
          CHROMA_COLLECTION: baseEnv.CHROMA_COLLECTION ?? "open_hax_proxy_sessions",
        } : {}),
        FEDERATION_SELF_NODE_ID: baseEnv.FEDERATION_SELF_NODE_ID ?? "cloud-vps-104-130-159-19",
        FEDERATION_SELF_GROUP_ID: baseEnv.FEDERATION_SELF_GROUP_ID ?? "cloud-vps",
        FEDERATION_SELF_CLUSTER_ID: baseEnv.FEDERATION_SELF_CLUSTER_ID ?? "cloud-proxx",
        FEDERATION_SELF_PEER_DID: baseEnv.FEDERATION_SELF_PEER_DID ?? "did:web:104.130.159.19:proxx",
        FEDERATION_SELF_PUBLIC_BASE_URL: baseEnv.FEDERATION_SELF_PUBLIC_BASE_URL ?? "http://104.130.159.19:8789",
        FEDERATION_DEFAULT_OWNER_SUBJECT: baseEnv.FEDERATION_DEFAULT_OWNER_SUBJECT ?? "did:web:proxx.local",
        FEDERATION_REQUEST_TIMEOUT_MS: baseEnv.FEDERATION_REQUEST_TIMEOUT_MS ?? "30000",
      },
      autorestart: true,
      watch: false,
      time: true,
      kill_timeout: 5000,
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "10s",
    },
    {
      name: "cloud-openplanner",
      script: path.join(openplannerRoot, "dist/main.js"),
      cwd: openplannerRoot,
      interpreter: REDACTED_SECRETPath,
      env: {
        ...baseEnv,
        NODE_ENV: "production",
        OPENPLANNER_HOST: "0.0.0.0",
        OPENPLANNER_PORT: "7777",
        OPENPLANNER_DATA_DIR: openplannerLakeDir,
        OPENPLANNER_STORAGE_BACKEND: "mongodb",
        OPENPLANNER_KAFKA_ENABLED: "false",
        MONGODB_URI: baseEnv.MONGODB_URI ?? "mongodb://127.0.0.1:27017/openplanner",
        MONGODB_DB: baseEnv.MONGODB_DB ?? "openplanner",
        MONGODB_EVENTS_COLLECTION: baseEnv.MONGODB_EVENTS_COLLECTION ?? "events",
        MONGODB_COMPACTED_COLLECTION: baseEnv.MONGODB_COMPACTED_COLLECTION ?? "compacted_memories",
        MONGODB_VECTOR_HOT_COLLECTION: baseEnv.MONGODB_VECTOR_HOT_COLLECTION ?? "event_chunks",
        MONGODB_VECTOR_COMPACT_COLLECTION: baseEnv.MONGODB_VECTOR_COMPACT_COLLECTION ?? "compacted_vectors",
        MONGODB_GRAPH_LAYOUT_COLLECTION: baseEnv.MONGODB_GRAPH_LAYOUT_COLLECTION ?? "graph_layout_overrides",
        MONGODB_GRAPH_NODE_EMBEDDING_COLLECTION: baseEnv.MONGODB_GRAPH_NODE_EMBEDDING_COLLECTION ?? "graph_REDACTED_SECRET_embeddings",
        MONGODB_EVENTS_TTL_SECONDS: baseEnv.OPENPLANNER_NON_LABELED_EVENTS_TTL_SECONDS ?? "604800",
        MONGODB_COMPACTED_TTL_SECONDS: baseEnv.OPENPLANNER_NON_LABELED_COMPACTED_TTL_SECONDS ?? "2592000",
        SEMANTIC_COMPACTION_ENABLED: baseEnv.SEMANTIC_COMPACTION_ENABLED ?? "false",
        EMBED_PROVIDER_BASE_URL: baseEnv.OPENPLANNER_PROXX_BASE_URL ?? "http://127.0.0.1:8789",
        EMBED_PROVIDER_API_KEY: baseEnv.OPENPLANNER_PROXX_AUTH_TOKEN ?? baseEnv.PROXY_AUTH_TOKEN,
        EMBED_PROVIDER_MODEL: baseEnv.EMBED_PROVIDER_MODEL ?? "nomic-embed-text",
        EMBED_PROVIDER_COMPACT_MODEL: baseEnv.EMBED_PROVIDER_COMPACT_MODEL ?? "nomic-embed-text",
        EMBED_PROVIDER_DIMENSIONS: baseEnv.EMBED_PROVIDER_DIMENSIONS ?? "768",
        EMBED_PROVIDER_BATCH_WINDOW_MS: baseEnv.EMBED_PROVIDER_BATCH_WINDOW_MS ?? "10",
        EMBED_PROVIDER_MAX_BATCH_ITEMS: baseEnv.EMBED_PROVIDER_MAX_BATCH_ITEMS ?? "16",
        EMBED_PROVIDER_CACHE_PATH: path.join(openplannerLakeDir, "cache/embed-provider-cache.jsonl"),
        OPENPLANNER_SOURCE_ROOT: develRoot,
        OPENPLANNER_HYDRATION_CACHE_TTL_MS: baseEnv.OPENPLANNER_HYDRATION_CACHE_TTL_MS ?? "3600000",
        GRAPH_SEMANTIC_EDGE_DECAY_INTERVAL_MS: baseEnv.GRAPH_SEMANTIC_EDGE_DECAY_INTERVAL_MS ?? "3600000",
        GRAPH_SEMANTIC_EDGE_DECAY_LIMIT: baseEnv.GRAPH_SEMANTIC_EDGE_DECAY_LIMIT ?? "250",
      },
      autorestart: true,
      watch: false,
      time: true,
      kill_timeout: 5000,
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: "10s",
    },
  ],
};
