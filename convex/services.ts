import { AgentMail } from "@agentmail/convex";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internalAction } from "./_generated/server";

const agentmail = new AgentMail(components.agentmail);
const firecrawl = new FirecrawlClient(components.firecrawl);

// Internal helpers for future app workflows; not callable from the browser.
export const listInboxes = internalAction({
  args: {},
  handler: (ctx) => agentmail.listInboxes(ctx, { limit: 10 }),
});

export const scrapePage = internalAction({
  args: { url: v.string() },
  handler: (ctx, { url }) => firecrawl.scrape(ctx, url, {
    formats: ["markdown"],
    onlyMainContent: true,
  }),
});
