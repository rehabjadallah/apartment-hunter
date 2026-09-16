import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import agentmail from "@agentmail/convex/test";
import schema from "../convex/schema";
import { components, internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("AgentMail inbox creation and thread reads work across the component boundary", async () => {
  const t = convexTest(schema, modules);
  // Exercise the published runtime, including its generated JS modules.
  t.registerComponent("agentmail", agentmail.schema, import.meta.glob("../node_modules/@agentmail/convex/dist/component/**/*.js"));
  vi.stubEnv("AGENTMAIL_API_KEY", "test-key");
  const inbox = { inbox_id: "test@agentmail.to", email: "test@agentmail.to", created_at: "2026-09-15T00:00:00Z", updated_at: "2026-09-15T00:00:00Z" };
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ inboxes: [] }), { headers: { "Content-Type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify(inbox), { headers: { "Content-Type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [] }), { headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  expect(await t.action(internal.services.listInboxes, {})).toEqual({ inboxes: [] });
  expect(await t.action(components.agentmail.lib.createInbox, { request: { client_id: "test-user" } })).toEqual(inbox);
  expect(await t.query(components.agentmail.lib.listCachedInboxes, {})).toMatchObject([{ inboxId: inbox.inbox_id }]);
  expect(await t.action(components.agentmail.lib.getThread, { inboxId: inbox.inbox_id, threadId: "test-thread" })).toEqual({ messages: [] });
  expect(fetch).toHaveBeenCalledTimes(3);
});
