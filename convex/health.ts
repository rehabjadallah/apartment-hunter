import { query } from "./_generated/server";

// Reading an empty collection is sufficient to verify database access.
export const check = query({
  args: {},
  handler: async (ctx) => {
    await ctx.db.query("users").first();
    return { database: "connected" as const };
  },
});
