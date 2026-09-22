import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalQuery } from "./_generated/server";
import { requireUser } from "./users";
import { chatJson, requireKey } from "./openai";
import type { Preferences } from "./schema";

const MAX_INPUT = 500;

// The exact value sets searches.start accepts. Anything else the model returns is dropped
// rather than passed on, so a hallucinated value cannot break the form or the search.
const AMENITIES = ["parking", "laundry", "dishwasher", "airConditioning", "balcony", "gym", "pool", "elevator", "furnished"] as const;
const BATHROOMS = [1, 1.5, 2];
const FLOORS = [1, 2, 3];
const LEASE_MONTHS = [1, 6, 9, 12];

const instructions = `You turn one sentence from an apartment hunter into search filters.

Return only what the sentence actually states. Leave everything else empty. Guessing produces filters the renter did not ask for, which silently hides listings from them.

Fields, and the only values each accepts:
- minRent, maxRent: monthly USD, 0 to 20000, or null. "under $1400" means maxRent 1400 and minRent null. "around $1200" means roughly 1100 to 1300.
- moveIn: "YYYY-MM-DD", or null. Resolve relative dates against "today" in the input. A bare month means the first of that month, in the next occurrence of it.
- bedrooms: integers 0 to 6. A studio is 0.
- bathrooms: only 1, 1.5, or 2. Use 2 for "2 or more".
- floors: only 1, 2, or 3. Use 3 for "third or higher". Ground floor is 1.
- leaseMonths: only 1, 6, 9, or 12. Month-to-month is 1.
- sqftMin, sqftMax: integers or null.
- pets: only "cat" and "dog". Include a pet only when the renter says they have one.
- amenities: only these keys - parking, laundry, dishwasher, airConditioning, balcony, gym, pool, elevator, furnished. "laundry" means in-unit laundry.
- notes: anything the renter asked for that no field above captures, in their own words. Empty string if there is nothing left over. Never restate something already captured by a field.

Rules:
- A preference the sentence does not state is an empty array or null. Never fill a field to be helpful.
- "dog-friendly" or "I have a dog" means pets ["dog"]. A dog does not imply parking, a yard, or a ground floor.
- Neighborhoods, commute, noise, and anything else with no field belongs in notes.

Respond with JSON matching exactly:
{"minRent": number|null, "maxRent": number|null, "moveIn": string|null, "bedrooms": number[], "bathrooms": number[], "floors": number[], "leaseMonths": number[], "sqftMin": number|null, "sqftMax": number|null, "pets": string[], "amenities": string[], "notes": string}`;

const numbers = (value: unknown, allowed: number[]) => Array.isArray(value)
  ? [...new Set(value.filter((item): item is number => typeof item === "number" && allowed.includes(item)))]
  : [];

const rent = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 20000 ? Math.round(value) : fallback;

const size = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

export const requireSignedIn = internalQuery({
  args: {},
  handler: async (ctx) => { await requireUser(ctx); return null; },
});

// Exported so descriptions can be parsed without an authenticated caller.
export async function parseDescription(key: string, described: string, today: string): Promise<Preferences> {
  {
    {
      const parsed = await chatJson({ key, instructions, payload: { today, description: described } });

      const bedrooms = Array.isArray(parsed.bedrooms)
        ? [...new Set(parsed.bedrooms.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6))]
        : [];
      const moveIn = typeof parsed.moveIn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(parsed.moveIn) && Number.isFinite(Date.parse(parsed.moveIn))
        ? parsed.moveIn : "";
      // "under $1400" states no floor, so an unstated minimum is 0 rather than the form's
      // default - a default floor would silently hide cheaper listings the renter never excluded.
      // An unstated maximum keeps the form default, which the renter sees and can raise.
      const minRent = rent(parsed.minRent, 0);
      const maxRent = rent(parsed.maxRent, 2000);
      const sqftMin = size(parsed.sqftMin);
      const sqftMax = size(parsed.sqftMax);

      return {
        city: "Ann Arbor, Michigan",
        // searches.start rejects a max below the min, so an inverted pair is straightened here.
        minRent: Math.min(minRent, maxRent), maxRent: Math.max(minRent, maxRent),
        moveIn, notes: typeof parsed.notes === "string" ? parsed.notes.slice(0, 500) : "",
        bedrooms: { values: bedrooms, weight: "must" },
        bathrooms: { values: numbers(parsed.bathrooms, BATHROOMS), weight: "must" },
        floors: { values: numbers(parsed.floors, FLOORS), weight: "must" },
        leaseMonths: { values: numbers(parsed.leaseMonths, LEASE_MONTHS), weight: "must" },
        sqft: {
          min: sqftMin, max: sqftMax !== undefined && sqftMin !== undefined ? Math.max(sqftMin, sqftMax) : sqftMax,
          weight: "must",
        },
        pets: {
          values: Array.isArray(parsed.pets)
            ? [...new Set(parsed.pets.filter((value): value is "cat" | "dog" => value === "cat" || value === "dog"))] : [],
          weight: "must",
        },
        amenities: Array.isArray(parsed.amenities)
          ? [...new Set(parsed.amenities.filter((value): value is typeof AMENITIES[number] => AMENITIES.includes(value as never)))]
            .map(key => ({ key, weight: "must" as const }))
          : [],
      };
    }
  }
}

export const parse = action({
  args: { text: v.string() },
  handler: async (ctx, { text }): Promise<Preferences> => {
    await ctx.runQuery(internal.preferences.requireSignedIn, {});
    const described = text.trim().slice(0, MAX_INPUT);
    if (!described) throw new ConvexError("Tell us what you're looking for first.");
    let key: string;
    try { key = requireKey(); } catch { throw new ConvexError("Reading your description is unavailable right now."); }
    try {
      return await parseDescription(key, described, new Date().toISOString().slice(0, 10));
    } catch (error) {
      // Keep provider details out of the UI while retaining a server-side diagnosis.
      console.error("Preference parsing failed", error instanceof Error ? error.message : "Unknown error");
      throw new ConvexError("Couldn't read that. Try rephrasing, or fill in the filters below.");
    }
  },
});
