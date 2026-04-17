import { Myrmex } from "./Myrmex.js";

function env(key: string, fallback?: string): string {
  const val = process.env[key];
  if (val === undefined && fallback === undefined) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
  return val ?? fallback ?? "";
}

async function main() {
  const seedUrls = (env("SEED_URLS", "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const openPlannerBaseUrl = env("OPENPLANNER_BASE_URL", "").trim();
  const openPlannerApiKey = env("OPENPLANNER_API_KEY", "").trim();
  const proxxBaseUrl = env("PROXX_BASE_URL", "").trim();
  const proxxAuthToken = env("PROXX_AUTH_TOKEN", "").trim();
  if (openPlannerBaseUrl && !openPlannerApiKey) {
    console.error("OPENPLANNER_API_KEY is required when OPENPLANNER_BASE_URL is set");
    process.exit(1);
  }
  if (proxxBaseUrl && !proxxAuthToken) {
    console.error("PROXX_AUTH_TOKEN is required when PROXX_BASE_URL is set");
    process.exit(1);
  }
  if (!openPlannerBaseUrl && !proxxBaseUrl) {
    console.error("Configure either OPENPLANNER_BASE_URL or PROXX_BASE_URL before starting Myrmex");
    process.exit(1);
  }
  const includePatterns = (env("MYRMEX_INCLUDE_PATTERNS", "") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const excludePatterns = (env(
    "MYRMEX_EXCLUDE_PATTERNS",
    "github.githubassets.com,avatars.githubusercontent.com,user-images.githubusercontent.com,private-user-images.githubusercontent.com,github-cloud.s3.amazonaws.com,objects.githubusercontent.com,opengraph.githubassets.com,news.ycombinator.com/vote?id=,news.ycombinator.com/hide?id=,news.ycombinator.com/login?goto=,github.com/login?return_to=,/login?,/logout,/session,/notifications,/settings/",
  ) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const myrmex = new Myrmex({
    shuvCrawlBaseUrl: env("SHUVCRAWL_BASE_URL", "http://localhost:3777"),
    shuvCrawlToken: env("SHUVCRAWL_TOKEN"),
    proxxBaseUrl,
    proxxAuthToken,
    openPlannerBaseUrl,
    openPlannerApiKey,
    project: env("MYRMEX_PROJECT", "web"),
    source: env("MYRMEX_SOURCE", "myrmex"),
    includePatterns,
    excludePatterns,
    ants: parseInt(env("MYRMEX_ANTS", "4"), 10),
    dispatchIntervalMs: parseInt(env("MYRMEX_DISPATCH_INTERVAL_MS", "15000"), 10),
    maxDispatchBurst: parseInt(env("MYRMEX_MAX_DISPATCH_BURST", env("MYRMEX_MAX_CONCURRENCY", "2")), 10),
    maxFrontier: parseInt(env("MYRMEX_MAX_FRONTIER", "20000"), 10),
    maxConcurrency: parseInt(env("MYRMEX_MAX_CONCURRENCY", "2"), 10),
    perHostMinIntervalMs: parseInt(env("MYRMEX_PER_HOST_MIN_INTERVAL_MS", "4000"), 10),
    requestTimeoutMs: parseInt(env("MYRMEX_REQUEST_TIMEOUT_MS", "15000"), 10),
    revisitAfterMs: parseInt(env("MYRMEX_REVISIT_AFTER_MS", String(1000 * 60 * 60 * 8)), 10),
    deposit: parseFloat(env("MYRMEX_DEPOSIT", "0.35")),
    hostBalanceExponent: parseFloat(env("MYRMEX_HOST_BALANCE_EXPONENT", "0.7")),
    startupJitterMs: parseInt(env("MYRMEX_STARTUP_JITTER_MS", "750"), 10),
    openPlannerMaxPendingWrites: parseInt(env("MYRMEX_OPENPLANNER_MAX_PENDING_WRITES", "8"), 10),
    openPlannerResumePendingWrites: parseInt(env("MYRMEX_OPENPLANNER_RESUME_PENDING_WRITES", "2"), 10),
    openPlannerMaxEventsPerWrite: parseInt(env("MYRMEX_OPENPLANNER_MAX_EVENTS_PER_WRITE", "128"), 10),
    openPlannerHealthTimeoutMs: parseInt(env("MYRMEX_OPENPLANNER_HEALTH_TIMEOUT_MS", "5000"), 10),
    openPlannerWriteTimeoutMs: parseInt(env("MYRMEX_OPENPLANNER_WRITE_TIMEOUT_MS", "60000"), 10),
    openPlannerHealthPollMs: parseInt(env("MYRMEX_OPENPLANNER_HEALTH_POLL_MS", "2000"), 10),
    openPlannerBackoffBaseMs: parseInt(env("MYRMEX_OPENPLANNER_BACKOFF_BASE_MS", "2000"), 10),
    openPlannerBackoffMaxMs: parseInt(env("MYRMEX_OPENPLANNER_BACKOFF_MAX_MS", "60000"), 10),
  });

  myrmex.onEvent((ev) => {
    if (ev.type === "page") {
      console.log(`[myrmex] page: ${ev.url} (${ev.title || "no title"}) [${ev.outgoing.length} links]`);
    } else if (ev.type === "error") {
      console.error(`[myrmex] error: ${ev.url} - ${ev.message}`);
    } else if (ev.type === "checkpoint") {
      console.log(`[myrmex] checkpoint: ${ev.nodeCount} nodes, ${ev.frontierSize} frontier`);
    }
  });

  if (seedUrls.length > 0) {
    console.log(`[myrmex] seeding ${seedUrls.length} URLs`);
    myrmex.seed(seedUrls);
  }

  console.log("[myrmex] starting...");
  await myrmex.start();

  // Log stats every 30s
  setInterval(() => {
    const s = myrmex.stats();
    console.log(`[myrmex] stats: ${formatStats(s)}`);
  }, 30_000);

  // Graceful shutdown
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      console.log(`[myrmex] received ${sig}, stopping...`);
      myrmex.stop();
      process.exit(0);
    });
  }
}

function formatStats(s: ReturnType<typeof Myrmex.prototype.stats>): string {
  const backpressure = s.graphBackpressure.active
    ? `backpressure(wait=${s.graphBackpressure.waitMs}ms streak=${s.graphBackpressure.streak}${s.graphBackpressure.reason ? ` reason=${s.graphBackpressure.reason}` : ""})`
    : "backpressure(clear)";
  const pauseInfo = s.pauseReason ? ` pauseReason=${JSON.stringify(s.pauseReason)}` : "";
  return `running=${s.running} paused=${s.paused}${pauseInfo} frontier=${s.frontierSize} inFlight=${s.inFlight} pages=${s.pageCount} errors=${s.errorCount} pendingWrites=${s.pendingGraphWrites} ${backpressure} heartbeat(${s.heartbeat.statusLine})`;
}

main().catch((err) => {
  console.error("[myrmex] fatal:", err);
  process.exit(1);
});
