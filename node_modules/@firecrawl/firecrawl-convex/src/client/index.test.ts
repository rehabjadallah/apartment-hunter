/// <reference types="vite/client" />
import { afterEach, describe, expect, test, vi } from "vitest";
import { actionGeneric, anyApi, type ApiFromModules } from "convex/server";
import { v } from "convex/values";
import { FirecrawlClient } from "./index.js";
import { components, initConvexTest, mockFetch } from "./setup.test.js";

const firecrawl = new FirecrawlClient(components.firecrawl);

// App-side wrappers, the way a consuming app would write them.
export const scrapePage = actionGeneric({
  args: { url: v.string() },
  handler: async (ctx, args) =>
    await firecrawl.scrape(ctx, args.url, { formats: ["markdown"] }),
});

export const searchWeb = actionGeneric({
  args: { query: v.string() },
  handler: async (ctx, args) =>
    await firecrawl.search(ctx, args.query, { limit: 2 }),
});

export const crawlSite = actionGeneric({
  args: { url: v.string() },
  handler: async (ctx, args) =>
    await firecrawl.startCrawl(ctx, {
      url: args.url,
      mode: "poll",
      options: { limit: 5 },
    }),
});

const testApi = (
  anyApi as unknown as ApiFromModules<{
    "index.test": {
      scrapePage: typeof scrapePage;
      searchWeb: typeof searchWeb;
      crawlSite: typeof crawlSite;
    };
  }>
)["index.test"];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FirecrawlClient", () => {
  test("scrape reaches the component and returns the document", async () => {
    const t = initConvexTest();
    const calls = mockFetch([
      { success: true, data: { markdown: "# Hello" } },
    ]);

    const document = await t.action(testApi.scrapePage, {
      url: "https://a.com",
    });

    expect(document).toEqual({ markdown: "# Hello" });
    expect(calls[0].url).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(calls[0].body.formats).toEqual(["markdown"]);
  });

  test("search passes options through", async () => {
    const t = initConvexTest();
    const calls = mockFetch([
      { success: true, data: { web: [{ url: "https://a.com" }] } },
    ]);

    const results = await t.action(testApi.searchWeb, { query: "convex" });

    expect(results).toEqual({ web: [{ url: "https://a.com" }] });
    expect(calls[0].body).toMatchObject({ query: "convex", limit: 2 });
  });

  test("startCrawl returns ids the app can subscribe to", async () => {
    const t = initConvexTest();
    mockFetch([{ success: true, id: "job-9", url: "https://a.com" }]);

    const { crawlId, jobId } = await t.action(testApi.crawlSite, {
      url: "https://a.com",
    });

    expect(jobId).toBe("job-9");
    expect(crawlId).toBeTypeOf("string");
  });
});
