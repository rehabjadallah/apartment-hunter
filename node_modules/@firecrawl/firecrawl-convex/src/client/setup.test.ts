/// <reference types="vite/client" />
import { test, vi } from "vitest";
import { convexTest } from "convex-test";
import {
  componentsGeneric,
  defineSchema,
  type GenericSchema,
  type SchemaDefinition,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component.js";
import { register } from "../test.js";

export const modules = import.meta.glob("./**/*.*s");

export function initConvexTest<
  Schema extends SchemaDefinition<GenericSchema, boolean>,
>(schema?: Schema) {
  process.env.FIRECRAWL_API_KEY = "fc-test-key";
  const t = convexTest(schema ?? defineSchema({}), modules);
  register(t);
  return t;
}

export const components = componentsGeneric() as unknown as {
  firecrawl: ComponentApi;
};

export function mockFetch(bodies: unknown[]) {
  const calls: Array<{ url: string; body: any }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: { body?: string }) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(init.body) : undefined,
      });
      return new Response(JSON.stringify(bodies.shift() ?? { success: true }), {
        status: 200,
      });
    }),
  );
  return calls;
}

test("setup", () => {});
