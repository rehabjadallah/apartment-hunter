/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the Firecrawl component with a `convexTest` instance, so app tests
 * can exercise code that calls it.
 *
 * ```ts
 * import firecrawl from "@firecrawl/firecrawl-convex/test";
 *
 * const t = convexTest(schema, modules);
 * firecrawl.register(t);
 * ```
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "firecrawl",
) {
  t.registerComponent(name, schema, modules);
}

export default { register, schema, modules };
