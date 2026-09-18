import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { preferences, type Preferences } from "./schema";
import type { Doc } from "./_generated/dataModel";
import { requireUser } from "./users";

const amenityLabels = { parking: "Parking", laundry: "In-unit laundry", dishwasher: "Dishwasher", airConditioning: "Air conditioning",
  balcony: "Balcony", gym: "Gym", pool: "Pool", elevator: "Elevator", furnished: "Furnished" };

function matchesPreferences(p: Preferences, listing: Doc<"listings">) {
  const { rent, bedrooms, matches } = listing;
  if (!matches.includes("Ann Arbor") || rent === undefined || !Number.isFinite(rent) || rent < p.minRent || rent > p.maxRent) return false;
  if (p.bedrooms.values.length && (bedrooms === undefined || !p.bedrooms.values.includes(bedrooms))) return false;
  // These labels record facts confirmed against this saved search, including its range and multi-select rules.
  return (!p.bathrooms.values.length || matches.some(line => /^\d+(?:\.\d+)? bathrooms$/.test(line))) &&
    (p.sqft.min === undefined && p.sqft.max === undefined || matches.some(line => /^\d+(?:\.\d+)? sq ft$/.test(line))) &&
    (!p.floors.values.length || matches.some(line => /^Floor \d+$/.test(line))) &&
    (!p.leaseMonths.values.length || matches.some(line => /^\d+(?: or \d+)* month lease$/.test(line))) &&
    p.pets.values.every(pet => matches.includes(pet === "cat" ? "Cats allowed" : "Dogs allowed")) &&
    p.amenities.every(amenity => matches.includes(amenityLabels[amenity.key]));
}

export const start = mutation({
  args: { preferences },
  returns: v.id("searches"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const p = args.preferences;
    if (![p.minRent, p.maxRent].every(Number.isFinite) ||
      p.minRent < 0 || p.maxRent < p.minRent || p.maxRent > 20000 ||
      p.bedrooms.values.some(value => !Number.isInteger(value) || value < 0 || value > 6) ||
      p.bathrooms.values.some(value => ![1, 1.5, 2].includes(value)) || p.floors.values.some(value => ![1, 2, 3].includes(value)) ||
      p.leaseMonths.values.some(value => ![1, 6, 9, 12].includes(value)) ||
      [p.sqft.min, p.sqft.max].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)) ||
      (p.sqft.min !== undefined && p.sqft.max !== undefined && p.sqft.max < p.sqft.min) ||
      new Set(p.amenities.map(item => item.key)).size !== p.amenities.length || p.notes.length > 500 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.moveIn) || !Number.isFinite(Date.parse(p.moveIn))) {
      throw new ConvexError("Please check your budget, bedrooms, and move-in date.");
    }
    const recent = await ctx.db.query("searches").withIndex("by_user", q => q.eq("userId", user._id)).order("desc").first();
    if (recent && Date.now() - recent._creationTime < 60_000) throw new ConvexError("Please wait a minute before starting another search.");
    await ctx.db.patch(user._id, { preferences: p });
    const searchId = await ctx.db.insert("searches", { userId: user._id, preferences: p, status: "searching" });
    await ctx.scheduler.runAfter(0, internal.discovery.run, { searchId });
    await ctx.scheduler.runAfter(180_000, internal.searches.timeout, { searchId });
    return searchId;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return ctx.db.query("searches").withIndex("by_user", q => q.eq("userId", user._id)).order("desc").take(20);
  },
});

export const results = query({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const user = await requireUser(ctx);
    const search = await ctx.db.get(searchId);
    if (!search || search.userId !== user._id) throw new ConvexError("Search not found.");
    const listings = await ctx.db.query("listings").withIndex("by_search", q => q.eq("searchId", searchId)).collect();
    const matches = listings.filter(listing => matchesPreferences(search.preferences, listing));
    matches.sort((a, b) => (a.rent ?? Infinity) - (b.rent ?? Infinity));
    return { ...search, listings: matches };
  },
});

export const get = internalQuery({ args: { searchId: v.id("searches") }, handler: (ctx, { searchId }) => ctx.db.get(searchId) });
export const finish = internalMutation({
  args: { searchId: v.id("searches"), error: v.optional(v.string()) },
  handler: async (ctx, { searchId, error }) => {
    const search = await ctx.db.get(searchId);
    if (search?.status === "searching") await ctx.db.patch(searchId, { status: error ? "failed" : "complete", error });
  },
});
export const timeout = internalMutation({
  args: { searchId: v.id("searches") },
  handler: async (ctx, { searchId }) => {
    const search = await ctx.db.get(searchId);
    if (search?.status === "searching") await ctx.db.patch(searchId, { status: "failed", error: "Search took too long. You can try again." });
  },
});
export const addListing = internalMutation({
  args: {
    searchId: v.id("searches"), title: v.string(), url: v.string(), summary: v.string(),
    rent: v.optional(v.number()), bedrooms: v.optional(v.number()), contactEmail: v.optional(v.string()),
    matches: v.array(v.string()), unknowns: v.array(v.string()), score: v.number(), mustMisses: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const search = await ctx.db.get(args.searchId);
    if (search?.status === "searching") await ctx.db.insert("listings", {
      ...args, checkedAt: Date.now(),
    });
    return null;
  },
});

// Historical rows retain numeric facts and confirmed labels, not the original extraction.
export function recordedListingScore(p: Preferences, listing: Pick<Doc<"listings">, "rent" | "bedrooms" | "matches">) {
  let score = 0; let mustMisses = 0;
  const points = { must: 5, want: 3, nice: 1 };
  const add = (weight: Preferences["bedrooms"]["weight"], confirmed: boolean | undefined) => {
    if (confirmed === undefined) return;
    score += confirmed ? points[weight] : -points[weight];
    if (!confirmed && weight === "must") mustMisses++;
  };
  add("must", listing.rent === undefined ? undefined : listing.rent >= p.minRent && listing.rent <= p.maxRent);
  if (p.bedrooms.values.length) add(p.bedrooms.weight, listing.bedrooms === undefined ? undefined : p.bedrooms.values.includes(listing.bedrooms));
  if (p.pets.values.length) add(p.pets.weight, p.pets.values.every(pet => listing.matches.includes(pet === "cat" ? "Cats allowed" : "Dogs allowed")) ? true : undefined);
  for (const amenity of p.amenities) add(amenity.weight, listing.matches.includes(amenityLabels[amenity.key]) ? true : undefined);
  return { score, mustMisses };
}
