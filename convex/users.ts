import { getAuthUserId } from "@convex-dev/auth/core";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import { components } from "./_generated/api";

export async function requireUser(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  const user = userId ? await ctx.db.get("users", userId) : null;
  if (!user) throw new ConvexError("Please sign in to continue.");
  return user;
}

export const createUser = internalMutation({
  args: { provider: v.literal("password"), providerAccountId: v.string(), profile: v.object({ username: v.string() }) },
  returns: v.id("users"),
  handler: (ctx) => ctx.db.insert("users", {}),
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const username = await ctx.runQuery(components.authUsername.public.getUsername, { userId: user._id });
    return { username, name: user.name, preferences: user.preferences };
  },
});

export const saveName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = args.name.trim();
    if (!name || name.length > 100) throw new ConvexError("Please enter a name between 1 and 100 characters.");
    await ctx.db.patch("users", user._id, { name });
  },
});
