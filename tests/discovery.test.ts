import { convexTest } from "convex-test";
import { ConvexError, v } from "convex/values";
import { defineSchema, defineTable } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { migrationPreferences } from "../convex/migrations";
import type { Preferences } from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

const mocks = vi.hoisted(() => ({ search: vi.fn(), scrape: vi.fn() }));
vi.mock("@firecrawl/firecrawl-convex", () => ({ FirecrawlClient: class { search = mocks.search; scrape = mocks.scrape; } }));
const modules = import.meta.glob("../convex/**/*.ts");
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "info").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

async function run(documents: Array<Record<string, unknown> | Error>, urls = documents.map((_, i) => `https://example.com/${i}`), timeoutDuringScrape = false, criteria: Partial<Preferences> = {}) {
  const t = convexTest(schema, modules);
  const searchId = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", {});
    return ctx.db.insert("searches", { userId, status: "searching", preferences: {
      ...flexiblePreferences, bedrooms: { values: [1], weight: "must" }, pets: { values: ["cat"], weight: "must" },
      amenities: [{ key: "parking", weight: "must" }, { key: "laundry", weight: "must" }], ...criteria,
    } });
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

const flexiblePreferences = {
  city: "Ann Arbor, Michigan" as const, minRent: 800, maxRent: 2000, moveIn: "2026-11-01", notes: "",
  bedrooms: { values: [1, 2], weight: "must" as const }, bathrooms: { values: [], weight: "nice" as const },
  floors: { values: [], weight: "nice" as const }, leaseMonths: { values: [], weight: "nice" as const },
  sqft: { weight: "nice" as const }, pets: { values: [], weight: "nice" as const }, amenities: [],
};

const migrationSchema = defineSchema({
  ...schema.tables,
  users: defineTable({ ...schema.tables.users.validator.fields, preferences: v.optional(migrationPreferences) }),
  searches: defineTable({ ...schema.tables.searches.validator.fields, preferences: migrationPreferences }).index("by_user", ["userId"]),
  listings: defineTable({ ...schema.tables.listings.validator.fields, score: v.optional(v.number()), mustMisses: v.optional(v.number()) }).index("by_search", ["searchId"]),
});
const oldPreferences = { city: "Ann Arbor, Michigan" as const, minRent: 800, maxRent: 2000,
  bedrooms: 2, pets: "cat" as const, parking: true, laundry: true, moveIn: "2026-11-01", notes: "Keep these notes" };

test("migration preserves saved data, backfills only recorded facts, and can run twice", async () => {
  const t = convexTest(migrationSchema, modules);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { name: "Alex", inboxId: "existing-inbox", preferences: oldPreferences });
    const emptyUserId = await ctx.db.insert("users", {});
    const modernUserId = await ctx.db.insert("users", { preferences: flexiblePreferences });
    const searchId = await ctx.db.insert("searches", { userId, status: "complete", preferences: oldPreferences });
    const base = { searchId, title: "Saved apartment", url: "https://example.com/old", summary: "Published facts", checkedAt: 123, contactEmail: "leasing@example.com" };
    const listingId = await ctx.db.insert("listings", { ...base, rent: 1600, bedrooms: 2,
      matches: ["Ann Arbor", "Within your rent range", "2 bedrooms", "Cats allowed", "Parking"], unknowns: ["In-unit laundry: not confirmed"] });
    const unknownId = await ctx.db.insert("listings", { ...base, matches: [], unknowns: ["Rent not confirmed", "Bedrooms not confirmed"] });
    const conflictId = await ctx.db.insert("listings", { ...base, rent: 2100, bedrooms: 3, matches: [], unknowns: [] });
    const scoredId = await ctx.db.insert("listings", { ...base, matches: [], unknowns: [], score: 42, mustMisses: 2 });
    return { userId, emptyUserId, modernUserId, searchId, listingId, unknownId, conflictId, scoredId };
  });
  const before = await t.run(async ctx => ({ listing: await ctx.db.get(ids.listingId), search: await ctx.db.get(ids.searchId) }));
  expect(await t.mutation(internal.migrations.flexibleFilters, {})).toEqual({ users: 1, searches: 1, listings: 3, checked: { users: 3, searches: 1, listings: 4 } });
  const expected = { ...flexiblePreferences, bedrooms: { values: [2], weight: "must" }, notes: "Keep these notes",
    pets: { values: ["cat"], weight: "must" }, amenities: [{ key: "parking", weight: "must" }, { key: "laundry", weight: "must" }] };
  const after = await t.run(async ctx => ({ user: await ctx.db.get(ids.userId), search: await ctx.db.get(ids.searchId),
    listing: await ctx.db.get(ids.listingId), unknown: await ctx.db.get(ids.unknownId), conflict: await ctx.db.get(ids.conflictId) }));
  expect(after.user).toMatchObject({ name: "Alex", inboxId: "existing-inbox", preferences: expected });
  expect(after.search).toEqual({ ...before.search, preferences: expected });
  expect(after.listing).toEqual({ ...before.listing, score: 20, mustMisses: 0 });
  expect(after.unknown).toMatchObject({ score: 0, mustMisses: 0 });
  expect(after.conflict).toMatchObject({ score: -10, mustMisses: 2 });
  expect((await t.run(ctx => ctx.db.get(ids.emptyUserId)))?.preferences).toBeUndefined();
  expect((await t.run(ctx => ctx.db.get(ids.modernUserId)))?.preferences).toEqual(flexiblePreferences);
  expect(await t.run(ctx => ctx.db.get(ids.scoredId))).toMatchObject({ score: 42, mustMisses: 2 });
  expect(await t.mutation(internal.migrations.flexibleFilters, {})).toEqual({ users: 0, searches: 0, listings: 0, checked: { users: 3, searches: 1, listings: 4 } });
});

