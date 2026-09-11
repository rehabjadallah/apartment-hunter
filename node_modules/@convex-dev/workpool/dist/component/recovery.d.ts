import { type Infer } from "convex/values";
import { type MutationCtx } from "./_generated/server.js";
declare const recoveryArgs: import("convex/values").VObject<{
    jobs: {
        workId: import("convex/values").GenericId<"work">;
        scheduledId: import("convex/values").GenericId<"_scheduled_functions">;
        started: number;
        attempt: number;
    }[];
}, {
    jobs: import("convex/values").VArray<{
        workId: import("convex/values").GenericId<"work">;
        scheduledId: import("convex/values").GenericId<"_scheduled_functions">;
        started: number;
        attempt: number;
    }[], import("convex/values").VObject<{
        workId: import("convex/values").GenericId<"work">;
        scheduledId: import("convex/values").GenericId<"_scheduled_functions">;
        started: number;
        attempt: number;
    }, {
        scheduledId: import("convex/values").VId<import("convex/values").GenericId<"_scheduled_functions">, "required">;
        workId: import("convex/values").VId<import("convex/values").GenericId<"work">, "required">;
        attempt: import("convex/values").VFloat64<number, "required">;
        started: import("convex/values").VFloat64<number, "required">;
    }, "required", "workId" | "scheduledId" | "started" | "attempt">, "required">;
}, "required", "jobs">;
/**
 * This can run when things fail because of server failures / restarts, or when
 * the user cancels scheduled jobs (from the dashboard).
 * Possible states it could be in at the moment this executes:
 * - in internalState.running and complete was never called
 *   -> we should call completeHandler with failure.
 * - complete already called, no action needed (only possible for actions):
 *  - In pendingCompletion still and internalState.running.
 *    -> check for pendingCompletion.
 *  - pendingCompletion already processed.
 *   - No retry: work was deleted, not in internalState.running.
 *     -> check for work.
 *   - Retry: attempts will mismatch
 *     -> check work.attempts
 */
export declare const recover: import("convex/server").RegisteredMutation<"internal", {
    jobs: {
        workId: import("convex/values").GenericId<"work">;
        scheduledId: import("convex/values").GenericId<"_scheduled_functions">;
        started: number;
        attempt: number;
    }[];
}, Promise<void>>;
export declare function recoveryHandler(ctx: MutationCtx, { jobs }: Infer<typeof recoveryArgs>): Promise<void>;
export {};
//# sourceMappingURL=recovery.d.ts.map