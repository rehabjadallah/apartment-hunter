import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const reply = (fields: Record<string, unknown>) => new Response(
  JSON.stringify({ choices: [{ message: { content: JSON.stringify(fields) } }] }),
  { headers: { "Content-Type": "application/json" } },
);

async function signedIn() {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", {}));
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  return t.withIdentity({ subject: userId });
}

describe("Natural-language preferences", () => {
  test("anonymous callers cannot spend credits", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(t.action(api.preferences.parse, { text: "1 bedroom" })).rejects.toThrow("Please sign in");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("an empty description is rejected before calling the model", async () => {
    const client = await signedIn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(client.action(api.preferences.parse, { text: "   " })).rejects.toThrow("Tell us what you're looking for");
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a described search becomes filters, and today's date is given to the model", async () => {
    const client = await signedIn();
    const fetch = vi.fn().mockResolvedValue(reply({
      minRent: null, maxRent: 1400, moveIn: "2026-11-01", bedrooms: [1], bathrooms: [], floors: [],
      leaseMonths: [12], sqftMin: null, sqftMax: null, pets: ["dog"], amenities: ["laundry"], notes: "close to campus",
    }));
    vi.stubGlobal("fetch", fetch);
    const result = await client.action(api.preferences.parse, { text: "1 bedroom under $1400, dog-friendly, in-unit laundry, moving in November, close to campus" });
    expect(result).toMatchObject({
      // "under $1400" states no floor, so no minimum is imposed.
      city: "Ann Arbor, Michigan", minRent: 0, maxRent: 1400, moveIn: "2026-11-01", notes: "close to campus",
      bedrooms: { values: [1], weight: "must" }, pets: { values: ["dog"], weight: "must" },
      amenities: [{ key: "laundry", weight: "must" }], leaseMonths: { values: [12], weight: "must" },
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body).messages[1].content).toContain(new Date().toISOString().slice(0, 10));
  });

  test("values searches.start would reject are dropped rather than passed on", async () => {
    const client = await signedIn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({
      minRent: 900, maxRent: 1500, moveIn: "next November", bedrooms: [1, 9, 2.5], bathrooms: [3], floors: [7],
      leaseMonths: [18], sqftMin: null, sqftMax: null, pets: ["dog", "ferret"], amenities: ["laundry", "rooftop helipad"], notes: "",
    })));
    const result = await client.action(api.preferences.parse, { text: "anything" });
    expect(result.bedrooms.values).toEqual([1]);
    expect(result.bathrooms.values).toEqual([]);
    expect(result.floors.values).toEqual([]);
    expect(result.leaseMonths.values).toEqual([]);
    expect(result.pets.values).toEqual(["dog"]);
    expect(result.amenities).toEqual([{ key: "laundry", weight: "must" }]);
    // An unparseable date leaves the required field empty for the renter to pick.
    expect(result.moveIn).toBe("");
  });

  test("an inverted rent range is straightened so the search is startable", async () => {
    const client = await signedIn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({
      minRent: 1800, maxRent: 900, moveIn: null, bedrooms: [], bathrooms: [], floors: [],
      leaseMonths: [], sqftMin: 1200, sqftMax: 600, pets: [], amenities: [], notes: "",
    })));
    const result = await client.action(api.preferences.parse, { text: "anything" });
    expect(result.minRent).toBe(900);
    expect(result.maxRent).toBe(1800);
    expect(result.sqft.max).toBeGreaterThanOrEqual(result.sqft.min ?? 0);
  });

  test("a failed request asks the renter to rephrase instead of leaking the provider error", async () => {
    const client = await signedIn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(client.action(api.preferences.parse, { text: "1 bedroom" })).rejects.toThrow("Couldn't read that");
  });
});
