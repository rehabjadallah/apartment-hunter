import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalAction, internalMutation } from "./_generated/server.js";
import { createLogger, logLevel } from "./logging.js";
export const runMutationWrapper = internalMutation({
    args: {
        workId: v.id("work"),
        fnHandle: v.string(),
        fnArgs: v.any(),
        fnType: v.union(v.literal("query"), v.literal("mutation")),
        logLevel,
        attempt: v.number(),
    },
    handler: async (ctx, { workId, attempt, ...args }) => {
        const console = createLogger(args.logLevel);
        const fnHandle = args.fnHandle;
        try {
            const returnValue = await (args.fnType === "query"
                ? ctx.runQuery(fnHandle, args.fnArgs)
                : ctx.runMutation(fnHandle, args.fnArgs));
            // NOTE: we could run the `saveResult` handler here, or call `ctx.runMutation`,
            // but we want the mutation to be a separate transaction to reduce the window for OCCs.
            await ctx.scheduler.runAfter(0, internal.complete.complete, {
                jobs: [
                    { workId, runResult: { kind: "success", returnValue }, attempt },
                ],
            });
        }
        catch (e) {
            console.error(e);
            const runResult = { kind: "failed", error: formatError(e) };
            await ctx.scheduler.runAfter(0, internal.complete.complete, {
                jobs: [{ workId, runResult, attempt }],
            });
        }
    },
});
function formatError(e) {
    if (e instanceof Error) {
        return e.message;
    }
    return String(e);
}
export const runActionWrapper = internalAction({
    args: {
        workId: v.id("work"),
        fnHandle: v.string(),
        fnArgs: v.any(),
        logLevel,
        attempt: v.number(),
    },
    handler: async (ctx, { workId, attempt, ...args }) => {
        const console = createLogger(args.logLevel);
        const fnHandle = args.fnHandle;
        try {
            const returnValue = await ctx.runAction(fnHandle, args.fnArgs);
            // NOTE: we could run `ctx.runMutation`, but we want to guarantee execution,
            // and `ctx.scheduler.runAfter` won't OCC.
            const runResult = { kind: "success", returnValue };
            await ctx.scheduler.runAfter(0, internal.complete.complete, {
                jobs: [{ workId, runResult, attempt }],
            });
        }
        catch (e) {
            console.error(e);
            // We let the main loop handle the retries.
            const runResult = { kind: "failed", error: formatError(e) };
            await ctx.scheduler.runAfter(0, internal.complete.complete, {
                jobs: [{ workId, runResult, attempt }],
            });
        }
    },
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const console = "THIS IS A REMINDER TO USE createLogger";
//# sourceMappingURL=worker.js.map