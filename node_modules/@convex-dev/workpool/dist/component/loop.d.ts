import type { WithoutSystemFields } from "convex/server";
import type { Doc } from "./_generated/dataModel.js";
export declare const RECOVERY_PERIOD_SEGMENTS: bigint;
export declare const INITIAL_STATE: WithoutSystemFields<Doc<"internalState">>;
export declare const main: import("convex/server").RegisteredMutation<"internal", {
    generation: bigint;
    segment: bigint;
}, Promise<void>>;
export declare const updateRunStatus: import("convex/server").RegisteredMutation<"internal", {
    generation: bigint;
    segment: bigint;
}, Promise<void>>;
export declare function withJitter(delay: number): number;
//# sourceMappingURL=loop.d.ts.map