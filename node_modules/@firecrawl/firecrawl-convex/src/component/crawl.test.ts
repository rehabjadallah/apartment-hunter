/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest, mockFetch, TEST_SITE_URL } from "./setup.test.js";
import { TOKEN_HEADER, _test } from "./crawl.js";
import type { Id } from "./_generated/dataModel.js";
import { sign } from "./signature.js";

function doc(url: string, markdown = "# page") {
  return { markdown, metadata: { url, statusCode: 200, title: url } };
}

const startResponse = {
  body: { success: true, id: "job-1", url: "https://a.com" },
};

function statusResponse(
  overrides: Record<string, unknown> = {},
): { body: Record<string, unknown> } {
  return {
    body: {
      success: true,
      status: "completed",
      total: 2,
      completed: 2,
      creditsUsed: 2,
      data: [doc("https://a.com/one"), doc("https://a.com/two")],
      ...overrides,
    },
  };
}

/** Read internal fields the public API deliberately hides. */
async function readToken(t: any, crawlId: string): Promise<string> {
  return await t.run(async (ctx: any) => {
    const crawl = await ctx.db.get("crawls", crawlId);
    return crawl.token;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.FIRECRAWL_WEBHOOK_SECRET;
});

describe("poll mode", () => {
  test("starts a crawl, polls to completion, and stores pages", async () => {
    const t = initConvexTest();
    const { calls } = mockFetch([startResponse, statusResponse()]);

    const { crawlId, jobId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      options: { limit: 2 },
      mode: "poll",
    });
    expect(jobId).toBe("job-1");
    expect(calls[0].body.webhook).toBeUndefined();
    expect(calls[0].body.limit).toBe(2);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({
      status: "completed",
      finalized: true,
      total: 2,
      completed: 2,
      creditsUsed: 2,
      pageCount: 2,
    });
    expect(calls[1].url).toBe("https://api.firecrawl.dev/v2/crawl/job-1");
    expect(calls[1].method).toBe("GET");

    const pages = await t.query(api.crawl.listPages, {
      crawlId,
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(pages.page.map((page: any) => page.url)).toEqual([
      "https://a.com/one",
      "https://a.com/two",
    ]);
    expect(pages.page[0].markdown).toBe("# page");
    expect(pages.isDone).toBe(true);
  });

  test("follows the `next` cursor before finalizing", async () => {
    const t = initConvexTest();
    const { calls } = mockFetch([
      startResponse,
      statusResponse({
        status: "scraping",
        next: "https://api.firecrawl.dev/v2/crawl/job-1?skip=2",
        data: [doc("https://a.com/one")],
      }),
      statusResponse({ data: [doc("https://a.com/two")] }),
    ]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(calls[2].url).toBe(
      "https://api.firecrawl.dev/v2/crawl/job-1?skip=2",
    );
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "completed", pageCount: 2 });
  });

  test("stores metadata only when storeContent is false", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse()]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
      storeContent: false,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const page = await t.query(api.crawl.getPage, {
      crawlId,
      url: "https://a.com/one",
    });
    expect(page!.markdown).toBeUndefined();
    expect(page!.metadata.title).toBe("https://a.com/one");
  });

  test("marks the crawl failed when starting it fails", async () => {
    const t = initConvexTest();
    mockFetch([{ status: 401, body: { success: false, error: "bad key" } }]);

    await expect(
      t.action(api.crawl.start, { url: "https://a.com", mode: "poll" }),
    ).rejects.toThrow(/bad key/);

    const crawls = await t.query(api.crawl.listCrawls, {});
    expect(crawls).toHaveLength(1);
    expect(crawls[0]).toMatchObject({ status: "failed", finalized: true });
    expect(crawls[0].error).toMatch(/bad key/);
  });

  test("reports a failed crawl from the status endpoint", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse({ status: "failed", data: [] })]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "failed", finalized: true });
  });
});