test.each(["none", "dog"] as const)("migration handles %s pets and unselected amenities", async pets => {
  const t = convexTest(migrationSchema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", { preferences: { ...oldPreferences, pets, parking: false, laundry: false } }));
  await t.mutation(internal.migrations.flexibleFilters, {});
  const preferences = (await t.run(ctx => ctx.db.get(userId)))?.preferences;
  expect(preferences?.pets).toEqual({ values: pets === "none" ? [] : ["dog"], weight: pets === "none" ? "nice" : "must" });
  expect(preferences?.amenities).toEqual([]);
  expect(preferences).not.toHaveProperty("parking");
  expect(preferences).not.toHaveProperty("laundry");
});

test("migration rolls back instead of guessing missing original preferences", async () => {
  const t = convexTest(migrationSchema, modules);
  const ids = await t.run(async ctx => [await ctx.db.insert("users", { preferences: oldPreferences }),
    await ctx.db.insert("users", { preferences: { bedrooms: 2 } })]);
  await expect(t.mutation(internal.migrations.flexibleFilters, {})).rejects.toThrow("Cannot migrate incomplete preferences");
  expect((await t.run(ctx => ctx.db.get(ids[0])))?.preferences).toEqual(oldPreferences);
});

test("migration refuses oversized datasets before changing any row", async () => {
  const t = convexTest(migrationSchema, modules);
  const userId = await t.run(async ctx => {
    const first = await ctx.db.insert("users", { preferences: oldPreferences });
    for (let i = 0; i < 2000; i++) await ctx.db.insert("users", {});
    return first;
  });
  await expect(t.mutation(internal.migrations.flexibleFilters, {})).rejects.toThrow("exceeds 2000 rows");
  expect((await t.run(ctx => ctx.db.get(userId)))?.preferences).toEqual(oldPreferences);
});

test("migration rolls back if a historical listing has no saved search", async () => {
  const t = convexTest(migrationSchema, modules);
  const userId = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { preferences: oldPreferences });
    const searchId = await ctx.db.insert("searches", { userId, preferences: oldPreferences, status: "complete" });
    await ctx.db.insert("listings", { searchId, title: "Orphan", url: "https://example.com/old", summary: "", matches: [], unknowns: [], checkedAt: 123 });
    await ctx.db.delete(searchId);
    return userId;
  });
  await expect(t.mutation(internal.migrations.flexibleFilters, {})).rejects.toThrow("without its saved search");
  expect((await t.run(ctx => ctx.db.get(userId)))?.preferences).toEqual(oldPreferences);
});

