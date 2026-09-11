const encoder = new TextEncoder();

/** Constant-time string compare, so a mismatch leaks nothing through timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `sha256=${toHex(signature)}`;
}

/**
 * Verify a Firecrawl `X-Firecrawl-Signature` header, which is
 * `sha256=<hex hmac of the raw body using your webhook secret>`.
 * See https://docs.firecrawl.dev/webhooks/security.
 */
export async function verifySignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const expected = await sign(secret, body);
  return timingSafeEqual(expected.toLowerCase(), header.trim().toLowerCase());
}