describe("webhook mode", () => {
  test("registers a webhook pointing at the mounted route", async () => {
    const t = initConvexTest();
    const { calls } = mockFetch([startResponse, statusResponse()]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });

    const token = await readToken(t, crawlId);
    expect(calls[0].body.webhook).toEqual({
      url: `${TEST_SITE_URL}/webhook`,
      headers: { [TOKEN_HEADER]: token },
      metadata: { crawlId },
      events: ["started", "page", "completed", "failed"],
    });
  });

  test("stores a page from a crawl.page delivery", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });
    const token = await readToken(t, crawlId);

    const response = await t.fetch("/webhook", {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        type: "crawl.page",
        id: "job-1",
        data: [doc("https://a.com/one")],
        metadata: { crawlId },
      }),
    });

    expect(response.status).toBe(200);
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "scraping", pageCount: 1 });
  });

  test("rejects a delivery with the wrong token", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });

    const response = await t.fetch("/webhook", {
      method: "POST",
      headers: { [TOKEN_HEADER]: "nope", "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        type: "crawl.page",
        id: "job-1",
        data: [doc("https://a.com/one")],
        metadata: { crawlId },
      }),
    });

    expect(response.status).toBe(401);
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl!.pageCount).toBe(0);
  });

  test("reconciles through the status endpoint on crawl.completed", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse()]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });
    const token = await readToken(t, crawlId);

    await t.fetch("/webhook", {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body: JSON.stringify({
        success: true,
        type: "crawl.completed",
        id: "job-1",
        data: [],
        metadata: { crawlId },
      }),
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    // The two pages we never got `page` deliveries for are still stored.
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({
      status: "completed",
      finalized: true,
      pageCount: 2,
    });
  });

  test("requires a valid signature when a webhook secret is set", async () => {
    const t = initConvexTest();
    process.env.FIRECRAWL_WEBHOOK_SECRET = "whsec-test";
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
    });
    const token = await readToken(t, crawlId);
    const body = JSON.stringify({
      success: true,
      type: "crawl.page",
      id: "job-1",
      data: [doc("https://a.com/one")],
      metadata: { crawlId },
    });

    const unsigned = await t.fetch("/webhook", {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
      body,
    });
    expect(unsigned.status).toBe(401);

    const signed = await t.fetch("/webhook", {
      method: "POST",
      headers: {
        [TOKEN_HEADER]: token,
        "content-type": "application/json",
        "x-firecrawl-signature": await sign("whsec-test", body),
      },
      body,
    });
    expect(signed.status).toBe(200);
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl!.pageCount).toBe(1);
  });
});

