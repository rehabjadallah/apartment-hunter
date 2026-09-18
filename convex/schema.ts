import { defineSchema, defineTable } from "convex/server";
import { v, type Infer } from "convex/values";

const weight = v.union(v.literal("must"), v.literal("want"), v.literal("nice"));
const values = v.object({ values: v.array(v.number()), weight });
const amenity = v.union(v.literal("parking"), v.literal("laundry"), v.literal("dishwasher"),
  v.literal("airConditioning"), v.literal("balcony"), v.literal("gym"), v.literal("pool"), v.literal("elevator"), v.literal("furnished"));
export const preferences = v.object({
  city: v.literal("Ann Arbor, Michigan"),
  minRent: v.number(), maxRent: v.number(), moveIn: v.string(), notes: v.string(),
  bedrooms: values, bathrooms: values, floors: values, leaseMonths: values,
  sqft: v.object({ min: v.optional(v.number()), max: v.optional(v.number()), weight }),
  pets: v.object({ values: v.array(v.union(v.literal("cat"), v.literal("dog"))), weight }),
  amenities: v.array(v.object({ key: amenity, weight })),
});
export type Preferences = Infer<typeof preferences>;

export default defineSchema({
  users: defineTable({ name: v.optional(v.string()), preferences: v.optional(preferences), inboxId: v.optional(v.string()) }),
  searches: defineTable({
    userId: v.id("users"), preferences,
    status: v.union(v.literal("searching"), v.literal("complete"), v.literal("failed")),
    error: v.optional(v.string()),
  }).index("by_user", ["userId"]),
  listings: defineTable({
    searchId: v.id("searches"), title: v.string(), url: v.string(),
    summary: v.string(), rent: v.optional(v.number()), bedrooms: v.optional(v.number()),
    contactEmail: v.optional(v.string()), matches: v.array(v.string()),
    unknowns: v.array(v.string()), checkedAt: v.number(), score: v.number(), mustMisses: v.number(),
  }).index("by_search", ["searchId"]),
  inquiries: defineTable({
    userId: v.id("users"), listingId: v.id("listings"), subject: v.string(), body: v.string(),
    status: v.union(v.literal("preparing"), v.literal("queued"), v.literal("failed")),
    outboundId: v.optional(v.string()), error: v.optional(v.string()),
  }).index("by_user", ["userId"]).index("by_user_listing", ["userId", "listingId"]),
});
