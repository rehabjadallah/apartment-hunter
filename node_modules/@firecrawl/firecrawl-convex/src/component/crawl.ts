import { ConvexError, v } from "convex/values";
import { paginationOptsValidator, type FunctionHandle } from "convex/server";
import { paginator } from "convex-helpers/server/pagination";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import schema, { crawlMode, crawlStatus } from "./schema.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import { crawlOptionsValidator } from "./validators.js";
import { firecrawlRequest } from "./api.js";
import { withExtra } from "./lib.js";
import { timingSafeEqual } from "./signature.js";

/** Header carrying the per-crawl token that Firecrawl echoes back to us. */
export const TOKEN_HEADER = "x-firecrawl-convex-token";

const WEBHOOK_EVENTS = ["started", "page", "completed", "failed"];

/** Backoff for poll mode, where polling is the only source of progress. */
const POLL = { firstMs: 2_000, factor: 1.6, maxMs: 30_000 };
/** Backoff for the webhook watchdog, which only catches missed deliveries. */
const WATCHDOG = { firstMs: 30_000, factor: 2, maxMs: 300_000 };
/** Give up polling eventually rather than looping forever on a stuck job. */
const MAX_POLL_ATTEMPTS = 250;
/** Documents per ingest mutation, to stay well inside argument size limits. */
const INGEST_BATCH = 10;

/**
 * Content limits, in UTF-8 bytes, to stay inside Convex's 1MB per-document
 * limit with room to spare for system fields and index entries.
 */
const MAX_DOC_BYTES = 900_000;
/** No single field may take more than this much of the document budget. */
const MAX_FIELD_BYTES = 400_000;

/** Pages deleted per transaction by `deleteCrawl`. */
const DELETE_BATCH = 200;

const crawlDoc = schema.tables.crawls.validator.extend({
  _id: v.id("crawls"),
  _creationTime: v.number(),
});

/**
 * What the app sees. Bookkeeping the app has no use for — the webhook token,
 * the callback handle, the result cursor, the poll counter — stays inside.
 */