test("flexible preferences accept multiple selections and schedule just one search", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", {}));
  const client = t.withIdentity({ subject: userId });
  const searchId = await client.mutation(api.searches.start, { preferences: flexiblePreferences });
  expect((await t.run(ctx => ctx.db.get(searchId)))?.preferences).toEqual(flexiblePreferences);
  expect((await t.run(ctx => ctx.db.get(userId)))?.preferences).toEqual(flexiblePreferences);
  expect(await t.run(ctx => ctx.db.query("searches").collect())).toHaveLength(1);
  const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
  expect(scheduled.filter(task => task.name === "discovery:run")).toHaveLength(1);
  await expect(client.mutation(api.searches.start, { preferences: flexiblePreferences })).rejects.toThrow("Please wait a minute");
  expect(await t.run(ctx => ctx.db.query("searches").collect())).toHaveLength(1);
});

test("results sort by must misses, score, then rent and cap only the missing-must group", async () => {
  const t = convexTest(schema, modules);
  const { userId, searchId } = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", {});
    const searchId = await ctx.db.insert("searches", { userId, preferences: flexiblePreferences, status: "complete" });
    const rows = [
      { title: "Two misses", mustMisses: 2, score: 100, rent: 500 },
      { title: "Low score", mustMisses: 0, score: 1, rent: 500 },
      { title: "Unknown rent", mustMisses: 0, score: 10 },
      { title: "Higher rent", mustMisses: 0, score: 10, rent: 1700 },
      { title: "Lower rent", mustMisses: 0, score: 10, rent: 1100 },
      ...Array.from({ length: 22 }, (_, i) => ({ title: `One miss ${i}`, mustMisses: 1, score: 30 - i, rent: 1000 })),
    ];
    for (const row of rows) await ctx.db.insert("listings", { ...row, searchId, url: "https://example.com/plan", summary: "", matches: [], unknowns: [], checkedAt: 123 });
    return { userId, searchId };
  });
  const result = await t.withIdentity({ subject: userId }).query(api.searches.results, { searchId });
  expect(result.listings.slice(0, 4).map(listing => listing.title)).toEqual(["Lower rent", "Higher rent", "Unknown rent", "Low score"]);
  expect(result.listings.slice(4).map(listing => listing.title)).toEqual(Array.from({ length: 20 }, (_, i) => `One miss ${i}`));
  expect(result.omittedMustMisses).toBe(3);
  expect(await t.run(ctx => ctx.db.query("listings").collect())).toHaveLength(27);
});

test("empty criteria and open square-footage bounds are valid", async () => {
  for (const sqft of [{ weight: "nice" as const }, { min: 500, weight: "nice" as const }, { max: 1000, weight: "nice" as const }]) {
    const t = convexTest(schema, modules);
    const userId = await t.run(ctx => ctx.db.insert("users", {}));
    const preferences = { ...flexiblePreferences, bedrooms: { values: [], weight: "must" as const }, sqft };
    await expect(t.withIdentity({ subject: userId }).mutation(api.searches.start, { preferences })).resolves.toBeTruthy();
  }
});

test("every supported criterion value can be saved", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", {}));
  const preferences: Preferences = {
    ...flexiblePreferences, bedrooms: { values: [0, 1, 2, 3, 4, 5, 6], weight: "must" },
    bathrooms: { values: [1, 1.5, 2], weight: "want" }, floors: { values: [1, 2, 3], weight: "nice" },
    leaseMonths: { values: [1, 6, 9, 12], weight: "want" }, pets: { values: ["cat", "dog"], weight: "must" },
    sqft: { min: 800, max: 800, weight: "nice" },
    amenities: (["parking", "laundry", "dishwasher", "airConditioning", "balcony", "gym", "pool", "elevator", "furnished"] as const)
      .map(key => ({ key, weight: "want" })),
  };
  const searchId = await t.withIdentity({ subject: userId }).mutation(api.searches.start, { preferences });
  expect((await t.run(ctx => ctx.db.get(searchId)))?.preferences).toEqual(preferences);
});

test("discovery reads multiple bedroom values from migrated preferences", async () => {
  const result = await run([{ ...matching, units: [matchingUnit, { ...matchingUnit, bedrooms: 2 }] }], undefined, false,
    { bedrooms: { values: [1, 2], weight: "must" } });
  expect(result.listings.map(listing => listing.bedrooms)).toEqual([1, 2]);
  expect(result.listings.map(listing => [listing.score, listing.mustMisses])).toEqual([[25, 0], [25, 0]]);
});

