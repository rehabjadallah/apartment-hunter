import { defineApp } from "convex/server";
import { v } from "convex/values";
import agentmail from "@agentmail/convex/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import auth from "@convex-dev/auth/core/convex.config.js";
import password from "@convex-dev/auth/providers/password/convex.config.js";
import username from "@convex-dev/auth/username/convex.config.js";

const app = defineApp({
  env: { AGENTMAIL_API_KEY: v.string(), FIRECRAWL_API_KEY: v.string(), AUTH_PRIVATE_KEY: v.string(), AUTH_JWKS: v.string() },
});
app.use(auth, { httpPrefix: "/auth", env: {
  AUTH_PRIVATE_KEY: app.env.AUTH_PRIVATE_KEY, AUTH_JWKS: app.env.AUTH_JWKS,
} });
app.use(password);
app.use(username);
app.use(agentmail, { env: { AGENTMAIL_API_KEY: app.env.AGENTMAIL_API_KEY } });
app.use(firecrawl, {
  env: { FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY },
});
export default app;
