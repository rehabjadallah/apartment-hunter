/// <reference types="vite/client" />
import { test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { RETRY } from "./api.js";

export const modules = import.meta.glob("./**/*.*s");

export const TEST_API_KEY = "fc-test-key";
export const TEST_SITE_URL = "https://example.convex.site/firecrawl";

export function initConvexTest() {
  process.env.FIRECRAWL_API_KEY = TEST_API_KEY;
  process.env.CONVEX_SITE_URL = TEST_SITE_URL;
  // Keep retries instant so tests don't wait on backoff.
  RETRY.baseDelayMs = 0;
  RETRY.maxDelayMs = 0;
  return convexTest(schema, modules);
}

/** Queue of canned responses, matched in order, for the mocked `fetch`. */
export type FetchCall = { url: string; method: string; body: any };

export function mockFetch(
  responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>,
) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(
    async (
      url: string | URL,
      init?: {
        method?: string;
        body?: string;
        headers?: Record<string, string>;
      },
    ) => {
      calls.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      const next = responses.shift() ?? { status: 200, body: { success: true } };
      return new Response(JSON.stringify(next.body), {
        status: next.status ?? 200,
        headers: next.headers,
      });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

test("setup", () => {});
