"use client";

/**
 * BrowserLiveView — Embeds the Kernel browser live view stream.
 *
 * Displays a WebRTC or VNC stream of the cloud browser so the user
 * can watch the agent browse in real-time. Supports human-in-the-loop
 * workflows where the user can intervene (CAPTCHA, 2FA, etc.).
 */

import { useState } from "react";

interface BrowserLiveViewProps {
    /** Live view URL from Kernel browser instance */
    streamUrl: string;
    /** Browser session title */
    title?: string;
    /** Whether the view is read-only (no user interaction) */
    readOnly?: boolean;
    /** Called when the user closes the live view */
    onClose?: () => void;
    /** Current page URL displayed as a breadcrumb */
    currentUrl?: string;
}

export function BrowserLiveView({
    streamUrl,
    title = "Browser Live View",
    readOnly = false,
    onClose,
    currentUrl,
}: BrowserLiveViewProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="rounded-xl border border-white/10 bg-black/40 backdrop-blur-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-white/5">
                <div className="flex items-center gap-3">
                    {/* Browser dots */}
                    <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-500/80" />
                        <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                        <div className="w-3 h-3 rounded-full bg-green-500/80" />
                    </div>

                    <span className="text-xs font-medium text-white/70">{title}</span>

                    {!readOnly && (
                        <span className="px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 rounded border border-emerald-500/20">
                            INTERACTIVE
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-white/50 hover:text-white/80 transition-colors text-xs"
                    >
                        {isExpanded ? "Minimize" : "Expand"}
                    </button>

                    {onClose && (
                        <button
                            onClick={onClose}
                            className="text-white/50 hover:text-red-400 transition-colors"
                            aria-label="Close browser view"
                        >
                            ✕
                        </button>
                    )}
                </div>
            </div>

            {/* URL Bar */}
            {currentUrl && (
                <div className="px-4 py-1.5 border-b border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 text-xs text-white/50">
                        <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </svg>
                        <span className="truncate">{currentUrl}</span>
                    </div>
                </div>
            )}

            {/* Browser Stream */}
            <div
                className={`relative ${isExpanded ? "h-[600px]" : "h-[400px]"} transition-all duration-300`}
            >
                <iframe
                    src={streamUrl}
                    className="w-full h-full border-0"
                    title={title}
                    allow="camera; microphone; clipboard-write"
                    sandbox={readOnly ? "allow-scripts allow-same-origin" : "allow-scripts allow-same-origin allow-forms allow-popups"}
                />

                {/* Loading overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/80 pointer-events-none opacity-0 transition-opacity" id="browser-loading">
                    <div className="flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                        <span className="text-sm text-white/50">Connecting to browser...</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
