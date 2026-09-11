import { describe, expect, test } from "vitest";
import { sign, timingSafeEqual, verifySignature } from "./signature.js";

describe("webhook signatures", () => {
  test("signs in Firecrawl's sha256=<hex> shape", async () => {
    const signature = await sign("whsec", '{"type":"crawl.page"}');
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  test("accepts a signature it produced", async () => {
    const body = '{"type":"crawl.completed"}';
    const signature = await sign("whsec", body);
    expect(await verifySignature("whsec", body, signature)).toBe(true);
  });

  test("rejects a tampered body, wrong secret, or missing header", async () => {
    const body = '{"type":"crawl.completed"}';
    const signature = await sign("whsec", body);
    expect(await verifySignature("whsec", `${body} `, signature)).toBe(false);
    expect(await verifySignature("other", body, signature)).toBe(false);
    expect(await verifySignature("whsec", body, null)).toBe(false);
    expect(await verifySignature("whsec", body, "md5=abc")).toBe(false);
  });

  test("compares equal-length strings without short-circuiting", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});
