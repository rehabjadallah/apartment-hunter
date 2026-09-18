import { v, type Infer } from "convex/values";
import { internalMutation } from "./_generated/server";
import { preferences, type Preferences } from "./schema";
import { recordedListingScore } from "./searches";

const values = preferences.fields.bedrooms;
export const migrationPreferences = v.object({
  city: v.optional(preferences.fields.city), minRent: v.optional(v.number()), maxRent: v.optional(v.number()),
  moveIn: v.optional(v.string()), notes: v.optional(v.string()),
  bedrooms: v.optional(v.union(v.number(), values)), bathrooms: v.optional(values), floors: v.optional(values), leaseMonths: v.optional(values),
  sqft: v.optional(preferences.fields.sqft),
  pets: v.optional(v.union(v.literal("none"), v.literal("cat"), v.literal("dog"), preferences.fields.pets)),
  parking: v.optional(v.boolean()), laundry: v.optional(v.boolean()), amenities: v.optional(preferences.fields.amenities),
});

function normalizePreferences(p: Infer<typeof migrationPreferences>): Preferences {
  if (p.city === undefined || p.minRent === undefined || p.maxRent === undefined || p.moveIn === undefined ||
    p.notes === undefined || p.bedrooms === undefined || p.pets === undefined) throw new Error("Cannot migrate incomplete preferences.");
  return {
    city: p.city, minRent: p.minRent, maxRent: p.maxRent, moveIn: p.moveIn, notes: p.notes,
    bedrooms: typeof p.bedrooms === "number" ? { values: [p.bedrooms], weight: "must" } : p.bedrooms,
    bathrooms: p.bathrooms ?? { values: [], weight: "nice" }, floors: p.floors ?? { values: [], weight: "nice" },
    leaseMonths: p.leaseMonths ?? { values: [], weight: "nice" }, sqft: p.sqft ?? { weight: "nice" },
    pets: typeof p.pets === "string" ? { values: p.pets === "none" ? [] : [p.pets], weight: p.pets === "none" ? "nice" : "must" } : p.pets,
    amenities: p.amenities ?? [
      ...(p.parking ? [{ key: "parking" as const, weight: "must" as const }] : []),
      ...(p.laundry ? [{ key: "laundry" as const, weight: "must" as const }] : []),
    ],
  };
}

const needsMigration = (p: Infer<typeof migrationPreferences>) => typeof p.bedrooms === "number" || typeof p.pets === "string" ||
  p.parking !== undefined || p.laundry !== undefined || p.bathrooms === undefined || p.floors === undefined ||
  p.leaseMonths === undefined || p.sqft === undefined || p.amenities === undefined;

export const flexibleFilters = internalMutation({
  args: {},
  returns: v.object({ users: v.number(), searches: v.number(), listings: v.number(),
    checked: v.object({ users: v.number(), searches: v.number(), listings: v.number() }) }),
  handler: async ctx => {
    const users = await ctx.db.query("users").take(2001);
    const searches = await ctx.db.query("searches").take(2001);
    const listings = await ctx.db.query("listings").take(2001);
    // Refuse partial migration if the database has outgrown this one-transaction backfill.
    if (users.length + searches.length + listings.length > 2000) throw new Error("Flexible filters migration exceeds 2000 rows; use a batched migration.");
    const updated = { users: 0, searches: 0, listings: 0 };
    for (const user of users) {
      if (user.preferences && needsMigration(user.preferences)) {
        await ctx.db.patch(user._id, { preferences: normalizePreferences(user.preferences) });
        updated.users++;
      }
    }
    const preferences = new Map(searches.map(search => [search._id, normalizePreferences(search.preferences)]));
    for (const search of searches) {
      if (needsMigration(search.preferences)) {
        await ctx.db.patch(search._id, { preferences: normalizePreferences(search.preferences) });
        updated.searches++;
      }
    }
    for (const listing of listings) {
      if (listing.score !== undefined && listing.mustMisses !== undefined) continue;
      const p = preferences.get(listing.searchId);
      if (!p) throw new Error("Cannot score a listing without its saved search.");
      await ctx.db.patch(listing._id, recordedListingScore(p, listing));
      updated.listings++;
    }
    return { ...updated, checked: { users: users.length, searches: searches.length, listings: listings.length } };
  },
});
