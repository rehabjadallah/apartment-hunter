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
const matchingUnit = { title: "One bedroom", rent: 1500, bedrooms: 1 };
const matching = { isListing: true, city: "Ann Arbor", summary: "Apartments near downtown.", cats: true, parking: true, laundry: true, contactEmail: "leasing@example.com", units: [matchingUnit] };

test("search excludes non-sources and directories while allowing RentCafe", async () => {
  await run([matching]);
  expect(mocks.search).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({
    excludeDomains: ["zillow.com", "apartments.com", "realtor.com", "redfin.com", "reddit.com",
      "facebook.com", "yelp.com", "hometogo.com", "tripadvisor.com", "airbnb.com", "vrbo.com",
      "pinterest.com", "homes.com", "trulia.com"],
  }));
});
test("excludes known conflicts and listings outside Ann Arbor", async () => {
  const result = await run([matching, { ...matching, units: [{ ...matchingUnit, rent: 2400 }] }, { ...matching, cats: false },
    { ...matching, units: [{ ...matchingUnit, bedrooms: 2 }] }, { ...matching, city: "Ypsilanti" }]);
  expect(result.listings).toHaveLength(1);
  expect(result.listings[0].matches).toContain("Within your rent range");
  expect(result.search?.status).toBe("complete");
});
test("unknown facts are unconfirmed and ungrounded email addresses are discarded", async () => {
  const result = await run([{ ...matching, units: [{ ...matchingUnit, rent: null }], cats: null, contactEmail: "invented@example.com" }]);
  expect(result.listings[0].unknowns).toContain("Rent not confirmed");
  expect(result.listings[0].unknowns).toContain("Cats allowed: not confirmed");
  expect(result.listings[0].contactEmail).toBeUndefined();
});
test("a page with five units inserts five listings with shared property facts", async () => {
  const units = [1000, 1250, 1500, 1750, 2000].map((rent, i) => ({ ...matchingUnit, title: `Plan ${i + 1}`, rent }));
  const result = await run([{ ...matching, units }]);
  expect(result.listings).toHaveLength(5);
  expect(result.listings.map(({ title, rent, bedrooms }) => ({ title, rent, bedrooms }))).toEqual(units);
  for (const listing of result.listings) {
    expect(listing).toMatchObject({ url: "https://example.com/0", summary: "Apartments near downtown.", contactEmail: "leasing@example.com" });
    expect(listing.matches).toEqual(["Ann Arbor", "Within your rent range", "1 bedrooms", "Cats allowed", "Parking", "In-unit laundry"]);
    expect(listing.unknowns).toEqual(["Move-in availability and current pricing need confirmation"]);
  }
  expect(console.info).toHaveBeenCalledWith("Firecrawl page", expect.objectContaining({
    url: "https://example.com/0", isListing: true, city: "Ann Arbor", unitsExtracted: 5,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    pagesWithContent: 1, listingsInserted: 5, unitsExtracted: 5, unitsInserted: 5,
  }));
});
test("a page with five units inserts two when three rents exceed the budget", async () => {
  const units = [2100, 1000, 2400, 3000, 2000].map((rent, i) => ({ ...matchingUnit, title: `Plan ${i + 1}`, rent }));
  const result = await run([{ ...matching, units }]);
  expect(result.listings.map(({ title, rent }) => ({ title, rent }))).toEqual([
    { title: "Plan 2", rent: 1000 }, { title: "Plan 5", rent: 2000 },
  ]);
  expect(console.info).toHaveBeenCalledWith("Firecrawl unit drops", expect.objectContaining({
    url: "https://example.com/0", "rent out of range": 3, "bedrooms mismatch": 0,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({ unitsExtracted: 5, unitsInserted: 2 }));
});
test("unit conflicts do not discard other units and each listing has its own unknowns", async () => {
  const result = await run([{ ...matching, units: [
    { ...matchingUnit, rent: 700 }, { ...matchingUnit, bedrooms: 2 },
    { title: "Unconfirmed", rent: null, bedrooms: null }, matchingUnit,
  ] }]);
  expect(result.listings).toHaveLength(2);
  expect(result.listings[0]).toMatchObject({ title: "Unconfirmed", unknowns: [
    "Move-in availability and current pricing need confirmation", "Rent not confirmed", "Bedrooms not confirmed",
  ] });
  expect(result.listings[0].rent).toBeUndefined();
  expect(result.listings[0].bedrooms).toBeUndefined();
  expect(result.listings[0].matches).not.toContain("Within your rent range");
  expect(result.listings[0].matches).not.toContain("1 bedrooms");
  expect(result.listings[1].unknowns).toEqual(["Move-in availability and current pricing need confirmation"]);
  expect(result.listings[1].matches).toContain("Within your rent range");
  expect(result.listings[1].matches).toContain("1 bedrooms");
  expect(console.info).toHaveBeenCalledWith("Firecrawl unit drops", expect.objectContaining({
    url: "https://example.com/0", "rent out of range": 1, "bedrooms mismatch": 1,
  }));
});
test("logs distinguish rejected pages, empty unit arrays, and fully filtered units", async () => {
  const result = await run([
    { ...matching, isListing: false }, { ...matching, city: null }, { ...matching, city: "Ypsilanti" },
    { ...matching, units: [] }, { ...matching, units: [
      { ...matchingUnit, rent: 2400, bedrooms: 2 }, { ...matchingUnit, bedrooms: 2 },
    ] },
  ]);
  expect(result.listings).toHaveLength(0);
  expect(result.search?.status).toBe("complete");
  for (const [index, reason, value] of [[0, "isListing false", false], [1, "city null", null], [2, "city conflict", "Ypsilanti"]] as const) {
    expect(console.info).toHaveBeenCalledWith("Firecrawl page rejected", expect.objectContaining({
      url: `https://example.com/${index}`, reason, value,
    }));
  }
  expect(console.info).toHaveBeenCalledWith("Firecrawl page", expect.objectContaining({
    url: "https://example.com/3", isListing: true, city: "Ann Arbor", unitsExtracted: 0,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl unit drops", expect.objectContaining({
    url: "https://example.com/3", "rent out of range": 0, "bedrooms mismatch": 0,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl unit drops", expect.objectContaining({
    url: "https://example.com/4", "rent out of range": 1, "bedrooms mismatch": 1,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({ unitsExtracted: 5, unitsInserted: 0 }));
});
test("page conflicts exclude every unit", async () => {
  const page = { ...matching, units: [matchingUnit, { ...matchingUnit, title: "Another plan" }] };
  const result = await run([{ ...page, cats: false }, { ...page, parking: false }, { ...page, laundry: false }, { ...page, city: "Ypsilanti" }]);
  expect(result.listings).toHaveLength(0);
});
test("a directory page inserts nothing even when it contains units", async () => {
  const result = await run([{ ...matching, isListing: false, units: [matchingUnit, matchingUnit] }]);
  expect(result.listings).toHaveLength(0);
});
test("missing or invalid unit arrays do not invent a listing", async () => {
  const result = await run([undefined, null, {}, "not units", []].map(units => ({ ...matching, units })));
  expect(result.listings).toHaveLength(0);
  expect(result.search?.status).toBe("complete");
});
test("invalid unit entries preserve valid units on the same page", async () => {
  const result = await run([{ ...matching, units: [null, "not a unit", 7, [], matchingUnit] }]);
  expect(result.listings).toHaveLength(1);
  expect(result.listings[0]).toMatchObject(matchingUnit);
});
test("one failed scrape preserves the other results", async () => {
  const result = await run([new Error("Blocked"), matching]);
  expect(result.listings).toHaveLength(1);
  expect(result.search?.status).toBe("complete");
});
test("stage counts distinguish duplicate URLs, empty pages, conflicts, and inserted listings", async () => {
  mocks.scrape.mockResolvedValueOnce({ metadata: { statusCode: 200 }, markdown: " " });
  const result = await run([{}, matching, { ...matching, units: [{ ...matchingUnit, rent: 2400 }] }, new Error("Timed out")], [
    "https://example.com/0", "https://example.com/1", "https://example.com/1", "https://example.com/2", "https://example.com/3",
  ]);
  expect(result.listings).toHaveLength(1);
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 5, urlsAfterDeduplication: 4, urlsSelectedForScrape: 4, pagesWithContent: 2, listingsInserted: 1, unitsExtracted: 2, unitsInserted: 1,
  }));
  expect(vi.mocked(console.info).mock.calls.filter(([message]) => message === "Firecrawl discovery counts")).toHaveLength(1);
  expect(console.info).toHaveBeenCalledWith("Firecrawl page", expect.objectContaining({ url: "https://example.com/0", statusCode: 200 }));
  expect(console.error).toHaveBeenCalledWith("Firecrawl page failed", expect.objectContaining({ url: "https://example.com/3", statusCode: "unknown" }), expect.any(Error));
});
test("selected URLs are logged once before scraping and counted after deduplication and the five-page limit", async () => {
  const result = await run(Array.from({ length: 7 }, () => matching), [
    "https://example.com/0", "https://example.com/1", "https://example.com/1", "https://example.com/2",
    "https://example.com/3", "https://example.com/4", "https://example.com/5", "https://example.com/6",
  ]);
  expect(result.listings).toHaveLength(5);
  const urls = ["https://example.com/0", "https://example.com/1", "https://example.com/2", "https://example.com/3", "https://example.com/4"];
  expect(mocks.scrape.mock.calls.map(([, url]) => url)).toEqual(urls);
  expect(console.info).toHaveBeenNthCalledWith(1, "Firecrawl selected URLs", expect.objectContaining({ urls }));
  expect(vi.mocked(console.info).mock.calls.filter(([message]) => message === "Firecrawl selected URLs")).toHaveLength(1);
  expect(vi.mocked(console.info).mock.invocationCallOrder[0]).toBeLessThan(mocks.scrape.mock.invocationCallOrder[0]);
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 8, urlsAfterDeduplication: 7, urlsSelectedForScrape: 5, pagesWithContent: 5, listingsInserted: 5,
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
    urlsReturned: 1, urlsAfterDeduplication: 1, urlsSelectedForScrape: 1, pagesWithContent: 0, listingsInserted: 0, unitsExtracted: 0, unitsInserted: 0,
  }));
});
test("insert counts exclude writes skipped after a search times out", async () => {
  const result = await run([matching], undefined, true);
  expect(result.listings).toHaveLength(0);
  expect(result.search?.status).toBe("failed");
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 1, urlsAfterDeduplication: 1, urlsSelectedForScrape: 1, pagesWithContent: 1, listingsInserted: 0, unitsExtracted: 1, unitsInserted: 0,
  }));
});
test("a search API failure logs zero counts and keeps the existing user-facing error", async () => {
  mocks.search.mockRejectedValueOnce(new Error("Search unavailable"));
  const result = await run([matching]);
  expect(result.search?.error).toBe("The listing search failed. Please try again shortly.");
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 0, urlsAfterDeduplication: 0, urlsSelectedForScrape: 0, pagesWithContent: 0, listingsInserted: 0, unitsExtracted: 0, unitsInserted: 0,
  }));
});
