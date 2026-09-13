import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { preferences } from "./schema";
import { requireUser } from "./users";

export const start = mutation({
  args: { preferences },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const p = args.preferences;
    if (![p.minRent, p.maxRent, p.bedrooms].every(Number.isFinite) ||
      p.minRent < 0 || p.maxRent < p.minRent || p.maxRent > 20000 ||
      !Number.isInteger(p.bedrooms) || p.bedrooms < 0 || p.bedrooms > 6 || p.notes.length > 500 ||
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
    return { ...search, listings: await ctx.db.query("listings").withIndex("by_search", q => q.eq("searchId", searchId)).collect() };
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
    matches: v.array(v.string()), unknowns: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    if ((await ctx.db.get(args.searchId))?.status === "searching") await ctx.db.insert("listings", { ...args, checkedAt: Date.now() });
  },
});
