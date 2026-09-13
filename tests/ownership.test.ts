import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const preferences = { city: "Ann Arbor, Michigan" as const, minRent: 800, maxRent: 2000, bedrooms: 1, moveIn: "2026-10-01", pets: "none" as const, parking: false, laundry: false, notes: "" };

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const owner = await ctx.db.insert("users", {});
    const stranger = await ctx.db.insert("users", {});
    const searchId = await ctx.db.insert("searches", { userId: owner, preferences, status: "complete" });
    const listingId = await ctx.db.insert("listings", { searchId, title: "Test apartment", url: "https://example.com/listing", summary: "Test", matches: [], unknowns: [], checkedAt: Date.now(), contactEmail: "leasing@example.com" });
    const inquiryId = await ctx.db.insert("inquiries", { userId: owner, listingId, subject: "Test", body: "Test", status: "failed" });
    return { owner, stranger, searchId, listingId, inquiryId };
  });
  return { t, ...ids };
}

describe("Private apartment data", () => {
  test("anonymous callers cannot read searches or send inquiries", async () => {
    const { t, listingId } = await fixture();
    await expect(t.query(api.searches.list)).rejects.toThrow("Please sign in");
    await expect(t.mutation(api.inquiries.send, { listingId, subject: "Hello", body: "Test" })).rejects.toThrow("Please sign in");
  });
  test("users only see their own search history", async () => {
    const { t, owner, stranger, searchId } = await fixture();
    expect(await t.withIdentity({ subject: stranger }).query(api.searches.list)).toEqual([]);
    expect(await t.withIdentity({ subject: owner }).query(api.searches.list)).toHaveLength(1);
    await expect(t.withIdentity({ subject: stranger }).query(api.searches.results, { searchId })).rejects.toThrow("Search not found");
  });
  test("another user's listing cannot be contacted and conversations stay private", async () => {
    const { t, stranger, listingId, inquiryId } = await fixture();
    const client = t.withIdentity({ subject: stranger });
    expect(await client.query(api.inquiries.list)).toEqual([]);
    await expect(client.mutation(api.inquiries.send, { listingId, subject: "Hi", body: "Hello" })).rejects.toThrow("Listing not found");
    await expect(client.action(api.inquiries.replies, { inquiryId })).rejects.toThrow("Inquiry not found");
  });
  test("invalid preferences cannot schedule paid searches", async () => {
    const { t, owner } = await fixture();
    await expect(t.withIdentity({ subject: owner }).mutation(api.searches.start, { preferences: { ...preferences, minRent: 3000 } })).rejects.toThrow("Please check");
  });
  test("repeat inquiry requests do not queue another message", async () => {
    const { t, owner, listingId, inquiryId } = await fixture();
    expect(await t.withIdentity({ subject: owner }).mutation(api.inquiries.send, { listingId, subject: "Hello", body: "Test" })).toBe(inquiryId);
    expect(await t.run(ctx => ctx.db.query("inquiries").collect())).toHaveLength(1);
  });
});
