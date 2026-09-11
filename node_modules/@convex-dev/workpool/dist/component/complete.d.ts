import { type Infer } from "convex/values";
import { type MutationCtx } from "./_generated/server.js";
export type CompleteJob = Infer<typeof completeArgs.fields.jobs.element>;
export declare const completeArgs: import("convex/values").VObject<{
    jobs: {
        workId: import("convex/values").GenericId<"work">;
        runResult: {
            kind: "success";
            returnValue: any;
        } | {
            kind: "failed";
            error: string;
        } | {
            kind: "canceled";
        };
        attempt: number;
    }[];
}, {
    jobs: import("convex/values").VArray<{
        workId: import("convex/values").GenericId<"work">;
        runResult: {
            kind: "success";
            returnValue: any;
        } | {
            kind: "failed";
            error: string;
        } | {
            kind: "canceled";
        };
        attempt: number;
    }[], import("convex/values").VObject<{
        workId: import("convex/values").GenericId<"work">;
        runResult: {
            kind: "success";
            returnValue: any;
        } | {
            kind: "failed";
            error: string;
        } | {
            kind: "canceled";
        };
        attempt: number;
    }, {
        runResult: import("convex/values").VUnion<{
            kind: "success";
            returnValue: any;
        } | {
            kind: "failed";
            error: string;
        } | {
            kind: "canceled";
        }, [import("convex/values").VObject<{
            kind: "success";
            returnValue: any;
        }, {
            kind: import("convex/values").VLiteral<"success", "required">;
            returnValue: import("convex/values").VAny<any, "required", string>;
        }, "required", "kind" | "returnValue" | `returnValue.${string}`>, import("convex/values").VObject<{
            kind: "failed";
            error: string;
        }, {
            kind: import("convex/values").VLiteral<"failed", "required">;
            error: import("convex/values").VString<string, "required">;
        }, "required", "kind" | "error">, import("convex/values").VObject<{
            kind: "canceled";
        }, {
            kind: import("convex/values").VLiteral<"canceled", "required">;
        }, "required", "kind">], "required", "kind" | "returnValue" | `returnValue.${string}` | "error">;
        workId: import("convex/values").VId<import("convex/values").GenericId<"work">, "required">;
        attempt: import("convex/values").VFloat64<number, "required">;
    }, "required", "workId" | "runResult" | "runResult.kind" | "runResult.returnValue" | `runResult.returnValue.${string}` | "runResult.error" | "attempt">, "required">;
}, "required", "jobs">;
export declare function completeHandler(ctx: MutationCtx, args: Infer<typeof completeArgs>): Promise<void>;
export declare const complete: import("convex/server").RegisteredMutation<"internal", {
    jobs: {
        workId: import("convex/values").GenericId<"work">;
        runResult: {
            kind: "success";
            returnValue: any;
        } | {
            kind: "failed";
            error: string;
        } | {
            kind: "canceled";
        };
        attempt: number;
    }[];
}, Promise<void>>;
//# sourceMappingURL=complete.d.ts.map