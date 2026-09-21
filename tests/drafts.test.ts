import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const preferences = {
  city: "Ann Arbor, Michigan" as const, minRent: 800, maxRent: 2000, moveIn: "2026-10-01", notes: "",
  bedrooms: { values: [1], weight: "must" as const }, bathrooms: { values: [], weight: "nice" as const },
  floors: { values: [], weight: "nice" as const }, leaseMonths: { values: [], weight: "nice" as const },
  sqft: { weight: "nice" as const }, pets: { values: ["dog" as const], weight: "must" as const }, amenities: [],
};

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const owner = await ctx.db.insert("users", {});
    const stranger = await ctx.db.insert("users", {});
    const searchId = await ctx.db.insert("searches", { userId: owner, preferences, status: "complete" });
    const listingId = await ctx.db.insert("listings", {
      searchId, title: "The Maples — 1 Bedroom", url: "https://example.com/listing", summary: "One bedroom",
      rent: 1340, bedrooms: 1, matches: ["Ann Arbor", "1 bedroom"],
      unknowns: ["in-unit laundry: not confirmed", "pet policy: not confirmed"],
      score: 0, mustMisses: 0, checkedAt: Date.now(), contactEmail: "leasing@example.com",
    });
    return { owner, stranger, listingId };
  });
  return { t, ...ids };
}

const reply = (subject: string, body: string) => new Response(
  JSON.stringify({ choices: [{ message: { content: JSON.stringify({ subject, body }) } }] }),
  { headers: { "Content-Type": "application/json" } },
);

describe("OpenAI inquiry drafting", () => {
  test("another user's listing cannot be drafted against", async () => {
    const { t, stranger, listingId } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(t.withIdentity({ subject: stranger }).action(api.drafts.compose, { listingId })).rejects.toThrow("Listing not found");
    // No credits are spent on a listing the caller does not own.
    expect(fetch).not.toHaveBeenCalled();
  });

  test("anonymous callers cannot draft", async () => {
    const { t, listingId } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn());
    await expect(t.action(api.drafts.compose, { listingId })).rejects.toThrow("Please sign in");
  });

  test("a generated draft is returned and the unconfirmed details are sent to the model", async () => {
    const { t, owner, listingId } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetch = vi.fn().mockResolvedValue(reply("Inquiry: The Maples 1 Bedroom", "Hello, is the laundry in-unit?"));
    vi.stubGlobal("fetch", fetch);
    expect(await t.withIdentity({ subject: owner }).action(api.drafts.compose, { listingId }))
      .toEqual({ subject: "Inquiry: The Maples 1 Bedroom", body: "Hello, is the laundry in-unit?" });
    const sent = JSON.parse(fetch.mock.calls[0][1].body);
    expect(sent.messages[1].content).toContain("in-unit laundry");
    expect(sent.messages[1].content).toContain("pet policy");
  });

  test("output is clamped to the limits inquiries.send enforces", async () => {
    const { t, owner, listingId } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("Line one\nline two", "b".repeat(6000))));
    const draft = await t.withIdentity({ subject: owner }).action(api.drafts.compose, { listingId });
    expect(draft.subject).toBe("Line one line two");
    expect(draft.body).toHaveLength(5000);
  });

  test("a long subject is truncated rather than rejected downstream", async () => {
    const { t, owner, listingId } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply("s".repeat(400), "Hello")));
    expect((await t.withIdentity({ subject: owner }).action(api.drafts.compose, { listingId })).subject).toHaveLength(200);
  });

  test.each([
    ["a failed request", () => vi.fn().mockResolvedValue(new Response("nope", { status: 500 }))],
    ["an empty draft", () => vi.fn().mockResolvedValue(reply("", ""))],
    ["unparseable content", () => vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { headers: { "Content-Type": "application/json" } }))],
  ])("%s throws so the caller falls back to its template", async (_label, makeFetch) => {
    const { t, owner, listingId } = await fixture();
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubGlobal("fetch", makeFetch());
    await expect(t.withIdentity({ subject: owner }).action(api.drafts.compose, { listingId })).rejects.toThrow("Couldn't draft this message");
  });

  test("a missing key fails without calling the API", async () => {
    const { t, owner, listingId } = await fixture();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(t.withIdentity({ subject: owner }).action(api.drafts.compose, { listingId })).rejects.toThrow("Drafting is unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
});