test("discovery does not require a bedroom when that criterion is unused", async () => {
  const result = await run([{ ...matching, units: [{ ...matchingUnit, bedrooms: 2 }, { ...matchingUnit, bedrooms: null }] }], undefined, false,
    { bedrooms: { values: [], weight: "must" } });
  expect(mocks.search).toHaveBeenCalledWith(expect.anything(), "Named apartment communities in Ann Arbor Michigan with floor plan pages cat friendly", expect.anything());
  expect(result.listings).toHaveLength(2);
  for (const listing of result.listings) {
    expect(listing.score).toBe(20);
    expect(listing.mustMisses).toBe(0);
    expect(listing.matches).not.toContain("2 bedrooms");
    expect(listing.unknowns).not.toContain("Bedrooms not confirmed");
  }
});

test("a conflicting bedroom contributes negative points without dropping the unit", async () => {
  const result = await run([{ ...matching, units: [{ ...matchingUnit, rent: null, bedrooms: 3 }] }], undefined, false,
    { bedrooms: { values: [1, 2], weight: "must" }, pets: { values: [], weight: "nice" }, amenities: [] });
  expect(result.listings).toHaveLength(1);
  expect(result.listings[0]).toMatchObject({ score: -5, mustMisses: 1 });
  expect(result.listings[0].unknowns).toContain("1 or 2 bedrooms: conflicts with must-have");
});

test("an unpublished floor is unconfirmed even when it is a must-have", async () => {
  const result = await run([matching], undefined, false, { floors: { values: [1], weight: "must" } });
  expect(result.listings[0]).toMatchObject({ score: 25, mustMisses: 0 });
  expect(result.listings[0].unknowns).toContain("Floor not confirmed");
});

test.each([["want", 28], ["nice", 26], ["must", 30]] as const)("confirmed %s amenities add their weight", async (weight, score) => {
  const result = await run([{ ...matching, dishwasher: true }], undefined, false, {
    amenities: [{ key: "parking", weight: "must" }, { key: "laundry", weight: "must" }, { key: "dishwasher", weight }],
  });
  expect(result.listings[0]).toMatchObject({ score, mustMisses: 0 });
  expect(result.listings[0].matches).toContain("Dishwasher");
});

test.each(["parking", "laundry", "dishwasher", "airConditioning", "balcony", "gym", "pool", "elevator", "furnished"] as const)(
  "an explicitly absent %s amenity subtracts points", async key => {
    const result = await run([{ ...matching, [key]: false }], undefined, false, { amenities: [{ key, weight: "want" }] });
    expect(result.listings[0]).toMatchObject({ score: 12, mustMisses: 0 });
    expect(result.listings[0].unknowns.some(line => line.endsWith(": conflicts with preference"))).toBe(true);
  });

test("third-or-higher floors and two-or-more bathrooms match higher published values", async () => {
  const result = await run([{ ...matching, units: [{ ...matchingUnit, floor: 5, bathrooms: 2.5 }] }], undefined, false,
    { floors: { values: [3], weight: "must" }, bathrooms: { values: [2], weight: "want" } });
  expect(result.listings[0]).toMatchObject({ score: 33, mustMisses: 0 });
  expect(result.listings[0].matches).toEqual(expect.arrayContaining(["Floor 5", "2.5 bathrooms"]));
});

test("two plans with different square footage retain independent scores", async () => {
  const result = await run([{ ...matching, units: [{ ...matchingUnit, sqft: 1000 }, { ...matchingUnit, sqft: 500 }] }], undefined, false,
    { sqft: { min: 700, max: 1100, weight: "must" } });
  expect(result.listings.map(listing => [listing.score, listing.mustMisses])).toEqual([[30, 0], [20, 1]]);
});

test.each([{ min: 700 }, { max: 1100 }])("square footage supports a single bound (%j)", async bounds => {
  const result = await run([{ ...matching, units: [{ ...matchingUnit, sqft: 900 }] }], undefined, false, { sqft: { ...bounds, weight: "nice" } });
  expect(result.listings[0]).toMatchObject({ score: 26, mustMisses: 0 });
});

test.each([
  { terms: [6, 12], score: 28, misses: 0 }, { terms: [9], score: 22, misses: 0 },
  { terms: [], score: 25, misses: 0 }, { terms: null, score: 25, misses: 0 },
])("lease terms match any selected term and missing terms remain unknown (%j)", async ({ terms, score, misses }) => {
  const result = await run([{ ...matching, leaseMonths: terms }], undefined, false, { leaseMonths: { values: [1, 12], weight: "want" } });
  expect(result.listings[0]).toMatchObject({ score, mustMisses: misses });
});

