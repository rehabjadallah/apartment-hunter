import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const mocks = vi.hoisted(() => ({ search: vi.fn(), scrape: vi.fn() }));
vi.mock("@firecrawl/firecrawl-convex", () => ({ FirecrawlClient: class { search = mocks.search; scrape = mocks.scrape; } }));
const modules = import.meta.glob("../convex/**/*.ts");
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

async function run(documents: Array<Record<string, unknown> | Error>, urls = documents.map((_, i) => `https://example.com/${i}`), timeoutDuringScrape = false) {
  const t = convexTest(schema, modules);
  const searchId = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", {});
    return ctx.db.insert("searches", { userId, status: "searching", preferences: {
      city: "Ann Arbor, Michigan", minRent: 800, maxRent: 2000, bedrooms: 1, pets: "cat",
      moveIn: "2026-11-01", parking: true, laundry: true, notes: "", } });
  });
  mocks.search.mockResolvedValue({ web: urls.map(url => ({ url })) });
  mocks.scrape.mockImplementation(async (_ctx, url: string) => {
    const doc = documents[Number(new URL(url).pathname.slice(1))];
    if (doc instanceof Error) throw doc;
    if (timeoutDuringScrape) await t.mutation(internal.searches.timeout, { searchId });
    return { json: doc, markdown: "For leasing, contact leasing@example.com", metadata: { statusCode: 200 } };
  });
  await t.action(internal.discovery.run, { searchId });
  return t.run(async ctx => ({ search: await ctx.db.get(searchId), listings: await ctx.db.query("listings").collect() }));
}
const matching = { isListing: true, city: "Ann Arbor", title: "One bedroom", rent: 1500, bedrooms: 1, cats: true, parking: true, laundry: true, contactEmail: "leasing@example.com" };

test("excludes known conflicts and listings outside Ann Arbor", async () => {
  const result = await run([matching, { ...matching, rent: 2400 }, { ...matching, cats: false }, { ...matching, bedrooms: 2 }, { ...matching, city: "Ypsilanti" }]);
  expect(result.listings).toHaveLength(1);
  expect(result.listings[0].matches).toContain("Within your rent range");
  expect(result.search?.status).toBe("complete");
});
test("unknown facts are unconfirmed and ungrounded email addresses are discarded", async () => {
  const result = await run([{ ...matching, rent: null, cats: null, contactEmail: "invented@example.com" }]);
  expect(result.listings[0].unknowns).toContain("Rent not confirmed");
  expect(result.listings[0].unknowns).toContain("Cats allowed: not confirmed");
  expect(result.listings[0].contactEmail).toBeUndefined();
});
test("one failed scrape preserves the other results", async () => {
  const result = await run([new Error("Blocked"), matching]);
  expect(result.listings).toHaveLength(1);
  expect(result.search?.status).toBe("complete");
});
test("stage counts distinguish duplicate URLs, empty pages, conflicts, and inserted listings", async () => {
  mocks.scrape.mockResolvedValueOnce({ metadata: { statusCode: 200 }, markdown: " " });
  const result = await run([{}, matching, { ...matching, rent: 2400 }, new Error("Timed out")], [
    "https://example.com/0", "https://example.com/1", "https://example.com/1", "https://example.com/2", "https://example.com/3",
  ]);
  expect(result.listings).toHaveLength(1);
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 5, urlsAfterDeduplication: 4, pagesWithContent: 2, listingsInserted: 1,
  }));
  expect(vi.mocked(console.info).mock.calls.filter(([message]) => message === "Firecrawl discovery counts")).toHaveLength(1);
  expect(console.info).toHaveBeenCalledWith("Firecrawl page", expect.objectContaining({ url: "https://example.com/0", statusCode: 200 }));
  expect(console.error).toHaveBeenCalledWith("Firecrawl page failed", expect.objectContaining({ url: "https://example.com/3", statusCode: "unknown" }), expect.any(Error));
});
test("deduplication counts URLs before the five-page scrape limit", async () => {
  const result = await run(Array.from({ length: 7 }, () => matching));
  expect(result.listings).toHaveLength(5);
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 7, urlsAfterDeduplication: 7, pagesWithContent: 5, listingsInserted: 5,
  }));
});
test("403 diagnostics distinguish policy refusals, confirmed challenges, and unknown causes", async () => {
  const refused = new ConvexError({ code: "firecrawl_request_failed", status: 403, path: "/v2/scrape",
    message: "Firecrawl /v2/scrape failed (403): We apologize for the inconvenience but we do not support this site." });
  const challenge = Object.assign(new Error("Forbidden"), { status: 403, headers: { "CF-Mitigated": "challenge" } });
  const forbidden = new ConvexError({ status: 403, message: "Forbidden" });
  const result = await run([refused, challenge, forbidden, matching]);
  expect(result.listings).toHaveLength(1);
  for (const [index, reason] of ["Firecrawl policy refusal", "Cloudflare challenge", "Unclassified HTTP 403"].entries()) {
    expect(console.error).toHaveBeenCalledWith("Firecrawl page failed", expect.objectContaining({
      url: `https://example.com/${index}`, statusCode: 403, reason,
    }), expect.any(Error));
  }
});
test("a resolved 403 logs challenge evidence from page metadata", async () => {
  mocks.scrape.mockResolvedValueOnce({ metadata: { statusCode: 403, headers: { "cf-mitigated": "challenge" } }, markdown: "Challenge" });
  await run([{}]);
  expect(console.info).toHaveBeenCalledWith("Firecrawl page", expect.objectContaining({
    url: "https://example.com/0", statusCode: 403, reason: "Cloudflare challenge",
  }));
});
test("all failed scrapes still finish with the existing user-facing error and zero counts", async () => {
  const result = await run([new Error("Timed out")]);
  expect(result.search?.error).toBe("The listing sites could not be read. Please try again.");
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 1, urlsAfterDeduplication: 1, pagesWithContent: 0, listingsInserted: 0,
  }));
});
test("insert counts exclude writes skipped after a search times out", async () => {
  const result = await run([matching], undefined, true);
  expect(result.listings).toHaveLength(0);
  expect(result.search?.status).toBe("failed");
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 1, urlsAfterDeduplication: 1, pagesWithContent: 1, listingsInserted: 0,
  }));
});
test("a search API failure logs zero counts and keeps the existing user-facing error", async () => {
  mocks.search.mockRejectedValueOnce(new Error("Search unavailable"));
  const result = await run([matching]);
  expect(result.search?.error).toBe("The listing search failed. Please try again shortly.");
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 0, urlsAfterDeduplication: 0, pagesWithContent: 0, listingsInserted: 0,
  }));
});
