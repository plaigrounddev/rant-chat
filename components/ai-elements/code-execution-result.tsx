"use client";

/**
 * CodeExecutionResult — Renders code execution results from E2B sandbox.
 *
 * Displays stdout, stderr, generated charts (matplotlib images),
 * and file artifacts. Like Perplexity's data analysis UI — shows
 * interactive charts and code output inline.
 */

import { useState } from "react";

interface ExecutionArtifact {
    type: "image" | "file" | "data";
    mimeType: string;
    data: string; // base64
    filename?: string;
}

interface CodeExecutionResultProps {
    /** The code that was executed */
    code: string;
    /** Programming language */
    language: "python" | "javascript" | "bash";
    /** Standard output */
    stdout?: string;
    /** Standard error */
    stderr?: string;
    /** Error message */
    error?: string;
    /** Whether execution succeeded */
    success: boolean;
    /** Generated artifacts (charts, files) */
    artifacts?: ExecutionArtifact[];
    /** Execution duration */
    durationMs?: number;
}

export function CodeExecutionResult({
    code,
    language,
    stdout,
    stderr,
    error,
    success,
    artifacts = [],
    durationMs,
}: CodeExecutionResultProps) {
    const [showCode, setShowCode] = useState(false);

    const languageIcons: Record<string, string> = {
        python: "🐍",
        javascript: "⚡",
        bash: "💻",
    };

    return (
        <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-2">
                    <span className="text-sm">{languageIcons[language] ?? "📄"}</span>
                    <span className="text-xs font-medium text-white/70">
                        {language.charAt(0).toUpperCase() + language.slice(1)} Execution
                    </span>
                    <span
                        className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${success
                                ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
                                : "text-red-400 bg-red-500/10 border-red-500/20"
                            }`}
                    >
                        {success ? "SUCCESS" : "ERROR"}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    {durationMs !== undefined && (
                        <span className="text-[10px] text-white/30">
                            {durationMs < 1000
                                ? `${durationMs}ms`
                                : `${(durationMs / 1000).toFixed(1)}s`}
                        </span>
                    )}
                    <button
                        onClick={() => setShowCode(!showCode)}
                        className="text-xs text-white/50 hover:text-white/80 transition-colors"
                    >
                        {showCode ? "Hide code" : "Show code"}
                    </button>
                </div>
            </div>

            {/* Code (collapsible) */}
            {showCode && (
                <div className="border-b border-white/5">
                    <pre className="p-4 text-xs text-white/80 overflow-x-auto bg-black/30">
                        <code>{code}</code>
                    </pre>
                </div>
            )}

            {/* Charts / Images */}
            {artifacts.filter((a) => a.type === "image").length > 0 && (
                <div className="p-4 border-b border-white/5 space-y-3">
                    {artifacts
                        .filter((a) => a.type === "image")
                        .map((artifact, i) => (
                            <div key={i} className="rounded-lg overflow-hidden bg-white">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={`data:${artifact.mimeType};base64,${artifact.data}`}
                                    alt={artifact.filename ?? `Chart ${i + 1}`}
                                    className="w-full h-auto"
                                />
                            </div>
                        ))}
                </div>
            )}

            {/* Output */}
            <div className="p-4 space-y-2">
                {stdout && (
                    <div>
                        <span className="text-[10px] text-white/30 uppercase tracking-wider">
                            Output
                        </span>
                        <pre className="mt-1 text-xs text-white/80 whitespace-pre-wrap font-mono bg-black/30 rounded-lg p-3">
                            {stdout}
                        </pre>
                    </div>
                )}

                {stderr && (
                    <div>
                        <span className="text-[10px] text-yellow-400/50 uppercase tracking-wider">
                            Warnings
                        </span>
                        <pre className="mt-1 text-xs text-yellow-400/70 whitespace-pre-wrap font-mono bg-yellow-500/5 rounded-lg p-3">
                            {stderr}
                        </pre>
                    </div>
                )}

                {error && (
                    <div>
                        <span className="text-[10px] text-red-400/50 uppercase tracking-wider">
                            Error
                        </span>
                        <pre className="mt-1 text-xs text-red-400/80 whitespace-pre-wrap font-mono bg-red-500/5 rounded-lg p-3">
                            {error}
                        </pre>
                    </div>
                )}

                {/* File artifacts */}
                {artifacts.filter((a) => a.type === "file").length > 0 && (
                    <div>
                        <span className="text-[10px] text-white/30 uppercase tracking-wider">
                            Generated Files
                        </span>
                        <div className="mt-1 space-y-1">
                            {artifacts
                                .filter((a) => a.type === "file")
                                .map((artifact, i) => (
                                    <div
                                        key={i}
                                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 text-xs text-white/70"
                                    >
                                        <span>📄</span>
                                        <span>{artifact.filename ?? `file_${i + 1}`}</span>
                                        <span className="text-white/30 ml-auto">
                                            {artifact.mimeType}
                                        </span>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
