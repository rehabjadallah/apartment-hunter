import { internalQuery } from "./_generated/server";

// Admin-only diagnostic: return presence, never secret values.
export const credentials = internalQuery({
  args: {},
  handler: () => ({
    agentmail: Boolean(process.env.AGENTMAIL_API_KEY),
    firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
  }),
});