test.each([
  { cats: true, dogs: true, score: 25, misses: 0 },
  { cats: true, dogs: null, score: 20, misses: 0 },
  { cats: false, dogs: null, score: 15, misses: 1 },
  { cats: false, dogs: false, score: 15, misses: 1 },
])("pets count as one criterion requiring every selected animal (%j)", async ({ cats, dogs, score, misses }) => {
  const result = await run([{ ...matching, cats, dogs }], undefined, false, { pets: { values: ["cat", "dog"], weight: "must" } });
  expect(result.listings[0]).toMatchObject({ score, mustMisses: misses });
});

test("unused criteria add no lines or points even when published facts differ", async () => {
  const result = await run([{ ...matching, cats: false, parking: false, laundry: false, leaseMonths: [9],
    units: [{ ...matchingUnit, bedrooms: 5, floor: 8, bathrooms: 3, sqft: 400 }] }], undefined, false,
    { bedrooms: { values: [], weight: "must" }, pets: { values: [], weight: "must" }, amenities: [] });
  expect(result.listings[0]).toMatchObject({ score: 5, mustMisses: 0,
    matches: ["Ann Arbor", "Within your rent range"], unknowns: ["Move-in availability and current pricing need confirmation"] });
});

test("invalid numeric extractions remain unknown instead of conflicting", async () => {
  const result = await run([{ ...matching, units: [{ ...matchingUnit, rent: Infinity, bedrooms: NaN, bathrooms: Infinity, floor: 0, sqft: -1 }] }], undefined, false,
    { bathrooms: { values: [1], weight: "must" }, floors: { values: [1], weight: "must" }, sqft: { min: 500, weight: "must" } });
  expect(result.listings[0]).toMatchObject({ score: 15, mustMisses: 0 });
  expect(result.listings[0].unknowns).toEqual(expect.arrayContaining(["Rent not confirmed", "Bedrooms not confirmed", "Bathrooms not confirmed", "Floor not confirmed", "Square footage not confirmed"]));
});

test.each([
  { bedrooms: { values: [-1], weight: "must" } }, { bedrooms: { values: [7], weight: "must" } },
  { bedrooms: { values: [1.5], weight: "must" } }, { bedrooms: { values: [NaN], weight: "must" } },
  { bathrooms: { values: [3], weight: "nice" } }, { floors: { values: [4], weight: "nice" } },
  { leaseMonths: { values: [18], weight: "nice" } }, { sqft: { min: 900, max: 500, weight: "nice" } },
  { sqft: { min: -1, weight: "nice" } }, { sqft: { max: Infinity, weight: "nice" } },
  { amenities: [{ key: "parking", weight: "must" }, { key: "parking", weight: "want" }] },
  { minRent: -1 }, { maxRent: 20001 }, { minRent: NaN }, { moveIn: "tomorrow" }, { notes: "x".repeat(501) },
])("invalid flexible preferences never schedule a paid search (%j)", async patch => {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", {}));
  await expect(t.withIdentity({ subject: userId }).mutation(api.searches.start, {
    preferences: { ...flexiblePreferences, ...patch },
  })).rejects.toThrow("Please check");
  expect(await t.run(ctx => ctx.db.query("searches").collect())).toHaveLength(0);
  expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  expect((await t.run(ctx => ctx.db.get(userId)))?.preferences).toBeUndefined();
});