describe("housekeeping", () => {
  test("a page delivered twice is stored once", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });

    for (let i = 0; i < 2; i++) {
      await t.mutation(internal.crawl.ingestPages, {
        crawlId: crawlId as Id<"crawls">,
        documents: [doc("https://a.com/one", `# take ${i}`)],
      });
    }

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl!.pageCount).toBe(1);
    const page = await t.query(api.crawl.getPage, {
      crawlId,
      url: "https://a.com/one",
    });
    expect(page!.markdown).toBe("# take 1");
  });

  test("an oversized page is stored clamped, and the crawl still finishes", async () => {
    const t = initConvexTest();
    // 3MB of markdown: without clamping this document could not be written.
    // (convex-test doesn't enforce Convex's 1MB limit, so this asserts the
    // stored size directly rather than relying on the harness to reject it.)
    const huge = {
      markdown: "m".repeat(3_000_000),
      metadata: { url: "https://a.com/huge" },
    };
    mockFetch([startResponse, statusResponse({ data: [huge] })]);

    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const page = await t.query(api.crawl.getPage, {
      crawlId,
      url: "https://a.com/huge",
    });
    expect(page!.truncated).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(page)).length,
    ).toBeLessThan(1_000_000);
    expect(page!.markdown!.length).toBeGreaterThan(0);
    expect(await t.query(api.crawl.get, { crawlId })).toMatchObject({
      status: "completed",
      finalized: true,
    });
  });

  test("stops tracking terminally instead of hanging in `scraping`", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });

    // Jump to the attempt ceiling, then let one more status check land.
    await t.run(async (ctx: any) => {
      const id = ctx.db.normalizeId("crawls", crawlId);
      await ctx.db.patch("crawls", id, { pollAttempt: 249 });
    });
    await t.mutation(internal.crawl.advance, {
      crawlId: crawlId as Id<"crawls">,
      status: "scraping",
    });

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "failed", finalized: true });
    expect(crawl!.error).toMatch(/resume/);
  });

  test("resume picks tracking back up after giving up", async () => {
    const t = initConvexTest();
    mockFetch([
      startResponse,
      statusResponse({ status: "scraping", data: [] }),
      statusResponse(),
    ]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.run(async (ctx: any) => {
      const id = ctx.db.normalizeId("crawls", crawlId);
      await ctx.db.patch("crawls", id, { pollAttempt: 249 });
    });
    await t.mutation(internal.crawl.advance, {
      crawlId: crawlId as Id<"crawls">,
      status: "scraping",
    });
    expect((await t.query(api.crawl.get, { crawlId }))!.finalized).toBe(true);

    expect(await t.mutation(api.crawl.resume, { crawlId })).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "completed", finalized: true });
    expect(crawl!.error).toBeUndefined();
  });

  test("resume is a no-op for a crawl that genuinely completed", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse()]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.mutation(api.crawl.resume, { crawlId })).toBe(false);
  });

  test("cancel tells Firecrawl and finalizes locally", async () => {
    const t = initConvexTest();
    const { calls } = mockFetch([startResponse, { body: { success: true } }]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });

    await t.action(api.crawl.cancel, { crawlId });

    expect(calls[1].method).toBe("DELETE");
    expect(calls[1].url).toBe("https://api.firecrawl.dev/v2/crawl/job-1");
    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).toMatchObject({ status: "cancelled", finalized: true });
  });

  test("deleteCrawl removes the crawl and its pages", async () => {
    const t = initConvexTest();
    mockFetch([startResponse, statusResponse()]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await t.mutation(api.crawl.deleteCrawl, { crawlId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(await t.query(api.crawl.get, { crawlId })).toBeNull();
    const remaining = await t.run(async (ctx: any) =>
      await ctx.db.query("pages").collect(),
    );
    expect(remaining).toHaveLength(0);
  });

  test("hides internal bookkeeping from the public crawl document", async () => {
    const t = initConvexTest();
    mockFetch([startResponse]);
    const { crawlId } = await t.action(api.crawl.start, {
      url: "https://a.com",
      mode: "poll",
    });

    const crawl = await t.query(api.crawl.get, { crawlId });
    expect(crawl).not.toHaveProperty("token");
    expect(crawl).not.toHaveProperty("onComplete");
    expect(crawl).not.toHaveProperty("nextUrl");
    expect(crawl).not.toHaveProperty("pollAttempt");
  });
});

describe("content handling", () => {
  test("keys pages off metadata.url, falling back to sourceURL", () => {
    expect(
      _test.toPageFields({ metadata: { sourceURL: "https://a.com/x" } }, true)
        ?.url,
    ).toBe("https://a.com/x");
    expect(_test.toPageFields({ metadata: {} }, true)).toBeNull();
  });

  const docBytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).length;

  test("keeps the whole document under Convex's 1MB limit", () => {
    const clamped = _test.clampContent({
      url: "https://a.com",
      markdown: "m".repeat(800_000),
      html: "h".repeat(800_000),
      rawHtml: "r".repeat(800_000),
      summary: "s".repeat(300_000),
      screenshot: "i".repeat(800_000),
      links: Array.from({ length: 50_000 }, (_, i) => `https://a.com/${i}`),
      json: { blob: "j".repeat(500_000) },
      changeTracking: { diff: { text: "d".repeat(900_000) } },
      metadata: { url: "https://a.com", junk: "x".repeat(900_000) },
      truncated: false,
    });
    expect(docBytes(clamped)).toBeLessThan(1_000_000);
    expect(clamped.truncated).toBe(true);
    // The identifying bits survive even when everything else is cut.
    expect(clamped.url).toBe("https://a.com");
    expect(clamped.metadata.url).toBe("https://a.com");
  });

  test("budgets in UTF-8 bytes, not characters", () => {
    const clamped = _test.clampContent({
      url: "https://a.com",
      // 3 bytes per character: a character budget would undercount by 3x.
      markdown: "字".repeat(700_000),
      html: "字".repeat(700_000),
      truncated: false,
    });
    expect(docBytes(clamped)).toBeLessThan(1_000_000);
    expect(clamped.truncated).toBe(true);
  });

  test("never splits a multi-byte character", () => {
    const cut = _test.truncateToBytes("字".repeat(100), 10);
    expect(cut).toBe("字".repeat(3)); // 9 bytes; a 4th would need 12
    expect(new TextEncoder().encode(cut).length).toBeLessThanOrEqual(10);
    expect(cut).not.toContain("\uFFFD");
  });

  test("a fat changeTracking diff alone cannot blow the limit", () => {
    const clamped = _test.toPageFields(
      {
        markdown: "# small page",
        metadata: { url: "https://a.com" },
        changeTracking: { diff: { text: "d".repeat(2_000_000) } },
      },
      true,
    )!;
    expect(docBytes(clamped)).toBeLessThan(1_000_000);
    expect(clamped.truncated).toBe(true);
    expect(clamped.markdown).toBe("# small page");
    // All-or-nothing: half a diff object would be worse than none.
    expect(clamped.changeTracking).toBeUndefined();
  });

  test("clamps metadata-only pages too", () => {
    const clamped = _test.toPageFields(
      { metadata: { url: "https://a.com", junk: "x".repeat(2_000_000) } },
      false,
    )!;
    expect(docBytes(clamped)).toBeLessThan(1_000_000);
    expect(clamped.truncated).toBe(true);
    expect(clamped.metadata.url).toBe("https://a.com");
  });

  test("truncates oversized text and drops oversized screenshots", () => {
    const clamped = _test.clampContent({
      url: "https://a.com",
      markdown: "m".repeat(600_000),
      screenshot: "s".repeat(600_000),
      truncated: false,
    });
    expect(clamped.truncated).toBe(true);
    expect(clamped.markdown!.length).toBeLessThan(600_000);
    expect(clamped.screenshot).toBeUndefined();
  });

  test("leaves content within limits untouched", () => {
    const clamped = _test.clampContent({
      url: "https://a.com",
      markdown: "short",
      truncated: false,
    });
    expect(clamped).toEqual({
      url: "https://a.com",
      markdown: "short",
      truncated: false,
    });
  });

  test("backs off faster in poll mode than behind webhooks", () => {
    expect(_test.nextDelayMs("poll", 0)).toBe(2_000);
    expect(_test.nextDelayMs("webhook", 0)).toBe(30_000);
    expect(_test.nextDelayMs("poll", 20)).toBe(30_000);
    expect(_test.nextDelayMs("webhook", 20)).toBe(300_000);
  });
});

describe("truncation efficiency", () => {
  test("keeps nearly the whole allowance despite JSON escaping", () => {
    // Newlines escape to two bytes each; a coarse backoff would throw away far
    // more content than the overflow requires.
    const value = "line\n".repeat(200_000);
    const clamped = _test.clampContent({
      url: "https://a.com",
      markdown: value,
      truncated: false,
    });
    // Newline-heavy text inflates ~20% as JSON, so the raw byte count is
    // necessarily below the budget. What matters is that we *use* the budget:
    // a coarse percentage backoff would land far short of it.
    const usedOfBudget = new TextEncoder().encode(
      JSON.stringify(clamped.markdown),
    ).length;
    expect(usedOfBudget).toBeGreaterThan(0.9 * 400_000);
    expect(usedOfBudget).toBeLessThanOrEqual(400_000);
    expect(
      new TextEncoder().encode(JSON.stringify(clamped)).length,
    ).toBeLessThan(1_000_000);
  });
});
