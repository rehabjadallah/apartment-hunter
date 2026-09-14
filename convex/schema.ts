import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const preferences = v.object({
  city: v.literal("Ann Arbor, Michigan"),
  minRent: v.number(), maxRent: v.number(), bedrooms: v.number(),
  moveIn: v.string(), pets: v.union(v.literal("none"), v.literal("cat"), v.literal("dog")),
  parking: v.boolean(), laundry: v.boolean(), notes: v.string(),
});

export default defineSchema({
  users: defineTable({ preferences: v.optional(preferences), inboxId: v.optional(v.string()) }),
  searches: defineTable({
    userId: v.id("users"), preferences,
    status: v.union(v.literal("searching"), v.literal("complete"), v.literal("failed")),
    error: v.optional(v.string()),
  }).index("by_user", ["userId"]),
  listings: defineTable({
    searchId: v.id("searches"), title: v.string(), url: v.string(),
    summary: v.string(), rent: v.optional(v.number()), bedrooms: v.optional(v.number()),
    contactEmail: v.optional(v.string()), matches: v.array(v.string()),
    unknowns: v.array(v.string()), checkedAt: v.number(),
  }).index("by_search", ["searchId"]),
  inquiries: defineTable({
    userId: v.id("users"), listingId: v.id("listings"), subject: v.string(), body: v.string(),
    status: v.union(v.literal("preparing"), v.literal("queued"), v.literal("failed")),
    outboundId: v.optional(v.string()), error: v.optional(v.string()),
  }).index("by_user", ["userId"]).index("by_user_listing", ["userId", "listingId"]),
});
