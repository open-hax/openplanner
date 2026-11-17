import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Myrmex } from "../packages/graph/myrmex/src/Myrmex.ts";
import { ShuvCrawlFetchBackend } from "../packages/graph/myrmex/src/shuvcrawl-backend.ts";

async function storedPage(content, metadata = {}) {
  const myrmex = new Myrmex({
    shuvCrawlBaseUrl: "http://shuvcrawl.invalid",
    openPlannerBaseUrl: "http://openplanner.invalid",
    openPlannerApiKey: "test-only-key",
  });
  const writes = [];
  myrmex.graphStore.post = async (_path, body) => writes.push(...body.events);
  const page = {
    type: "page",
    url: "https://example.com/article",
    fetchedAt: 1_700_000_000_000,
    status: 200,
    content,
    metadata,
    outgoingLinks: [{ url: "https://example.com/next", text: "Next article", source: "page" }],
  };
  myrmex.wireEvents({ onEvent: (callback) => callback(page) });
  await myrmex.graphWriteChain;
  return writes;
}

test("Myrmex stores actual SHA-256 of the complete Markdown and retains page graph data", async () => {
  const markdown = `# Readable article\n\n${"Detailed content. ".repeat(40_000)}`;
  const metadata = { requestId: "scrape-test-1", finalUrl: "https://example.com/article" };
  const writes = await storedPage(markdown, metadata);
  const visited = writes.find((event) => event.extra.visit_status === "visited");
  assert.equal(visited.text, markdown);
  assert.equal(visited.extra.contentHash, `sha256:${createHash("sha256").update(markdown).digest("hex")}`);
  assert.equal(visited.extra.metadata.requestId, metadata.requestId);
  assert.equal(visited.extra.metadata.finalUrl, metadata.finalUrl);
  assert.equal(writes.filter((event) => event.kind === "graph.node").length, 2);
  const edge = writes.find((event) => event.kind === "graph.edge");
  assert.equal(edge.extra.anchor_text, "Next article");
  assert.equal(edge.extra.target, "https://example.com/next");
});

test("Myrmex distinguishes content that collided under the previous short hash", async () => {
  const first = (await storedPage("Aa"))[0];
  const second = (await storedPage("BB"))[0];
  assert.notEqual(first.extra.contentHash, second.extra.contentHash);
  assert.match(first.extra.contentHash, /^sha256:[a-f0-9]{64}$/);
});

test("Myrmex hashes the stored empty body when the fetch response has no content", async () => {
  const [visited] = await storedPage(undefined);
  assert.equal(visited.text, "");
  assert.equal(visited.extra.contentHash, `sha256:${createHash("sha256").update("").digest("hex")}`);
});

test("Myrmex requests transient scrape output and preserves links, Markdown, and scrape provenance", async () => {
  const requestedUrl = "https://example.com/redirect";
  const finalUrl = "https://example.com/article";
  const markdown = "# Article\n\nReadable **Markdown**.";
  const rawHtml = '<html><body><a href="/next">Next</a><item><link>https://example.com/feed-entry</link></item></body></html>';
  const requests = [];
  const backend = new ShuvCrawlFetchBackend({
    scrape: async (url, options) => {
      requests.push({ url, options });
      return {
        url: requestedUrl,
        originalUrl: requestedUrl,
        content: markdown,
        rawHtml,
        metadata: {
          requestId: "scrape-test-2",
          title: "Article",
          status: "success",
          elapsed: 12,
          finalUrl,
          bypassMethod: "direct",
        },
      };
    },
  });

  const result = await backend.fetch(requestedUrl);
  assert.deepEqual(requests, [{
    url: requestedUrl,
    options: {
      onlyMainContent: false,
      rawHtml: true,
      persistOutput: false,
      artifacts: false,
      wait: "networkidle",
    },
  }]);
  assert.equal(result.content, markdown);
  assert.equal(result.html, rawHtml);
  assert.equal(result.url, requestedUrl);
  assert.equal(result.metadata.requestId, "scrape-test-2");
  assert.equal(result.metadata.requestedUrl, requestedUrl);
  assert.equal(result.metadata.originalUrl, requestedUrl);
  assert.equal(result.metadata.finalUrl, finalUrl);
  assert.equal(result.metadata.scrapeStatus, "success");
  assert.deepEqual(new Set(result.outgoing), new Set([
    "https://example.com/next",
    "https://example.com/feed-entry",
  ]));
});
