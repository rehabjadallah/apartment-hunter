import { defineComponent } from "convex/server";
import { v } from "convex/values";

export default defineComponent("firecrawl", {
  env: {
    /** Firecrawl API key, e.g. `fc-...`. Get one at https://firecrawl.dev. */
    FIRECRAWL_API_KEY: v.string(),
    /** Override the API base URL. Defaults to https://api.firecrawl.dev. */
    FIRECRAWL_API_URL: v.optional(v.string()),
    /**
     * Webhook signing secret from the Firecrawl dashboard (Advanced tab).
     * Optional, but strongly recommended when running crawls in webhook mode:
     * when set, every delivery must carry a valid `X-Firecrawl-Signature`.
     */
    FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
  },
});
