import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
const preferences = {
  city: "Ann Arbor, Michigan" as const, minRent: 800, maxRent: 2000, moveIn: "2026-10-01", notes: "",
  bedrooms: { values: [1], weight: "must" as const }, bathrooms: { values: [], weight: "nice" as const },
  floors: { values: [], weight: "nice" as const }, leaseMonths: { values: [], weight: "nice" as const },
  sqft: { weight: "nice" as const }, pets: { values: [], weight: "nice" as const }, amenities: [],
};

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const owner = await ctx.db.insert("users", {});
    const stranger = await ctx.db.insert("users", {});
    const searchId = await ctx.db.insert("searches", { userId: owner, preferences, status: "complete" });
    const listingId = await ctx.db.insert("listings", { searchId, title: "Test apartment", url: "https://example.com/listing", summary: "Test", matches: [], unknowns: [], score: 0, mustMisses: 0, checkedAt: Date.now(), contactEmail: "leasing@example.com" });
    const inquiryId = await ctx.db.insert("inquiries", { userId: owner, listingId, subject: "Test", body: "Test", status: "failed" });
    return { owner, stranger, searchId, listingId, inquiryId };
  });
  return { t, ...ids };
}

describe("Private apartment data", () => {
  test("saving a name requires sign-in and only changes the signed-in user's profile", async () => {
    const { t, owner, stranger } = await fixture();
    await expect(t.mutation(api.users.saveName, { name: "Alex" })).rejects.toThrow("Please sign in");
    await t.withIdentity({ subject: owner }).mutation(api.users.saveName, { name: "  Alex Taylor  " });
    expect((await t.run(ctx => ctx.db.get(owner)))?.name).toBe("Alex Taylor");
    expect((await t.run(ctx => ctx.db.get(stranger)))?.name).toBeUndefined();
  });
  test.each(["", "   ", "a".repeat(101)])("invalid names cannot replace a saved name (%j)", async name => {
    const { t, owner } = await fixture();
    await t.run(ctx => ctx.db.patch(owner, { name: "Alex" }));
    await expect(t.withIdentity({ subject: owner }).mutation(api.users.saveName, { name })).rejects.toThrow("Please enter a name between 1 and 100 characters");
    expect((await t.run(ctx => ctx.db.get(owner)))?.name).toBe("Alex");
  });
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
    await t.run(ctx => ctx.db.patch(inquiryId, { status: "queued" }));
    expect(await t.withIdentity({ subject: owner }).mutation(api.inquiries.send, { listingId, subject: "Hello", body: "Test" })).toBe(inquiryId);
    expect(await t.run(ctx => ctx.db.query("inquiries").collect())).toHaveLength(1);
  });
  test("a preparation failure can be resubmitted once without duplicating the inquiry", async () => {
    vi.useFakeTimers();
    try {
      const { t, owner, listingId, inquiryId } = await fixture();
      const client = t.withIdentity({ subject: owner });
      const args = { listingId, subject: "Retry", body: "Reviewed test message" };
      expect(await client.mutation(api.inquiries.send, args)).toBe(inquiryId);
      expect(await client.mutation(api.inquiries.send, args)).toBe(inquiryId);
      const items = await t.run(ctx => ctx.db.query("inquiries").collect());
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ status: "preparing", subject: "Retry", body: args.body });
      const scheduled = await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled).toHaveLength(1);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
  test("a failed inquiry with an outbound message cannot be resubmitted", async () => {
    const { t, owner, listingId, inquiryId } = await fixture();
    await t.run(ctx => ctx.db.patch(inquiryId, { outboundId: "already-queued" }));
    await t.withIdentity({ subject: owner }).mutation(api.inquiries.send, { listingId, subject: "Retry", body: "Test" });
    expect((await t.run(ctx => ctx.db.get(inquiryId)))?.status).toBe("failed");
    expect(await t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  });
});
