import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const crawlStatus = v.union(
  v.literal("scraping"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const crawlMode = v.union(v.literal("webhook"), v.literal("poll"));

export default defineSchema({
  crawls: defineTable({
    /** Firecrawl's crawl job id. Absent for the brief window before /v2/crawl responds. */
    jobId: v.optional(v.string()),
    url: v.string(),
    status: crawlStatus,
    /** How progress reaches us: Firecrawl webhooks (with a poll watchdog) or polling only. */
    mode: crawlMode,
    /** Shared secret echoed back by Firecrawl on every webhook delivery for this crawl. */
    token: v.string(),
    /** When false, pages are recorded with metadata only — no markdown/html kept. */
    storeContent: v.boolean(),
    /** Pages Firecrawl attempted, as last reported. */
    total: v.optional(v.number()),
    /** Pages Firecrawl finished, as last reported. */
    completed: v.optional(v.number()),
    /** Pages we have stored locally. */
    pageCount: v.number(),
    creditsUsed: v.optional(v.number()),
    /**
     * Pages Firecrawl returned that we could not store, e.g. a document that
     * stayed over Convex's 1MB limit even after clamping. Surfaced to the app
     * so lost content is never silent.
     */
    unstored: v.optional(v.number()),
    error: v.optional(v.string()),
    /** Cursor into the result stream, from the `next` field of a status response. */
    nextUrl: v.optional(v.string()),
    /** App mutation to call once the crawl reaches a terminal state. */
    onComplete: v.optional(v.string()),
    /** Opaque app data handed back to `onComplete`. */
    context: v.optional(v.any()),
    /** Set once the terminal transition has been handled, so it happens exactly once. */
    finalized: v.boolean(),
    pollAttempt: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("jobId", ["jobId"])
    .index("status", ["status"]),

  pages: defineTable({
    crawlId: v.id("crawls"),
    url: v.string(),
    markdown: v.optional(v.string()),
    html: v.optional(v.string()),
    rawHtml: v.optional(v.string()),
    summary: v.optional(v.string()),
    screenshot: v.optional(v.string()),
    links: v.optional(v.array(v.string())),
    json: v.optional(v.any()),
    changeTracking: v.optional(v.any()),
    metadata: v.optional(v.any()),
    /** True when content was dropped or cut to fit Convex's 1MB document limit. */
    truncated: v.boolean(),
    scrapedAt: v.number(),
  })
    .index("crawlId", ["crawlId"])
    .index("crawlId_url", ["crawlId", "url"]),
});
