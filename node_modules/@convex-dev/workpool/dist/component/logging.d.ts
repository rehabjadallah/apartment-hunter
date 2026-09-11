import { type Infer } from "convex/values";
export declare const DEFAULT_LOG_LEVEL: LogLevel;
export declare const logLevel: import("convex/values").VUnion<"DEBUG" | "TRACE" | "INFO" | "REPORT" | "WARN" | "ERROR", [import("convex/values").VLiteral<"DEBUG", "required">, import("convex/values").VLiteral<"TRACE", "required">, import("convex/values").VLiteral<"INFO", "required">, import("convex/values").VLiteral<"REPORT", "required">, import("convex/values").VLiteral<"WARN", "required">, import("convex/values").VLiteral<"ERROR", "required">], "required", never>;
export type LogLevel = Infer<typeof logLevel>;
export type Logger = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    time: (label: string) => void;
    timeEnd: (label: string) => void;
    event: (event: string, payload: Record<string, unknown>) => void;
};
export declare function shouldLog(config: LogLevel, level: LogLevel): boolean;
export declare function createLogger(level?: LogLevel): Logger;
//# sourceMappingURL=logging.d.ts.map