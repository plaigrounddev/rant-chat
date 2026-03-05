/**
 * Code Runner Executor
 *
 * Mirrors Lindy AI's "Run Code" skill.
 * Executes JavaScript in a sandboxed VM context.
 */

import { createContext, runInContext } from "vm";

const EXECUTION_TIMEOUT = 5000; // 5 seconds max

export async function runCode(code: string): Promise<string> {
    if (!code || !code.trim()) {
        return JSON.stringify({ error: "No code provided" });
    }

    try {
        // Capture console.log output
        const logs: string[] = [];
        const mockConsole = {
            log: (...args: unknown[]) => {
                logs.push(args.map((a) => formatValue(a)).join(" "));
            },
            warn: (...args: unknown[]) => {
                logs.push(`[warn] ${args.map((a) => formatValue(a)).join(" ")}`);
            },
            error: (...args: unknown[]) => {
                logs.push(`[error] ${args.map((a) => formatValue(a)).join(" ")}`);
            },
            info: (...args: unknown[]) => {
                logs.push(`[info] ${args.map((a) => formatValue(a)).join(" ")}`);
            },
        };

        // Create a sandboxed context with limited globals
        const sandbox = {
            console: mockConsole,
            JSON,
            Math,
            Date,
            parseInt,
            parseFloat,
            isNaN,
            isFinite,
            String,
            Number,
            Boolean,
            Array,
            Object,
            Map,
            Set,
            RegExp,
            Error,
            Promise,
            setTimeout: undefined,  // blocked
            setInterval: undefined, // blocked
            fetch: undefined,       // blocked
            require: undefined,     // blocked
            process: undefined,     // blocked
            __dirname: undefined,   // blocked
            __filename: undefined,  // blocked
        };

        const context = createContext(sandbox);

        const result = runInContext(code, context, {
            timeout: EXECUTION_TIMEOUT,
            displayErrors: true,
        });

        const formattedResult = formatValue(result);

        return JSON.stringify({
            result: formattedResult,
            logs: logs.length > 0 ? logs : undefined,
            success: true,
        });
    } catch (err) {
        const error = err as Error;
        let message = error.message || "Code execution failed";

        if (message.includes("Script execution timed out")) {
            message = "Code execution timed out (5 second limit)";
        }

        return JSON.stringify({
            error: message,
            success: false,
        });
    }
}

function formatValue(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}
