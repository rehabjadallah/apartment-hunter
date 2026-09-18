import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/static-hosting";
import { components } from "./_generated/api";

const http = httpRouter();

// Auth routes are mounted separately at /auth in convex.config.ts.
registerStaticRoutes(http, components.staticHosting);

export default http;
