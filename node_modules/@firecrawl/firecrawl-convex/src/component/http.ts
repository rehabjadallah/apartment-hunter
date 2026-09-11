import { httpRouter } from "convex/server";
import { env, httpAction } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { TOKEN_HEADER } from "./crawl.js";
import { verifySignature } from "./signature.js";

const http = httpRouter();

/**
 * Firecrawl webhook sink for crawl progress. Mounted under the app's
 * `httpPrefix`, e.g. `app.use(firecrawl, { httpPrefix: "/firecrawl/" })` serves
 * it at `<site>/firecrawl/webhook`.
 *
 * Two independent checks guard it: the `X-Firecrawl-Signature` HMAC (when
 * FIRECRAWL_WEBHOOK_SECRET is set) and a per-crawl token we hand Firecrawl when
 * registering the webhook.
 */
http.route({
  path: "/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text();

    const secret = env.FIRECRAWL_WEBHOOK_SECRET;
    if (secret) {
      const valid = await verifySignature(
        secret,
        raw,
        request.headers.get("x-firecrawl-signature"),
      );
      if (!valid) {
        return new Response("invalid signature", { status: 401 });
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return new Response("invalid JSON", { status: 400 });
    }

    const result = await ctx.runMutation(internal.crawl.handleWebhook, {
      crawlId:
        typeof payload?.metadata?.crawlId === "string"
          ? payload.metadata.crawlId
          : undefined,
      jobId: typeof payload?.id === "string" ? payload.id : undefined,
      type: typeof payload?.type === "string" ? payload.type : undefined,
      success: payload?.success !== false,
      error: typeof payload?.error === "string" ? payload.error : undefined,
      token: request.headers.get(TOKEN_HEADER),
      documents: Array.isArray(payload?.data) ? payload.data : [],
    });

    if (!result.accepted) {
      return new Response(result.reason ?? "rejected", { status: 401 });
    }
    return new Response(null, { status: 200 });
  }),
});

export default http;
