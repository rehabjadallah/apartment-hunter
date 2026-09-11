import { ConvexError } from "convex/values";
import { env } from "./_generated/server.js";

const DEFAULT_API_URL = "https://api.firecrawl.dev";

/**
 * Sent as `origin` on every request body so Firecrawl can attribute traffic to
 * this component. `origin` is free-form; `integration` is a closed server-side
 * enum, so it can only be used once "convex" is registered there.
 */
export const ORIGIN = "firecrawl-convex";

/**
 * Retry policy for transient Firecrawl failures. Exported as a mutable object
 * so tests can zero out the delays.
 */
export const RETRY = { attempts: 3, baseDelayMs: 500, maxDelayMs: 8_000 };

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function apiBase(): string {
  return (env.FIRECRAWL_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
}

function apiKey(): string {
  const key = env.FIRECRAWL_API_KEY;
  if (!key) {
    throw new ConvexError({
      code: "firecrawl_missing_api_key",
      message:
        "FIRECRAWL_API_KEY is not set for the Firecrawl component. Pass it in `app.use(firecrawl, { env: { FIRECRAWL_API_KEY: ... } })`.",
    });
  }
  return key;
}

function fail(path: string, status: number, message: string): never {
  throw new ConvexError({
    code: "firecrawl_request_failed",
    status,
    path,
    message: `Firecrawl ${path} failed (${status}): ${message}`,
  });
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, RETRY.maxDelayMs);
    }
  }
  return Math.min(RETRY.baseDelayMs * 2 ** attempt, RETRY.maxDelayMs);
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    for (const key of ["error", "message", "details"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return fallback;
}

export type RequestInitLike = {
  method?: "GET" | "POST" | "DELETE";
  /** JSON body. `origin` is added automatically. */
  body?: Record<string, unknown>;
  /** Full URL, used to follow the `next` cursor of a crawl status response. */
  absoluteUrl?: string;
};

/**
 * Call the Firecrawl API, retrying transient failures, and return the parsed
 * response envelope (`{ success, ... }`) so callers can pick the fields they
 * need.
 */
export async function firecrawlRequest(
  path: string,
  init: RequestInitLike = {},
): Promise<Record<string, any>> {
  const method = init.method ?? "POST";
  const url = init.absoluteUrl ?? `${apiBase()}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    Accept: "application/json",
  };
  let payload: string | undefined;
  if (init.body) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify({ origin: ORIGIN, ...init.body });
  }

  let lastError = "";
  for (let attempt = 0; attempt <= RETRY.attempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: payload });
    } catch (error) {
      // Network-level failure: worth another attempt.
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === RETRY.attempts) fail(path, 0, lastError);
      await sleep(retryDelayMs(attempt, null));
      continue;
    }

    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (response.ok && body && (body as Record<string, unknown>).success !== false) {
      return body as Record<string, any>;
    }

    const message = errorMessage(
      body,
      text.slice(0, 300) || response.statusText,
    );
    const retryable = RETRYABLE_STATUS.has(response.status);
    if (!retryable || attempt === RETRY.attempts) {
      fail(path, response.status, message);
    }
    lastError = message;
    await sleep(retryDelayMs(attempt, response.headers.get("retry-after")));
  }

  fail(path, 0, lastError || "exhausted retries");
}

export const _test = { retryDelayMs, errorMessage };