test("search excludes non-sources and directories while allowing RentCafe", async () => {
  await run([matching]);
  expect(mocks.search).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({
    excludeDomains: ["zillow.com", "apartments.com", "realtor.com", "redfin.com", "reddit.com",
      "facebook.com", "yelp.com", "hometogo.com", "tripadvisor.com", "airbnb.com", "vrbo.com",
      "pinterest.com", "homes.com", "trulia.com"],
  }));
});
test("extraction requests unit details and property amenities without guessing missing facts", async () => {
  await run([matching]);
  expect(mocks.scrape).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({
    formats: expect.arrayContaining([expect.objectContaining({ type: "json", schema: expect.objectContaining({
      properties: expect.objectContaining({
        units: expect.objectContaining({ items: expect.objectContaining({ properties: expect.objectContaining({
          bathrooms: { type: ["number", "null"] }, sqft: { type: ["number", "null"] }, floor: { type: ["number", "null"] },
        }) }) }),
        dishwasher: { type: ["boolean", "null"] }, airConditioning: { type: ["boolean", "null"] },
        balcony: { type: ["boolean", "null"] }, gym: { type: ["boolean", "null"] }, pool: { type: ["boolean", "null"] },
        elevator: { type: ["boolean", "null"] }, furnished: { type: ["boolean", "null"] },
        leaseMonths: { type: "array", items: { type: "number" } },
      }),
    }), prompt: expect.stringContaining("A garden level or a lower level is null, not 1.") })]),
  }));
});
test("search describes floor plans without contact terms and extraction still requests the leasing contact", async () => {
  await run([matching]);
  expect(mocks.search).toHaveBeenCalledWith(expect.anything(), expect.stringContaining("Ann Arbor Michigan with 1 bedroom floor plan pages cat friendly"), expect.anything());
  expect(mocks.search).toHaveBeenCalledWith(expect.anything(), expect.not.stringMatching(/contact/i), expect.anything());
  expect(mocks.scrape).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({
    formats: expect.arrayContaining([expect.objectContaining({ prompt: expect.stringContaining("contactEmail must be the leasing contact published on this page") })]),
  }));
});
test("keeps preference conflicts but excludes listings outside Ann Arbor", async () => {
  const result = await run([matching, { ...matching, units: [{ ...matchingUnit, rent: 2400 }] }, { ...matching, cats: false },
    { ...matching, units: [{ ...matchingUnit, bedrooms: 2 }] }, { ...matching, city: "Ypsilanti" }]);
  expect(result.listings).toHaveLength(4);
  expect(result.listings.map(listing => [listing.score, listing.mustMisses])).toEqual([[25, 0], [15, 1], [15, 1], [15, 1]]);
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
test("a page with five units keeps all five when three rents exceed the budget", async () => {
  const units = [2100, 1000, 2400, 3000, 2000].map((rent, i) => ({ ...matchingUnit, title: `Plan ${i + 1}`, rent }));
  const result = await run([{ ...matching, units }]);
  expect(result.listings.map(({ title, rent, bedrooms }) => ({ title, rent, bedrooms }))).toEqual(units);
  expect(result.listings.map(listing => listing.mustMisses)).toEqual([1, 0, 1, 1, 0]);
  expect(console.info).toHaveBeenCalledWith("Firecrawl units scored", expect.objectContaining({
    url: "https://example.com/0", units: 5, withMustMisses: 3,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({ unitsExtracted: 5, unitsInserted: 5 }));
});

test("unit conflicts keep every unit with independent scores and unknowns", async () => {
  const result = await run([{ ...matching, units: [
    { ...matchingUnit, rent: 700 }, { ...matchingUnit, bedrooms: 2 },
    { title: "Unconfirmed", rent: null, bedrooms: null }, matchingUnit,
  ] }]);
  expect(result.listings.map(listing => [listing.score, listing.mustMisses])).toEqual([[15, 1], [15, 1], [15, 0], [25, 0]]);
  expect(result.listings[2]).toMatchObject({ title: "Unconfirmed", unknowns: [
    "Move-in availability and current pricing need confirmation", "Rent not confirmed", "Bedrooms not confirmed",
  ] });
  expect(result.listings[2].rent).toBeUndefined();
  expect(result.listings[2].bedrooms).toBeUndefined();
  expect(result.listings[2].matches).not.toContain("Within your rent range");
  expect(result.listings[2].matches).not.toContain("1 bedrooms");
  expect(result.listings[3].unknowns).toEqual(["Move-in availability and current pricing need confirmation"]);
  expect(console.info).toHaveBeenCalledWith("Firecrawl units scored", expect.objectContaining({
    url: "https://example.com/0", units: 4, withMustMisses: 2,
  }));
});

test("logs distinguish rejected pages, empty unit arrays, and scored units", async () => {
  const result = await run([
    { ...matching, isListing: false, units: [] }, { ...matching, city: null, units: [] }, { ...matching, city: "Ypsilanti" },
    { ...matching, units: [] }, { ...matching, units: [
      { ...matchingUnit, rent: 2400, bedrooms: 2 }, { ...matchingUnit, bedrooms: 2 },
    ] },
  ]);
  expect(result.listings).toHaveLength(2);
  expect(result.search?.status).toBe("complete");
  for (const [index, reason, value] of [[0, "units empty", 0], [1, "units empty", 0], [2, "city conflict", "Ypsilanti"]] as const) {
    expect(console.info).toHaveBeenCalledWith("Firecrawl page rejected", expect.objectContaining({
      url: `https://example.com/${index}`, reason, value,
    }));
  }
  expect(console.info).toHaveBeenCalledWith("Firecrawl page", expect.objectContaining({
    url: "https://example.com/3", isListing: true, city: "Ann Arbor", unitsExtracted: 0,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl page rejected", expect.objectContaining({
    url: "https://example.com/3", reason: "units empty", value: 0,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl units scored", expect.objectContaining({
    url: "https://example.com/4", units: 2, withMustMisses: 2,
  }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({ unitsExtracted: 3, unitsInserted: 2 }));
});
test("page preference conflicts keep every unit while city conflicts still drop", async () => {
  const page = { ...matching, units: [matchingUnit, { ...matchingUnit, title: "Another plan" }] };
  const result = await run([{ ...page, cats: false }, { ...page, parking: false }, { ...page, laundry: false }, { ...page, city: "Ypsilanti" }]);
  expect(result.listings).toHaveLength(6);
  expect(result.listings.every(listing => listing.score === 15 && listing.mustMisses === 1)).toBe(true);
});

test("pages with floor plans are kept when isListing is false or null", async () => {
  const result = await run([3, 7, 24].map((count, i) => ({ ...matching, isListing: i === 1 ? null : false,
    units: Array.from({ length: count }, (_, j) => ({ ...matchingUnit, title: `Property ${i} plan ${j}` })),
  })));
  expect(result.listings).toHaveLength(34);
  expect(result.listings.filter(listing => listing.url === "https://example.com/0")).toHaveLength(3);
  expect(result.listings.filter(listing => listing.url === "https://example.com/1")).toHaveLength(7);
  expect(result.listings.filter(listing => listing.url === "https://example.com/2")).toHaveLength(24);
  expect(console.info).not.toHaveBeenCalledWith("Firecrawl page rejected", expect.anything());
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({ unitsExtracted: 34, unitsInserted: 34 }));
});
test("empty unit arrays insert nothing regardless of isListing", async () => {
  const result = await run([true, false, null].map(isListing => ({ ...matching, isListing, units: [] })));
  expect(result.listings).toHaveLength(0);
});
test("an unknown city is unconfirmed on each inserted unit", async () => {
  const result = await run([{ ...matching, isListing: false, city: null, units: [matchingUnit, { ...matchingUnit, title: "Another plan" }] }]);
  expect(result.listings).toHaveLength(2);
  for (const listing of result.listings) {
    expect(listing.unknowns).toContain("City not confirmed");
    expect(listing.matches).not.toContain("Ann Arbor");
  }
});
test("Ann Arbor and Ann Arbor Charter Township accept case, whitespace, and state suffixes", async () => {
  const result = await run(["Ann Arbor", "Ann Arbor, MI", "Ann Arbor Michigan", "Ann Arbor Charter Township", " ann arbor charter township, mi "]
    .map(city => ({ ...matching, isListing: null, city })));
  expect(result.listings).toHaveLength(5);
  for (const listing of result.listings) {
    expect(listing.matches).toContain("Ann Arbor");
    expect(listing.unknowns).not.toContain("City not confirmed");
  }
});
test("overriding isListing keeps rent and bedroom conflicts but excludes another city", async () => {
  const result = await run([{ ...matching, isListing: false, units: [
    { ...matchingUnit, rent: 700 }, { ...matchingUnit, rent: 2400 }, { ...matchingUnit, bedrooms: 2 }, matchingUnit,
  ] }, { ...matching, isListing: null, city: "Ypsilanti" }]);
  expect(result.listings).toHaveLength(4);
  expect(result.listings.map(listing => listing.mustMisses)).toEqual([1, 1, 1, 0]);
  expect(console.info).toHaveBeenCalledWith("Firecrawl units scored", expect.objectContaining({ url: "https://example.com/0", units: 4, withMustMisses: 3 }));
  expect(console.info).toHaveBeenCalledWith("Firecrawl page rejected", expect.objectContaining({
    url: "https://example.com/1", reason: "city conflict", value: "Ypsilanti",
  }));
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
  expect(result.listings).toHaveLength(2);
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 5, urlsAfterDeduplication: 4, urlsSelectedForScrape: 4, pagesWithContent: 2, listingsInserted: 2, unitsExtracted: 2, unitsInserted: 2,
  }));
  expect(vi.mocked(console.info).mock.calls.filter(([message]) => message === "Firecrawl discovery counts")).toHaveLength(1);
  expect(console.info).toHaveBeenCalledWith("Firecrawl page", expect.objectContaining({ url: "https://example.com/0", statusCode: 200 }));
  expect(console.error).toHaveBeenCalledWith("Firecrawl page failed", expect.objectContaining({ url: "https://example.com/3", statusCode: "unknown" }), expect.any(Error));
});
test("search requests twenty results and logs the fifteen selected URLs after deduplication", async () => {
  const returnedUrls = Array.from({ length: 19 }, (_, i) => `https://example.com/${i}`);
  returnedUrls.splice(1, 0, "https://example.com/0");
  const result = await run(Array.from({ length: 19 }, () => matching), returnedUrls);
  expect(mocks.search).toHaveBeenCalledWith(expect.anything(), expect.any(String), expect.objectContaining({ limit: 20 }));
  expect(result.listings).toHaveLength(15);
  const urls = Array.from({ length: 15 }, (_, i) => `https://example.com/${i}`);
  expect(mocks.scrape.mock.calls.map(([, url]) => url)).toEqual(urls);
  expect(console.info).toHaveBeenNthCalledWith(1, "Firecrawl selected URLs", expect.objectContaining({ urls }));
  expect(vi.mocked(console.info).mock.calls.filter(([message]) => message === "Firecrawl selected URLs")).toHaveLength(1);
  expect(vi.mocked(console.info).mock.invocationCallOrder[0]).toBeLessThan(mocks.scrape.mock.invocationCallOrder[0]);
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsReturned: 20, urlsAfterDeduplication: 19, urlsSelectedForScrape: 15, pagesWithContent: 15, listingsInserted: 15,
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
test("scrapes in batches of five and continues after a rate-limited page without retrying", async () => {
  const finished: number[] = [];
  const releases: Array<() => void> = [];
  const limited = new ConvexError({ status: 429, message: "Rate limit exceeded" });
  for (let i = 0; i < 12; i++) {
    const ready = new Promise<void>(resolve => { releases.push(resolve); });
    mocks.scrape.mockImplementationOnce(async () => {
      await ready;
      finished.push(i);
      if (i === 4) throw limited;
      return { json: matching, markdown: "leasing@example.com", metadata: { statusCode: 200 } };
    });
  }
  const pending = run(Array.from({ length: 12 }, () => matching));
  try {
    for (const [start, end] of [[0, 5], [5, 10], [10, 12]]) {
      await vi.waitFor(() => expect(mocks.scrape).toHaveBeenCalledTimes(end));
      for (let i = start; i < end - 1; i++) releases[i]();
      await vi.waitFor(() => expect(finished).toHaveLength(end - 1));
      expect(mocks.scrape).toHaveBeenCalledTimes(end);
      releases[end - 1]();
    }
  } finally {
    releases.forEach(release => release());
    await pending;
  }
  const result = await pending;
  expect(result.listings).toHaveLength(11);
  expect(result.search?.status).toBe("complete");
  expect(mocks.scrape.mock.calls.map(([, url]) => url)).toEqual(Array.from({ length: 12 }, (_, i) => `https://example.com/${i}`));
  expect(console.error).toHaveBeenCalledWith("Firecrawl page failed", expect.objectContaining({
    url: "https://example.com/4", statusCode: 429, reason: "429 rate limited",
  }), limited);
  expect(console.info).toHaveBeenCalledWith("Firecrawl discovery counts", expect.objectContaining({
    urlsSelectedForScrape: 12, pagesWithContent: 11, unitsExtracted: 11, unitsInserted: 11,
  }));
});
test("a resolved 429 is logged as rate limited", async () => {
  mocks.scrape.mockResolvedValueOnce({ metadata: { statusCode: 429 }, markdown: "Rate limit exceeded" });
  await run([{}]);
  expect(console.info).toHaveBeenCalledWith("Firecrawl page", expect.objectContaining({
    url: "https://example.com/0", statusCode: 429, reason: "429 rate limited",
  }));
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
