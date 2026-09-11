import { v } from "convex/values";

/**
 * Argument validators mirroring the Firecrawl v2 API.
 *
 * These stay deliberately close to the REST payloads: every field is passed
 * through untouched, so the Firecrawl docs are the reference for behavior.
 * Each options object also accepts `extra`, an escape hatch for API fields
 * that ship before this component knows about them.
 */

const extra = v.optional(v.record(v.string(), v.any()));

/**
 * A format is either a bare string ("markdown") or an object with a `type`
 * plus per-format settings, e.g. `{ type: "json", prompt, schema }`.
 */
export const formatValidator = v.union(
  v.literal("markdown"),
  v.literal("html"),
  v.literal("rawHtml"),
  v.literal("links"),
  v.literal("images"),
  v.literal("screenshot"),
  v.literal("summary"),
  v.literal("changeTracking"),
  v.literal("json"),
  v.literal("attributes"),
  v.literal("branding"),
  v.literal("product"),
  v.literal("menu"),
  v.literal("audio"),
  v.literal("video"),
  v.object({
    type: v.string(),
    // json / changeTracking
    prompt: v.optional(v.string()),
    schema: v.optional(v.any()),
    modes: v.optional(v.array(v.string())),
    tag: v.optional(v.string()),
    // screenshot
    fullPage: v.optional(v.boolean()),
    quality: v.optional(v.number()),
    viewport: v.optional(
      v.object({ width: v.number(), height: v.number() }),
    ),
    // attributes
    selectors: v.optional(
      v.array(v.object({ selector: v.string(), attribute: v.string() })),
    ),
    // question / highlights
    question: v.optional(v.string()),
    query: v.optional(v.string()),
    mode: v.optional(v.string()),
  }),
);

export const locationValidator = v.object({
  country: v.optional(v.string()),
  languages: v.optional(v.array(v.string())),
});

export const scrapeOptionsValidator = v.object({
  formats: v.optional(v.array(formatValidator)),
  headers: v.optional(v.record(v.string(), v.string())),
  includeTags: v.optional(v.array(v.string())),
  excludeTags: v.optional(v.array(v.string())),
  onlyMainContent: v.optional(v.boolean()),
  timeout: v.optional(v.number()),
  waitFor: v.optional(v.number()),
  mobile: v.optional(v.boolean()),
  parsers: v.optional(v.array(v.union(v.string(), v.any()))),
  actions: v.optional(v.array(v.any())),
  location: v.optional(locationValidator),
  skipTlsVerification: v.optional(v.boolean()),
  removeBase64Images: v.optional(v.boolean()),
  blockAds: v.optional(v.boolean()),
  proxy: v.optional(v.string()),
  maxAge: v.optional(v.number()),
  minAge: v.optional(v.number()),
  storeInCache: v.optional(v.boolean()),
  lockdown: v.optional(v.boolean()),
  redactPII: v.optional(v.union(v.boolean(), v.any())),
  zeroDataRetention: v.optional(v.boolean()),
  extra,
});

export const mapOptionsValidator = v.object({
  search: v.optional(v.string()),
  sitemap: v.optional(
    v.union(v.literal("only"), v.literal("include"), v.literal("skip")),
  ),
  includeSubdomains: v.optional(v.boolean()),
  ignoreQueryParameters: v.optional(v.boolean()),
  limit: v.optional(v.number()),
  timeout: v.optional(v.number()),
  location: v.optional(locationValidator),
  extra,
});

export const searchOptionsValidator = v.object({
  sources: v.optional(v.array(v.union(v.string(), v.any()))),
  categories: v.optional(v.array(v.union(v.string(), v.any()))),
  includeDomains: v.optional(v.array(v.string())),
  excludeDomains: v.optional(v.array(v.string())),
  limit: v.optional(v.number()),
  tbs: v.optional(v.string()),
  location: v.optional(v.string()),
  ignoreInvalidURLs: v.optional(v.boolean()),
  timeout: v.optional(v.number()),
  highlights: v.optional(v.boolean()),
  scrapeOptions: v.optional(scrapeOptionsValidator),
  extra,
});

export const crawlOptionsValidator = v.object({
  prompt: v.optional(v.string()),
  includePaths: v.optional(v.array(v.string())),
  excludePaths: v.optional(v.array(v.string())),
  maxDiscoveryDepth: v.optional(v.number()),
  sitemap: v.optional(
    v.union(v.literal("only"), v.literal("include"), v.literal("skip")),
  ),
  ignoreQueryParameters: v.optional(v.boolean()),
  deduplicateSimilarURLs: v.optional(v.boolean()),
  limit: v.optional(v.number()),
  crawlEntireDomain: v.optional(v.boolean()),
  allowExternalLinks: v.optional(v.boolean()),
  allowSubdomains: v.optional(v.boolean()),
  ignoreRobotsTxt: v.optional(v.boolean()),
  robotsUserAgent: v.optional(v.string()),
  delay: v.optional(v.number()),
  maxConcurrency: v.optional(v.number()),
  regexOnFullURL: v.optional(v.boolean()),
  zeroDataRetention: v.optional(v.boolean()),
  scrapeOptions: v.optional(scrapeOptionsValidator),
  extra,
});
