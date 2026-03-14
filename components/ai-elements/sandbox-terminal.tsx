"use client";

/**
 * SandboxTerminal — Displays terminal output from sandbox command execution.
 *
 * Shows a terminal-like interface with command input/output, mimicking
 * how Manus displays its shell operations to users.
 */

interface TerminalEntry {
    type: "command" | "stdout" | "stderr" | "info";
    content: string;
    timestamp?: string;
}

interface SandboxTerminalProps {
    /** List of terminal entries to display */
    entries: TerminalEntry[];
    /** Terminal title */
    title?: string;
    /** Whether the terminal is actively running */
    isRunning?: boolean;
}

export function SandboxTerminal({
    entries,
    title = "Sandbox Terminal",
    isRunning = false,
}: SandboxTerminalProps) {
    return (
        <div className="rounded-xl border border-white/10 bg-black/60 backdrop-blur-sm overflow-hidden font-mono text-sm">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                        <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                    </div>
                    <span className="text-xs text-white/50">{title}</span>
                </div>

                {isRunning && (
                    <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                        <span className="text-[10px] text-green-400/70">running</span>
                    </div>
                )}
            </div>

            {/* Terminal body */}
            <div
                className="p-4 max-h-[400px] overflow-y-auto space-y-1"
                role="log"
                aria-live="polite"
                aria-label="Terminal output"
            >
                {entries.map((entry, i) => (
                    <TerminalLine key={i} entry={entry} />
                ))}

                {isRunning && (
                    <div className="flex items-center gap-1 text-green-400/60">
                        <span>$</span>
                        <span className="w-2 h-4 bg-green-400/60 animate-pulse" />
                    </div>
                )}
            </div>
        </div>
    );
}

function TerminalLine({ entry }: { entry: TerminalEntry }) {
    switch (entry.type) {
        case "command":
            return (
                <div className="flex items-start gap-2">
                    <span className="text-green-400/80 flex-shrink-0">$</span>
                    <span className="text-white/90">{entry.content}</span>
                </div>
            );
        case "stdout":
            return (
                <div className="text-white/70 whitespace-pre-wrap pl-4">
                    {entry.content}
                </div>
            );
        case "stderr":
            return (
                <div className="text-red-400/80 whitespace-pre-wrap pl-4">
                    {entry.content}
                </div>
            );
        case "info":
            return (
                <div className="text-blue-400/60 text-xs pl-4 italic">
                    {entry.content}
                </div>
            );
        default:
            return null;
    }
}
