/**
 * CodeExecutor — Execute code inside E2B sandboxes.
 *
 * Supports Python, JavaScript, and Bash execution with stateful sessions.
 * Like Perplexity's code interpreter: stateful execution where variables
 * persist across calls, matplotlib chart capture, and file artifact extraction.
 *
 * Like Lindy's Code Action: input variables passed in, output variables extracted.
 */

import type { Sandbox } from "@e2b/code-interpreter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedLanguage = "python" | "javascript" | "bash";

export interface CodeExecutionOptions {
    /** Language to execute (default: python) */
    language?: SupportedLanguage;
    /** Optional input variables to inject into the code environment */
    variables?: Record<string, unknown>;
    /** Execution timeout in milliseconds (default: 30 seconds) */
    timeoutMs?: number;
}

export interface CodeExecutionResult {
    /** Whether execution succeeded */
    success: boolean;
    /** Standard output */
    stdout: string;
    /** Standard error */
    stderr: string;
    /** Execution error message, if any */
    error?: string;
    /** Generated artifacts (charts, files, etc.) as base64 data */
    artifacts: ExecutionArtifact[];
    /** Execution duration in milliseconds */
    durationMs: number;
}

export interface ExecutionArtifact {
    /** Artifact type: image (matplotlib), file, data */
    type: "image" | "file" | "data";
    /** MIME type */
    mimeType: string;
    /** Base64-encoded data */
    data: string;
    /** Original filename, if applicable */
    filename?: string;
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class CodeExecutor {
    constructor(private sandbox: Sandbox) { }

    /**
     * Execute code in the sandbox.
     *
     * @param code - The source code to execute
     * @param options - Execution options (language, variables, timeout)
     * @returns Execution result with stdout, stderr, and artifacts
     */
    async executeCode(
        code: string,
        options: CodeExecutionOptions = {}
    ): Promise<CodeExecutionResult> {
        const {
            language = "python",
            variables,
            timeoutMs = 30000,
        } = options;

        const startTime = Date.now();
        const artifacts: ExecutionArtifact[] = [];

        try {
            // Inject variables if provided (Lindy-style input variables)
            let wrappedCode = code;
            if (variables && Object.keys(variables).length > 0) {
                wrappedCode = this.injectVariables(code, language, variables);
            }

            // Execute based on language
            let stdout = "";
            let stderr = "";

            if (language === "bash") {
                // Use shell command execution for bash
                const result = await this.sandbox.commands.run(wrappedCode, {
                    timeoutMs,
                });
                stdout = result.stdout;
                stderr = result.stderr;
            } else {
                // Use code interpreter for Python/JavaScript
                const result = await this.sandbox.runCode(wrappedCode, {
                    language: language === "javascript" ? "js" : "python",
                    timeoutMs,
                });

                // Collect stdout/stderr from execution logs
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const logs = result.logs as any;
                stdout = (logs?.stdout ?? []).join("\n");
                stderr = (logs?.stderr ?? []).join("\n");

                // Check for errors
                if (result.error) {
                    return {
                        success: false,
                        stdout,
                        stderr,
                        error: `${result.error.name}: ${result.error.value}\n${result.error.traceback}`,
                        artifacts: [],
                        durationMs: Date.now() - startTime,
                    };
                }

                // Extract artifacts (charts, images from matplotlib, etc.)
                if (result.results && result.results.length > 0) {
                    for (const res of result.results) {
                        // Check for PNG images (matplotlib charts)
                        if (res.png) {
                            artifacts.push({
                                type: "image",
                                mimeType: "image/png",
                                data: res.png,
                                filename: `chart_${artifacts.length + 1}.png`,
                            });
                        }
                        // Check for SVG
                        if (res.svg) {
                            artifacts.push({
                                type: "image",
                                mimeType: "image/svg+xml",
                                data: Buffer.from(res.svg).toString("base64"),
                                filename: `chart_${artifacts.length + 1}.svg`,
                            });
                        }
                        // Check for HTML output
                        if (res.html) {
                            artifacts.push({
                                type: "data",
                                mimeType: "text/html",
                                data: Buffer.from(res.html).toString("base64"),
                            });
                        }
                        // Check for text output
                        if (res.text) {
                            stdout += (stdout ? "\n" : "") + res.text;
                        }
                    }
                }
            }

            return {
                success: true,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                artifacts,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            return {
                success: false,
                stdout: "",
                stderr: "",
                error: error instanceof Error ? error.message : String(error),
                artifacts: [],
                durationMs: Date.now() - startTime,
            };
        }
    }

    /**
     * Execute a quick one-liner command.
     */
    async quickExec(command: string): Promise<string> {
        const result = await this.sandbox.commands.run(command, { timeoutMs: 15000 });
        if (result.exitCode !== 0) {
            throw new Error(`Command failed (exit ${result.exitCode}): ${result.stderr}`);
        }
        return result.stdout.trim();
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Inject variables into code (Lindy-style input variables).
     * Wraps the user code with variable assignments.
     */
    private injectVariables(
        code: string,
        language: SupportedLanguage,
        variables: Record<string, unknown>
    ): string {
        const assignments: string[] = [];

        for (const [key, value] of Object.entries(variables)) {
            const serialized = JSON.stringify(value);

            switch (language) {
                case "python":
                    assignments.push(`${key} = ${serialized}`);
                    break;
                case "javascript":
                    assignments.push(`const ${key} = ${serialized};`);
                    break;
                case "bash":
                    // For bash, export as environment variables
                    // Use single quotes and escape embedded single quotes to prevent injection
                    const escaped = typeof value === "string"
                        ? value.replace(/'/g, "'\\''")
                        : JSON.stringify(value).replace(/'/g, "'\\''");
                    assignments.push(
                        `export ${key}='${escaped}'`
                    );
                    break;
            }
        }

        return `${assignments.join("\n")}\n\n${code}`;
    }
}
