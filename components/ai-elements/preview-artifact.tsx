"use client";

/**
 * PreviewArtifact — Unified preview component for agent-generated content.
 *
 * Two display modes:
 * 1. BrowserPreviewCard  — Compact 1:1 rounded rectangle shown inline in chat
 *    when the agent is using the Kernel browser (live view stream).
 * 2. CodePreviewPanel    — v0-style right-side artifact panel with iframe for
 *    code/HTML/app previews generated via sandbox.
 */

import { cn } from "@/lib/utils";
import {
    XIcon,
    MaximizeIcon,
    MinimizeIcon,
    ExternalLinkIcon,
    CodeIcon,
    EyeIcon,
    CopyIcon,
    CheckIcon,
} from "lucide-react";
import { useState, useCallback, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export type PreviewType = "browser" | "code";

export interface PreviewArtifactData {
    id: string;
    type: PreviewType;
    url: string;
    title?: string;
    currentUrl?: string;
    status: "connecting" | "active" | "complete" | "error";
    progress?: number; // 0-100
    code?: string;
    language?: string;
}

// ── Browser Preview Card (inline in chat) ──────────────────────────────────

interface BrowserPreviewCardProps {
    preview: PreviewArtifactData;
    onDismiss?: () => void;
    onExpand?: () => void;
}

export function BrowserPreviewCard({
    preview,
    onDismiss,
    onExpand,
}: BrowserPreviewCardProps) {
    const [isHovered, setIsHovered] = useState(false);

    const statusLabels: Record<string, string> = {
        connecting: "Connecting to browser...",
        active: "Agent is browsing",
        complete: "Browsing complete",
        error: "Connection lost",
    };

    const statusColors: Record<string, string> = {
        connecting: "bg-amber-500",
        active: "bg-emerald-500",
        complete: "bg-blue-500",
        error: "bg-destructive",
    };

    return (
        <div
            className="group/preview relative w-[280px] overflow-hidden rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-lg transition-all duration-300 hover:shadow-xl hover:border-border"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Browser stream / iframe */}
            <div className="relative aspect-square w-full overflow-hidden bg-muted/30">
                {preview.url ? (
                    <iframe
                        src={preview.url}
                        className="size-full border-0 pointer-events-none"
                        title="Browser Live View"
                        sandbox="allow-scripts allow-same-origin"
                    />
                ) : (
                    <div className="flex size-full items-center justify-center">
                        <div className="flex flex-col items-center gap-3">
                            <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                            <span className="text-xs text-muted-foreground">
                                {statusLabels[preview.status]}
                            </span>
                        </div>
                    </div>
                )}

                {/* Overlay controls (on hover) */}
                <div
                    className={cn(
                        "absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity duration-200",
                        isHovered ? "opacity-100" : "opacity-0"
                    )}
                >
                    {/* Top-right actions */}
                    <div className="absolute right-2 top-2 flex gap-1">
                        {onExpand && (
                            <button
                                onClick={onExpand}
                                className="flex size-7 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
                                aria-label="Expand"
                            >
                                <MaximizeIcon className="size-3.5" />
                            </button>
                        )}
                        {onDismiss && (
                            <button
                                onClick={onDismiss}
                                className="flex size-7 items-center justify-center rounded-lg bg-black/40 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
                                aria-label="Close"
                            >
                                <XIcon className="size-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2.5 px-3 py-2.5">
                {/* Status dot */}
                <div className="relative flex-shrink-0">
                    <div
                        className={cn(
                            "size-2 rounded-full",
                            statusColors[preview.status]
                        )}
                    />
                    {(preview.status === "connecting" || preview.status === "active") && (
                        <div
                            className={cn(
                                "absolute inset-0 size-2 rounded-full animate-ping",
                                statusColors[preview.status],
                                "opacity-75"
                            )}
                        />
                    )}
                </div>

                <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                        {preview.title || statusLabels[preview.status]}
                    </p>
                    {preview.currentUrl && (
                        <p className="truncate text-[10px] text-muted-foreground">
                            {preview.currentUrl}
                        </p>
                    )}
                </div>
            </div>

            {/* Progress bar */}
            {(preview.status === "connecting" || preview.status === "active") && (
                <div className="h-0.5 w-full bg-muted/50">
                    {preview.progress != null && preview.progress > 0 ? (
                        <div
                            className="h-full bg-primary transition-all duration-500 ease-out"
                            style={{ width: `${preview.progress}%` }}
                        />
                    ) : (
                        <div className="h-full w-full overflow-hidden">
                            <div className="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] bg-primary/60 rounded-full" />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Code Preview Panel (v0-style right artifact) ───────────────────────────

interface CodePreviewPanelProps {
    preview: PreviewArtifactData;
    onClose?: () => void;
}

export function CodePreviewPanel({
    preview,
    onClose,
}: CodePreviewPanelProps) {
    const [activeTab, setActiveTab] = useState<"preview" | "code">("preview");
    const [copied, setCopied] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const handleCopy = useCallback(async () => {
        if (preview.code) {
            await navigator.clipboard.writeText(preview.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    }, [preview.code]);

    const handleOpenExternal = useCallback(() => {
        if (preview.url) {
            window.open(preview.url, "_blank", "noopener,noreferrer");
        }
    }, [preview.url]);

    // Write code directly into iframe for sandbox-less preview
    useEffect(() => {
        if (activeTab === "preview" && preview.code && iframeRef.current) {
            const doc = iframeRef.current.contentDocument;
            if (doc) {
                doc.open();
                doc.write(preview.code);
                doc.close();
            }
        }
    }, [activeTab, preview.code]);

    return (
        <div
            className={cn(
                "flex flex-col overflow-hidden border-l border-border bg-background transition-all duration-300",
                isExpanded ? "fixed inset-0 z-50" : "h-full"
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                <div className="flex items-center gap-3 min-w-0">
                    {/* Tab switcher */}
                    <div className="flex rounded-lg bg-muted/50 p-0.5">
                        <button
                            onClick={() => setActiveTab("preview")}
                            className={cn(
                                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                activeTab === "preview"
                                    ? "bg-background text-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <EyeIcon className="size-3.5" />
                            Preview
                        </button>
                        {preview.code && (
                            <button
                                onClick={() => setActiveTab("code")}
                                className={cn(
                                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                    activeTab === "code"
                                        ? "bg-background text-foreground shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                <CodeIcon className="size-3.5" />
                                Code
                            </button>
                        )}
                    </div>

                    <span className="truncate text-xs text-muted-foreground">
                        {preview.title || "Preview"}
                    </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1">
                    {preview.code && (
                        <button
                            onClick={handleCopy}
                            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label="Copy code"
                        >
                            {copied ? (
                                <CheckIcon className="size-4 text-emerald-500" />
                            ) : (
                                <CopyIcon className="size-4" />
                            )}
                        </button>
                    )}
                    {preview.url && (
                        <button
                            onClick={handleOpenExternal}
                            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label="Open in new tab"
                        >
                            <ExternalLinkIcon className="size-4" />
                        </button>
                    )}
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label={isExpanded ? "Minimize" : "Maximize"}
                    >
                        {isExpanded ? (
                            <MinimizeIcon className="size-4" />
                        ) : (
                            <MaximizeIcon className="size-4" />
                        )}
                    </button>
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            aria-label="Close"
                        >
                            <XIcon className="size-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-hidden">
                {activeTab === "preview" ? (
                    <div className="size-full bg-white">
                        {preview.url ? (
                            <iframe
                                ref={iframeRef}
                                src={preview.url}
                                className="size-full border-0"
                                title="Code Preview"
                                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                            />
                        ) : preview.code ? (
                            <iframe
                                ref={iframeRef}
                                className="size-full border-0"
                                title="Code Preview"
                                sandbox="allow-scripts"
                            />
                        ) : (
                            <div className="flex size-full items-center justify-center bg-background">
                                <div className="flex flex-col items-center gap-3">
                                    <div className="size-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                                    <span className="text-sm text-muted-foreground">
                                        Generating preview...
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="size-full overflow-auto bg-muted/20">
                        <pre className="p-4 text-sm font-mono text-foreground whitespace-pre-wrap">
                            <code>{preview.code || "No code available"}</code>
                        </pre>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Shimmer keyframe (for indeterminate progress) ──────────────────────────
// Injected via a style tag for the shimmer animation used in BrowserPreviewCard

const shimmerStyleId = "preview-artifact-shimmer";

if (typeof document !== "undefined" && !document.getElementById(shimmerStyleId)) {
    const style = document.createElement("style");
    style.id = shimmerStyleId;
    style.textContent = `
        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(400%); }
        }
    `;
    document.head.appendChild(style);
}
