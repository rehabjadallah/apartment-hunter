import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const mocks = vi.hoisted(() => ({ search: vi.fn(), scrape: vi.fn() }));
vi.mock("@firecrawl/firecrawl-convex", () => ({ FirecrawlClient: class { search = mocks.search; scrape = mocks.scrape; } }));
const modules = import.meta.glob("../convex/**/*.ts");
beforeEach(() => { vi.clearAllMocks(); });

async function run(documents: Array<Record<string, unknown> | Error>) {
  const t = convexTest(schema, modules);
  const searchId = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", {});
    return ctx.db.insert("searches", { userId, status: "searching", preferences: {
      city: "Ann Arbor, Michigan", minRent: 800, maxRent: 2000, bedrooms: 1, pets: "cat",
      moveIn: "2026-11-01", parking: true, laundry: true, notes: "", } });
  });
  mocks.search.mockResolvedValue({ web: documents.map((_, i) => ({ url: `https://example.com/${i}` })) });
  mocks.scrape.mockImplementation(async (_ctx, url: string) => {
    const doc = documents[Number(new URL(url).pathname.slice(1))];
    if (doc instanceof Error) throw doc;
    return { json: doc, markdown: "For leasing, contact leasing@example.com" };
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
