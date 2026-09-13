import { getAuthUserId } from "@convex-dev/auth/core";
import { ConvexError, v } from "convex/values";
import { internalMutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
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
    return { username, preferences: user.preferences };
  },
});