const publicCrawlDoc = v.object({
  _id: v.id("crawls"),
  _creationTime: v.number(),
  jobId: v.optional(v.string()),
  url: v.string(),
  status: crawlStatus,
  mode: crawlMode,
  storeContent: v.boolean(),
  total: v.optional(v.number()),
  completed: v.optional(v.number()),
  pageCount: v.number(),
  creditsUsed: v.optional(v.number()),
  unstored: v.optional(v.number()),
  error: v.optional(v.string()),
  context: v.optional(v.any()),
  finalized: v.boolean(),
  startedAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

function toPublicCrawl<T extends Record<string, any>>(crawl: T) {
  const {
    token: _token,
    onComplete: _onComplete,
    nextUrl: _nextUrl,
    pollAttempt: _pollAttempt,
    ...rest
  } = crawl;
  return rest;
}

const pageDoc = schema.tables.pages.validator.extend({
  _id: v.id("pages"),
  _creationTime: v.number(),
});

export type CrawlCompletePayload = {
  crawlId: string;
  jobId?: string;
  status: "completed" | "failed" | "cancelled";
  pageCount: number;
  /** Pages Firecrawl returned that could not be stored, if any. */
  unstored?: number;
  error?: string;
  context?: any;
};

/**
 * Public functions take ids as plain strings, because that's what they are on
 * the app side of the component boundary.
 */
function resolveId(ctx: { db: { normalizeId: any } }, crawlId: string) {
  return ctx.db.normalizeId("crawls", crawlId) as Id<"crawls"> | null;
}

function requireId(
  ctx: { db: { normalizeId: any } },
  crawlId: string,
): Id<"crawls"> {
  const id = resolveId(ctx, crawlId);
  if (!id) {
    throw new ConvexError({
      code: "firecrawl_unknown_crawl",
      message: `${crawlId} is not a crawl id.`,
    });
  }
  return id;
}

function now(): number {
  return Date.now();
}

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function messageOf(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | undefined;
    if (data?.message) return data.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Firecrawl reports `scraping | completed | failed | cancelled`. */
function normalizeStatus(status: unknown): Status {
  switch (status) {
    case "completed":
    case "failed":
    case "cancelled":
      return status;
    default:
      return "scraping";
  }
}

type Status = "scraping" | "completed" | "failed" | "cancelled";
type TerminalStatus = Exclude<Status, "scraping">;

function isTerminal(status: Status): status is TerminalStatus {
  return status !== "scraping";
}

function nextDelayMs(mode: "webhook" | "poll", attempt: number): number {
  const { firstMs, factor, maxMs } = mode === "webhook" ? WATCHDOG : POLL;
  return Math.min(firstMs * factor ** attempt, maxMs);
}

type PageFields = {
  url: string;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  summary?: string;
  screenshot?: string;
  links?: string[];
  json?: any;
  changeTracking?: any;
  metadata?: any;
  truncated: boolean;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Serialized size in bytes — what Convex actually measures against its limit. */
function jsonBytes(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : encoder.encode(json).length;
}

/** Cut a string to a byte budget without splitting a UTF-8 code point. */
export function truncateToBytes(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = encoder.encode(value);
  if (bytes.length <= maxBytes) return value;
  let end = maxBytes;
  // Continuation bytes are 10xxxxxx; walk back to the start of a character.
  while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) end--;
  return decoder.decode(bytes.subarray(0, end));
}

/** Largest prefix of `value` whose *JSON* form fits, escaping included. */
function fitString(value: string, maxBytes: number): string {
  if (maxBytes <= 2) return "";
  let target = maxBytes - 2; // the surrounding quotes
  let cut = truncateToBytes(value, target);
  // Escaping (\n, \", …) can push the encoded form back over budget. Shrink by
  // exactly the overflow rather than a percentage, so a two-byte overshoot
  // doesn't cost the caller a chunk of their content.
  for (let attempt = 0; attempt < 8; attempt++) {
    const overflow = jsonBytes(cut) - maxBytes;
    if (overflow <= 0) return cut;
    target -= Math.max(overflow, 1);
    if (target <= 0) return "";
    cut = truncateToBytes(value, target);
  }
  return jsonBytes(cut) <= maxBytes ? cut : "";
}

/** As many leading entries as fit the budget. */
function fitArray(values: string[], maxBytes: number): string[] {
  const kept: string[] = [];
  let used = 2; // []
  for (const value of values) {
    const cost = jsonBytes(value) + 1; // entry plus its comma
    if (used + cost > maxBytes) break;
    kept.push(value);
    used += cost;
  }
  return kept;
}

/** Metadata worth keeping when the whole object won't fit. */
const ESSENTIAL_METADATA = [
  "url",
  "sourceURL",
  "title",
  "description",
  "statusCode",
  "contentType",
  "creditsUsed",
  "cacheState",
  "error",
];

function essentialMetadata(metadata: any): any {
  if (!metadata || typeof metadata !== "object") return metadata;
  const kept: Record<string, unknown> = {};
  for (const key of ESSENTIAL_METADATA) {
    if (metadata[key] !== undefined) kept[key] = metadata[key];
  }
  return kept;
}

/**
 * Fit a page inside Convex's 1MB document limit.
 *
 * Every variable-sized field is budgeted in UTF-8 bytes against the whole
 * serialized document — a character count would undercount by 3x on CJK text,
 * and leaving `metadata`, `json`, `changeTracking`, or `links` unbudgeted lets
 * a single fat `changeTracking` diff blow the limit on its own.
 *
 * Fields are taken in order of usefulness. Text and link lists are truncated;
 * a screenshot, extracted `json`, or `changeTracking` is all-or-nothing,
 * because half a base64 image or half an object is worse than none.
 */
export function clampContent(fields: PageFields): PageFields {
  const clamped: PageFields = { url: fields.url, truncated: fields.truncated };
  // Reserve room for the fields every page carries, plus Convex's own.
  let budget =
    MAX_DOC_BYTES -
    jsonBytes({
      url: fields.url,
      crawlId: "x".repeat(32),
      scrapedAt: 0,
      truncated: false,
      _id: "x".repeat(32),
      _creationTime: 0,
    });

  if (fields.metadata !== undefined) {
    let metadata = fields.metadata;
    let cost = jsonBytes(metadata);
    if (cost > Math.min(MAX_FIELD_BYTES, budget)) {
      metadata = essentialMetadata(metadata);
      cost = jsonBytes(metadata);
      clamped.truncated = true;
    }
    if (cost <= budget) {
      clamped.metadata = metadata;
      budget -= cost;
    } else {
      clamped.truncated = true;
    }
  }

  for (const key of [
    "markdown",
    "summary",
    "json",
    "links",
    "changeTracking",
    "html",
    "rawHtml",
    "screenshot",
  ] as const) {
    const value = fields[key];
    if (value === undefined) continue;

    const allowance = Math.min(MAX_FIELD_BYTES, Math.max(budget, 0));
    const cost = jsonBytes(value);
    if (cost <= allowance) {
      (clamped as any)[key] = value;
      budget -= cost;
      continue;
    }

    clamped.truncated = true;
    if (key === "markdown" || key === "summary" || key === "html" || key === "rawHtml") {
      const cut = fitString(value as string, allowance);
      if (cut.length > 0) {
        (clamped as any)[key] = cut;
        budget -= jsonBytes(cut);
      }
    } else if (key === "links") {
      const kept = fitArray(value as string[], allowance);
      if (kept.length > 0) {
        clamped.links = kept;
        budget -= jsonBytes(kept);
      }
    }
    // screenshot / json / changeTracking are dropped rather than sliced.
  }

  return clamped;
}

/** Map a Firecrawl document onto our page fields. Returns null if it has no URL to key on. */
export function toPageFields(
  document: any,
  storeContent: boolean,
): PageFields | null {
  const metadata = document?.metadata ?? {};
  const url = metadata.url ?? metadata.sourceURL ?? document?.url;
  if (typeof url !== "string" || url.length === 0) return null;

  const fields: PageFields = { url, metadata, truncated: false };
  // Even a metadata-only page needs clamping: metadata is caller-supplied and
  // unbounded.
  if (!storeContent) return clampContent(fields);

  if (typeof document.markdown === "string") fields.markdown = document.markdown;
  if (typeof document.html === "string") fields.html = document.html;
  if (typeof document.rawHtml === "string") fields.rawHtml = document.rawHtml;
  if (typeof document.summary === "string") fields.summary = document.summary;
  if (typeof document.screenshot === "string")
    fields.screenshot = document.screenshot;
  if (Array.isArray(document.links))
    fields.links = document.links.filter(
      (link: unknown): link is string => typeof link === "string",
    );
  if (document.json !== undefined) fields.json = document.json;
  if (document.changeTracking !== undefined)
    fields.changeTracking = document.changeTracking;

  return clampContent(fields);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a crawl. Returns immediately with a `crawlId` to subscribe to; pages
 * and progress land as Firecrawl reports them.
 */
export const start = action({
  args: {
    url: v.string(),
    options: v.optional(crawlOptionsValidator),
    /**
     * `webhook` (default when the component's HTTP routes are mounted) asks
     * Firecrawl to push progress, with a slow poll as a watchdog. `poll` never
     * registers a webhook.
     */
    mode: v.optional(crawlMode),
    /** Store page content, not just URLs and metadata. Defaults to true. */
    storeContent: v.optional(v.boolean()),
    /** Function handle for an app mutation to run on the terminal transition. */
    onComplete: v.optional(v.string()),
    /** Opaque data handed back to `onComplete`. */
    context: v.optional(v.any()),
  },
  returns: v.object({ crawlId: v.string(), jobId: v.string() }),
  handler: async (ctx, args): Promise<{ crawlId: string; jobId: string }> => {
    const siteUrl = process.env.CONVEX_SITE_URL;
    const mode = args.mode ?? (siteUrl ? "webhook" : "poll");
    if (mode === "webhook" && !siteUrl) {
      throw new ConvexError({
        code: "firecrawl_no_site_url",
        message:
          "Webhook mode needs CONVEX_SITE_URL. Mount the component's HTTP routes (`app.use(firecrawl, { httpPrefix: \"/firecrawl/\" })`) or pass mode: \"poll\".",
      });
    }
    const token = randomToken();
    const storeContent = args.storeContent ?? true;

    // Insert first, so a webhook that arrives before /v2/crawl responds still
    // finds a row to attach to.
    const crawlId: Id<"crawls"> = await ctx.runMutation(
      internal.crawl.createCrawl,
      {
        url: args.url,
        mode,
        token,
        storeContent,
        onComplete: args.onComplete,
        context: args.context,
      },
    );

    try {
      const body = await firecrawlRequest("/v2/crawl", {
        body: {
          url: args.url,
          ...withExtra(args.options),
          ...(mode === "webhook"
            ? {
                webhook: {
                  url: `${siteUrl}/webhook`,
                  headers: { [TOKEN_HEADER]: token },
                  metadata: { crawlId },
                  events: WEBHOOK_EVENTS,
                },
              }
            : {}),
        },
      });
      const jobId = body.id;
      if (typeof jobId !== "string" || jobId.length === 0) {
        throw new ConvexError({
          code: "firecrawl_no_job_id",
          message: "Firecrawl /v2/crawl did not return a job id.",
        });
      }
      await ctx.runMutation(internal.crawl.attachJob, { crawlId, jobId });
      await ctx.scheduler.runAfter(
        nextDelayMs(mode, 0),
        internal.crawl.poll,
        { crawlId },
      );
      return { crawlId, jobId };
    } catch (error) {
      await ctx.runMutation(internal.crawl.finalize, {
        crawlId,
        status: "failed",
        error: messageOf(error),
      });
      throw error;
    }
  },
});

/** Current state of a crawl: status, progress counters, credits, error. */
export const get = query({
  args: { crawlId: v.string() },
  returns: v.union(v.null(), publicCrawlDoc),
  handler: async (ctx, args) => {
    const id = resolveId(ctx, args.crawlId);
    const crawl = id && (await ctx.db.get("crawls", id));
    return crawl ? toPublicCrawl(crawl) : null;
  },
});

/** Look a crawl up by Firecrawl's job id. */
export const getByJobId = query({
  args: { jobId: v.string() },
  returns: v.union(v.null(), publicCrawlDoc),
  handler: async (ctx, args) => {
    const crawl = await ctx.db
      .query("crawls")
      .withIndex("jobId", (q) => q.eq("jobId", args.jobId))
      .first();
    return crawl && toPublicCrawl(crawl);
  },
});

/** Most recent crawls, newest first, optionally filtered by status. */
export const listCrawls = query({
  args: {
    status: v.optional(crawlStatus),
    limit: v.optional(v.number()),
  },
  returns: v.array(publicCrawlDoc),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);
    const crawls =
      args.status !== undefined
        ? await ctx.db
            .query("crawls")
            .withIndex("status", (q) => q.eq("status", args.status!))
            .order("desc")
            .take(limit)
        : await ctx.db.query("crawls").order("desc").take(limit);
    return crawls.map(toPublicCrawl);
  },
});

/** Pages of a crawl, paginated by URL. Works with React's `usePaginatedQuery`. */
export const listPages = query({
  args: {
    crawlId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(pageDoc),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(v.union(v.string(), v.null())),
  }),
  handler: async (ctx, args) =>
    await paginator(ctx.db, schema)
      .query("pages")
      .withIndex("crawlId_url", (q) =>
        q.eq("crawlId", requireId(ctx, args.crawlId)),
      )
      .paginate(args.paginationOpts),
});

/** A single crawled page by URL. */
export const getPage = query({
  args: { crawlId: v.string(), url: v.string() },
  returns: v.union(v.null(), pageDoc),
  handler: async (ctx, args) => {
    const id = resolveId(ctx, args.crawlId);
    if (!id) return null;
    return await ctx.db
      .query("pages")
      .withIndex("crawlId_url", (q) => q.eq("crawlId", id).eq("url", args.url))
      .first();
  },
});

/** Ask Firecrawl to cancel a running crawl. */
export const cancel = action({
  args: { crawlId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const crawl: Doc<"crawls"> | null = await ctx.runQuery(
      internal.crawl.getByIdString,
      { crawlId: args.crawlId },
    );
    if (!crawl) {
      throw new ConvexError({
        code: "firecrawl_unknown_crawl",
        message: `No crawl ${args.crawlId}.`,
      });
    }
    if (crawl.jobId && !crawl.finalized) {
      await firecrawlRequest(`/v2/crawl/${crawl.jobId}`, { method: "DELETE" });
    }
    await ctx.runMutation(internal.crawl.finalize, {
      crawlId: crawl._id,
      status: "cancelled",
    });
    return null;
  },
});

/**
 * Start tracking a crawl again after the component gave up on it — either
 * because it exhausted its status checks or because you cancelled locally
 * while Firecrawl kept going. No-op for a crawl that genuinely completed.
 */
export const resume = mutation({
  args: { crawlId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const crawl = await ctx.db.get("crawls", requireId(ctx, args.crawlId));
    if (!crawl || !crawl.jobId) return false;
    if (crawl.status === "completed") return false;

    await ctx.db.patch("crawls", crawl._id, {
      status: "scraping",
      finalized: false,
      completedAt: undefined,
      error: undefined,
      pollAttempt: 0,
      updatedAt: now(),
    });
    await ctx.scheduler.runAfter(0, internal.crawl.poll, {
      crawlId: crawl._id,
    });
    return true;
  },
});

/**
 * Delete a crawl and its pages. Large crawls are deleted across several
 * scheduled transactions.
 */
export const deleteCrawl = mutation({
  args: { crawlId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const id = resolveId(ctx, args.crawlId);
    if (id) await deletePages(ctx, id);
    return null;
  },
});

async function deletePages(ctx: MutationLike, crawlId: any): Promise<void> {
  const pages = await ctx.db
    .query("pages")
    .withIndex("crawlId", (q: any) => q.eq("crawlId", crawlId))
    .take(DELETE_BATCH);
  for (const page of pages) {
    await ctx.db.delete("pages", page._id);
  }
  if (pages.length === DELETE_BATCH) {
    await ctx.scheduler.runAfter(0, internal.crawl.continueDelete, { crawlId });
    return;
  }
  const crawl = await ctx.db.get("crawls", crawlId);
  if (crawl) await ctx.db.delete("crawls", crawlId);
}

export const continueDelete = internalMutation({
  args: { crawlId: v.id("crawls") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await deletePages(ctx, args.crawlId);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

export const createCrawl = internalMutation({
  args: {
    url: v.string(),
    mode: crawlMode,
    token: v.string(),
    storeContent: v.boolean(),
    onComplete: v.optional(v.string()),
    context: v.optional(v.any()),
  },
  returns: v.id("crawls"),
  handler: async (ctx, args) =>
    await ctx.db.insert("crawls", {
      ...args,
      status: "scraping",
      pageCount: 0,
      finalized: false,
      pollAttempt: 0,
      startedAt: now(),
      updatedAt: now(),
    }),
});

export const attachJob = internalMutation({
  args: { crawlId: v.id("crawls"), jobId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("crawls", args.crawlId, {
      jobId: args.jobId,
      updatedAt: now(),
    });
    return null;
  },
});

export const getByIdString = internalQuery({
  args: { crawlId: v.string() },
  returns: v.union(v.null(), crawlDoc),
  handler: async (ctx, args) => {
    const id = resolveId(ctx, args.crawlId);
    return id ? await ctx.db.get("crawls", id) : null;
  },
});

export const getInternal = internalQuery({
  args: { crawlId: v.id("crawls") },
  returns: v.union(v.null(), crawlDoc),
  handler: async (ctx, args) => await ctx.db.get("crawls", args.crawlId),
});

/**
 * Upsert Firecrawl documents as pages of a crawl. Keyed on (crawlId, url), so
 * a page delivered by both a webhook and a status poll lands once.
 */
async function ingestDocuments(
  ctx: MutationLike,
  crawlId: any,
  documents: any[],
): Promise<number> {
  const crawl = await ctx.db.get("crawls", crawlId);
  if (!crawl) return 0;

  let added = 0;
  for (const document of documents) {
    const fields = toPageFields(document, crawl.storeContent);
    if (!fields) continue;
    const existing = await ctx.db
      .query("pages")
      .withIndex("crawlId_url", (q: any) =>
        q.eq("crawlId", crawlId).eq("url", fields.url),
      )
      .first();
    if (existing) {
      await ctx.db.patch("pages", existing._id, {
        ...fields,
        scrapedAt: now(),
      });
    } else {
      await ctx.db.insert("pages", {
        ...fields,
        crawlId,
        scrapedAt: now(),
      });
      added++;
    }
  }
  if (added > 0) {
    await ctx.db.patch("crawls", crawlId, {
      pageCount: crawl.pageCount + added,
      updatedAt: now(),
    });
  }
  return added;
}

export const ingestPages = internalMutation({
  args: { crawlId: v.id("crawls"), documents: v.array(v.any()) },
  returns: v.number(),
  handler: async (ctx, args) =>
    await ingestDocuments(ctx, args.crawlId, args.documents),
});

/**
 * Record progress from a status response and decide what happens next:
 * follow the result cursor, schedule the next poll, or finalize.
 */
export const advance = internalMutation({
  args: {
    crawlId: v.id("crawls"),
    status: crawlStatus,
    total: v.optional(v.number()),
    completed: v.optional(v.number()),
    creditsUsed: v.optional(v.number()),
    nextUrl: v.optional(v.string()),
    /** Pages this pass couldn't store, e.g. an oversized document. */
    unstored: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const crawl = await ctx.db.get("crawls", args.crawlId);
    if (!crawl || crawl.finalized) return null;

    const pollAttempt = crawl.pollAttempt + 1;
    const unstored = (crawl.unstored ?? 0) + (args.unstored ?? 0);
    await ctx.db.patch("crawls", args.crawlId, {
      status: args.status,
      total: args.total ?? crawl.total,
      completed: args.completed ?? crawl.completed,
      creditsUsed: args.creditsUsed ?? crawl.creditsUsed,
      nextUrl: args.nextUrl,
      pollAttempt,
      unstored: unstored > 0 ? unstored : undefined,
      updatedAt: now(),
    });

    // More result pages to read: keep going before deciding anything.
    if (args.nextUrl) {
      await ctx.scheduler.runAfter(0, internal.crawl.poll, {
        crawlId: args.crawlId,
      });
      return null;
    }

    if (isTerminal(args.status)) {
      await finalizeCrawl(ctx, args.crawlId, args.status);
      return null;
    }

    if (pollAttempt >= MAX_POLL_ATTEMPTS) {
      // Terminal, so subscribers and `onComplete` aren't left waiting forever.
      // The job may well still be running on Firecrawl, hence `resume`.
      await finalizeCrawl(
        ctx,
        args.crawlId,
        "failed",
        `Stopped tracking after ${MAX_POLL_ATTEMPTS} status checks. The crawl may still be running on Firecrawl — call resume({ crawlId }) to pick tracking back up.`,
      );
      return null;
    }

    await ctx.scheduler.runAfter(
      nextDelayMs(crawl.mode, pollAttempt),
      internal.crawl.poll,
      { crawlId: args.crawlId },
    );
    return null;
  },
});

/** A status check failed transiently; back off and try again. */
export const retryLater = internalMutation({
  args: { crawlId: v.id("crawls"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const crawl = await ctx.db.get("crawls", args.crawlId);
    if (!crawl || crawl.finalized) return null;
    const pollAttempt = crawl.pollAttempt + 1;
    await ctx.db.patch("crawls", args.crawlId, {
      pollAttempt,
      error: args.error,
      updatedAt: now(),
    });
    if (pollAttempt >= MAX_POLL_ATTEMPTS) {
      await finalizeCrawl(ctx, args.crawlId, "failed", args.error);
      return null;
    }
    await ctx.scheduler.runAfter(
      nextDelayMs(crawl.mode, pollAttempt),
      internal.crawl.poll,
      { crawlId: args.crawlId },
    );
    return null;
  },
});

/**
 * Read crawl status from Firecrawl and ingest whatever pages it hands back.
 * Used for poll mode, as a watchdog for missed webhooks, and to reconcile once
 * a `crawl.completed` webhook arrives.
 */
export const poll = internalAction({
  args: { crawlId: v.id("crawls") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const crawl: Doc<"crawls"> | null = await ctx.runQuery(
      internal.crawl.getInternal,
      { crawlId: args.crawlId },
    );
    if (!crawl || crawl.finalized || !crawl.jobId) return null;

    let body: Record<string, any>;
    try {
      body = await firecrawlRequest(`/v2/crawl/${crawl.jobId}`, {
        method: "GET",
        absoluteUrl: crawl.nextUrl,
      });
    } catch (error) {
      await ctx.runMutation(internal.crawl.retryLater, {
        crawlId: args.crawlId,
        error: messageOf(error),
      });
      return null;
    }

    // A batch that fails to store must not take the poll chain down with it:
    // this runs in a scheduled action, so an uncaught throw here would leave
    // the crawl stuck in `scraping` with nothing scheduled to revive it.
    const documents: any[] = Array.isArray(body.data) ? body.data : [];
    let unstored = 0;
    for (let i = 0; i < documents.length; i += INGEST_BATCH) {
      const batch = documents.slice(i, i + INGEST_BATCH);
      try {
        await ctx.runMutation(internal.crawl.ingestPages, {
          crawlId: args.crawlId,
          documents: batch,
        });
      } catch (error) {
        unstored += batch.length;
        console.error(
          `firecrawl: could not store ${batch.length} page(s) of crawl ${args.crawlId}: ${messageOf(error)}`,
        );
      }
    }

    await ctx.runMutation(internal.crawl.advance, {
      unstored,
      crawlId: args.crawlId,
      status: normalizeStatus(body.status),
      total: typeof body.total === "number" ? body.total : undefined,
      completed: typeof body.completed === "number" ? body.completed : undefined,
      creditsUsed:
        typeof body.creditsUsed === "number" ? body.creditsUsed : undefined,
      nextUrl: typeof body.next === "string" ? body.next : undefined,
    });
    return null;
  },
});

export const finalize = internalMutation({
  args: {
    crawlId: v.id("crawls"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await finalizeCrawl(ctx, args.crawlId, args.status, args.error);
    return null;
  },
});

/**
 * Handle one Firecrawl webhook delivery. Returns whether it was accepted so
 * the HTTP route can answer 200 (handled) or 401 (bad token).
 */
export const handleWebhook = internalMutation({
  args: {
    crawlId: v.optional(v.string()),
    jobId: v.optional(v.string()),
    type: v.optional(v.string()),
    success: v.boolean(),
    error: v.optional(v.string()),
    token: v.union(v.string(), v.null()),
    documents: v.array(v.any()),
  },
  returns: v.object({
    accepted: v.boolean(),
    reason: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ accepted: boolean; reason?: string }> => {
    const id = args.crawlId
      ? ctx.db.normalizeId("crawls", args.crawlId)
      : null;
    const crawl = id
      ? await ctx.db.get("crawls", id)
      : args.jobId
        ? await ctx.db
            .query("crawls")
            .withIndex("jobId", (q) => q.eq("jobId", args.jobId))
            .first()
        : null;
    // Nothing to attach this to (deleted crawl, or a stray delivery). Accept it
    // so Firecrawl stops retrying.
    if (!crawl) return { accepted: true, reason: "unknown crawl" };

    if (args.token === null || !timingSafeEqual(crawl.token, args.token)) {
      return { accepted: false, reason: "bad token" };
    }
    if (crawl.finalized) return { accepted: true, reason: "already finalized" };

    const event = (args.type ?? "").split(".").pop();

    if (args.documents.length > 0) {
      await ingestDocuments(ctx, crawl._id, args.documents);
    }

    if (event === "completed") {
      // Trust the event for the status, but reconcile through the status
      // endpoint before finalizing, so a dropped `page` delivery can't leave a
      // gap in the stored pages.
      await ctx.db.patch("crawls", crawl._id, {
        status: "completed",
        updatedAt: now(),
      });
      await ctx.scheduler.runAfter(0, internal.crawl.poll, {
        crawlId: crawl._id,
      });
    } else if (event === "failed" || !args.success) {
      await finalizeCrawl(
        ctx,
        crawl._id,
        "failed",
        args.error ?? "Firecrawl reported the crawl failed.",
      );
    } else {
      await ctx.db.patch("crawls", crawl._id, { updatedAt: now() });
    }

    return { accepted: true };
  },
});

type MutationLike = {
  db: any;
  scheduler: { runAfter: any };
};

/** Terminal transition, exactly once, then the app's `onComplete` callback. */
async function finalizeCrawl(
  ctx: MutationLike,
  crawlId: any,
  status: "completed" | "failed" | "cancelled",
  error?: string,
): Promise<void> {
  const crawl = await ctx.db.get("crawls", crawlId);
  if (!crawl || crawl.finalized) return;

  await ctx.db.patch("crawls", crawlId, {
    status,
    finalized: true,
    completedAt: now(),
    nextUrl: undefined,
    updatedAt: now(),
    ...(error ? { error } : {}),
  });

  if (!crawl.onComplete) return;
  const handle = crawl.onComplete as FunctionHandle<
    "mutation",
    CrawlCompletePayload
  >;
  await ctx.scheduler.runAfter(0, handle, {
    crawlId: crawlId as string,
    jobId: crawl.jobId,
    status,
    pageCount: crawl.pageCount,
    unstored: crawl.unstored,
    error: error ?? crawl.error,
    context: crawl.context,
  });
}

export const _test = {
  clampContent,
  toPageFields,
  nextDelayMs,
  normalizeStatus,
  truncateToBytes,
};
