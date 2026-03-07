"use client";

import {
    Conversation,
    ConversationContent,
    ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
    Message,
    MessageBranch,
    MessageBranchContent,
    MessageContent,
    MessageResponse,
} from "@/components/ai-elements/message";
import {
    Reasoning,
    ReasoningContent,
    ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { PromptBox } from "@/components/ui/chatgpt-prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { useAgentChat, type AgentStatus } from "@/hooks/useAgentChat";
import {
    GlobeIcon,
    WrenchIcon,
    CheckCircleIcon,
    Loader2Icon,
    AlertCircleIcon,
    ZapIcon,
    BrainIcon,
    CodeIcon,
    SendIcon,
    SearchIcon,
    LinkIcon,
    MemoryStickIcon,
    PlugIcon,
    BoxIcon,
    TerminalIcon,
    ExternalLinkIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

// ── Suggestions ────────────────────────────────────────────────────────────

const suggestions = [
    "Research everything about Anthropic — founding date, team size, and products",
    "Scrape https://news.ycombinator.com and give me today's top stories",
    "Remember that I prefer concise responses with bullet points",
    "Run this code: Array.from({length: 10}, (_, i) => i * i)",
    "What can you do? Show me all your capabilities",
    "Search the web for the latest AI news this week",
];

// ── Skill Badges ───────────────────────────────────────────────────────────

const skillBadges = [
    { name: "Web Search", icon: GlobeIcon, color: "text-blue-500" },
    { name: "Web Scraper", icon: LinkIcon, color: "text-emerald-500" },
    { name: "HTTP Requests", icon: SendIcon, color: "text-amber-500" },
    { name: "Code Runner", icon: CodeIcon, color: "text-purple-500" },
    { name: "Memory", icon: BrainIcon, color: "text-rose-500" },
    { name: "1000+ Apps", icon: PlugIcon, color: "text-indigo-500" },
];

// ── Status indicator ───────────────────────────────────────────────────────

function StatusIndicator({ status }: { status: AgentStatus }) {
    if (status === "ready" || status === "error") return null;

    const labels: Record<string, string> = {
        connecting: "Connecting...",
        thinking: "Thinking...",
        streaming: "Responding...",
        executing_tools: "Running skills...",
    };

    return (
        <div className="flex items-center gap-2 px-4 py-2" role="status" aria-live="polite" aria-atomic="true">
            <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground animate-pulse">
                {labels[status] || "Processing..."}
            </span>
        </div>
    );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

// safePreview removed — we no longer show ugly JSON previews in the tool header

/**
 * Extract a Composio connect link from a tool result string.
 * Per docs.composio.dev/docs/authentication — in-chat auth returns:
 *   https://connect.composio.dev/link/ln_*
 */
function extractConnectLink(result: string | undefined): {
    url: string;
    toolkit: string;
} | null {
    if (!result) return null;
    // Match connect.composio.dev URLs
    const match = result.match(/(https:\/\/connect\.composio\.dev\/[^\s"']+)/i);
    if (!match) return null;
    const url = match[1];

    // Try to extract the toolkit name from the context
    // Composio results often mention the toolkit, e.g. "github", "gmail"
    const toolkitPatterns = [
        /toolkit["':]*\s*["']?([a-z_]+)/i,
        /app["':]*\s*["']?([a-z_]+)/i,
        /connect.*?([a-z]+)\s*account/i,
        /authorize.*?([a-z]+)/i,
    ];
    let toolkit = "";
    for (const pat of toolkitPatterns) {
        const m = result.match(pat);
        if (m) { toolkit = m[1].toLowerCase(); break; }
    }
    return { url, toolkit };
}

/**
 * Composio toolkit logo URL.
 * Logos come from session.toolkits() → meta.logo via the Composio SDK.
 * Passed down from the useAgentChat hook as toolkitLogos map.
 */

// ── Connect Button ─────────────────────────────────────────────────────────

/**
 * Opens the Composio auth link in a centered popup window.
 * Per docs.composio.dev/docs/authenticating-users/in-chat-authentication,
 * connect links are OAuth flows that require a redirect. A popup
 * provides better UX than a full tab switch.
 */
function openConnectPopup(url: string) {
    const w = 500;
    const h = 700;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
        url,
        "composio_connect",
        `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes,resizable=yes,noopener,noreferrer`
    );
    if (popup) popup.opener = null;
}

function ConnectButton({ url, toolkit, logoUrl }: { url: string; toolkit: string; logoUrl?: string }) {
    const displayName = toolkit
        ? toolkit.charAt(0).toUpperCase() + toolkit.slice(1).replace(/_/g, " ")
        : "App";

    return (
        <button
            type="button"
            onClick={() => openConnectPopup(url)}
            className="inline-flex items-center gap-2.5 rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium text-foreground shadow-sm hover:bg-muted/60 hover:shadow-md transition-all cursor-pointer"
        >
            {logoUrl ? (
                <img
                    src={logoUrl}
                    alt={`${displayName} logo`}
                    className="size-5 rounded-sm object-contain"
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                    }}
                />
            ) : (
                <PlugIcon className="size-4 text-muted-foreground" />
            )}
            <span>Connect {displayName}</span>
            <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
        </button>
    );
}

/**
 * Scan tool results for Composio connect links.
 * Returns the first connect link found, or null.
 */
function findConnectLink(
    tools: { name: string; result?: string }[] | undefined
): { url: string; toolkit: string } | null {
    if (!tools) return null;
    for (const tool of tools) {
        const link = extractConnectLink(tool.result);
        if (link) return link;
    }
    return null;
}

/**
 * Strip Composio connect URLs from message content to avoid
 * duplicating the branded Connect button the UI already renders.
 */
function stripConnectUrls(content: string): string {
    // Remove markdown links to connect.composio.dev
    let cleaned = content.replace(/\[([^\]]*?)\]\(https:\/\/connect\.composio\.dev\/[^)]+\)/gi, "");
    // Remove bare URLs
    cleaned = cleaned.replace(/https:\/\/connect\.composio\.dev\/\S+/gi, "");
    return cleaned.trim();
}

// ── Tool call display ──────────────────────────────────────────────────────

function ToolCallCard({
    name,
    type,
    args,
    result,
    status,
    toolkitLogos,
}: {
    name: string;
    type: "function_call" | "web_search_call";
    args: string;
    result?: string;
    status: string;
    toolkitLogos: Record<string, string>;
}) {
    const toolIcons: Record<string, React.ReactNode> = {
        web_search: <GlobeIcon className="size-4" />,
        scrape_website: <LinkIcon className="size-4" />,
        http_request: <SendIcon className="size-4" />,
        run_code: <CodeIcon className="size-4" />,
        read_memories: <MemoryStickIcon className="size-4" />,
        create_memory: <BrainIcon className="size-4" />,
        update_memory: <BrainIcon className="size-4" />,
        delete_memory: <BrainIcon className="size-4" />,
        discover_integration: <SearchIcon className="size-4" />,
        // Composio meta tools
        COMPOSIO_SEARCH_TOOLS: <SearchIcon className="size-4" />,
        COMPOSIO_MANAGE_CONNECTIONS: <PlugIcon className="size-4" />,
        COMPOSIO_MULTI_EXECUTE_TOOL: <ZapIcon className="size-4" />,
        COMPOSIO_REMOTE_WORKBENCH: <BoxIcon className="size-4" />,
        COMPOSIO_REMOTE_BASH_TOOL: <TerminalIcon className="size-4" />,
    };

    const toolLabels: Record<string, string> = {
        web_search: "Web Search",
        scrape_website: "Scraping Website",
        http_request: "HTTP Request",
        run_code: "Running Code",
        read_memories: "Reading Memories",
        create_memory: "Storing Memory",
        update_memory: "Updating Memory",
        delete_memory: "Deleting Memory",
        discover_integration: "Discovering Integration",
        // Composio meta tools
        COMPOSIO_SEARCH_TOOLS: "Searching Tools",
        COMPOSIO_MANAGE_CONNECTIONS: "Managing Connection",
        COMPOSIO_MULTI_EXECUTE_TOOL: "Executing Tool",
        COMPOSIO_REMOTE_WORKBENCH: "Running in Workbench",
        COMPOSIO_REMOTE_BASH_TOOL: "Running Command",
    };

    const statusConfig: Record<string, { icon: React.ReactNode; label: string }> = {
        streaming: {
            icon: <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />,
            label: "Preparing...",
        },
        searching: {
            icon: <Loader2Icon className="size-3.5 animate-spin text-blue-500" />,
            label: "Searching...",
        },
        executing: {
            icon: <Loader2Icon className="size-3.5 animate-spin text-amber-500" />,
            label: "Executing...",
        },
        completed: {
            icon: <CheckCircleIcon className="size-3.5 text-emerald-500" />,
            label: "Done",
        },
        error: {
            icon: <AlertCircleIcon className="size-3.5 text-destructive" />,
            label: "Failed",
        },
    };

    const { icon: statusIcon, label: statusLabel } = statusConfig[status] || statusConfig.streaming;

    let parsedArgs: Record<string, unknown> = {};
    if (args) {
        try {
            parsedArgs = JSON.parse(args);
        } catch {
            // leave empty
        }
    }

    const isComposioMeta = name.startsWith("COMPOSIO_");
    const isBuiltIn = type === "web_search_call" || (!isComposioMeta && !!toolLabels[name]);

    // ── Infer toolkit name & beautiful display name ──
    let derivedDisplayName = toolLabels[name] || name;
    const fallbackIcon = toolIcons[name] || <WrenchIcon className="size-4" />;
    let specificLogoUrl: string | undefined;

    if (isComposioMeta) {
        // Try to guess the app/toolkit from context
        let inferredToolkit = "";

        // COMPOSIO_MULTI_EXECUTE_TOOL usually has another tool name in its args
        if (name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
            // Raw name might look like "gmail_send_email"
            const subToolName = (parsedArgs.toolName as string) || (parsedArgs.tool_name as string) || "";
            if (subToolName) {
                const parts = subToolName.split("_");
                inferredToolkit = parts[0].toLowerCase();
                // Dynamic action verbs mapped to conversational labels
                const lowerAction = parts.slice(1).join("_");
                let actionVerb = "Using";
                let prep = "with";

                if (lowerAction.includes("search") || lowerAction.includes("find") || lowerAction.includes("list")) {
                    actionVerb = "Searching";
                    prep = ""; // "Searching Gmail"
                } else if (lowerAction.includes("fetch") || lowerAction.includes("get") || lowerAction.includes("read")) {
                    actionVerb = "Fetching from";
                    prep = ""; // "Fetching from Gmail"
                } else if (lowerAction.includes("create") || lowerAction.includes("add") || lowerAction.includes("insert")) {
                    actionVerb = "Creating in";
                    prep = ""; // "Creating in Notion"
                } else if (lowerAction.includes("update") || lowerAction.includes("edit") || lowerAction.includes("modify")) {
                    actionVerb = "Updating in";
                    prep = ""; // "Updating in Notion"
                } else if (lowerAction.includes("send") || lowerAction.includes("write") || lowerAction.includes("post")) {
                    actionVerb = "Sending to";
                    prep = ""; // "Sending to Slack"
                } else if (lowerAction.includes("delete") || lowerAction.includes("remove")) {
                    actionVerb = "Deleting from";
                    prep = ""; // "Deleting from Drive"
                }

                const formattedApp = inferredToolkit.charAt(0).toUpperCase() + inferredToolkit.slice(1);

                // e.g "Fetching from Gmail" or "Using Github"
                if (prep === "") {
                    derivedDisplayName = `${actionVerb} ${formattedApp}`;
                } else {
                    derivedDisplayName = `${actionVerb} ${formattedApp} ${prep}`; // Fallback struct

                    // Specific fallback if actionVerb is raw Using
                    if (actionVerb === "Using") {
                        const formattedRawAction = parts.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join(" ");
                        derivedDisplayName = `${formattedRawAction} (${formattedApp})`;
                    }
                }
            }
        }
        // COMPOSIO_MANAGE_CONNECTIONS — parse the toolkit from args
        else if (name === "COMPOSIO_MANAGE_CONNECTIONS") {
            const queryStr = JSON.stringify(parsedArgs).toLowerCase();
            const knownApps = Object.keys(toolkitLogos);
            for (const app of knownApps) {
                if (queryStr.includes(app)) {
                    inferredToolkit = app;
                    const formattedApp = app.charAt(0).toUpperCase() + app.slice(1);
                    derivedDisplayName = `Connecting to ${formattedApp}`;
                    break;
                }
            }
            // Fallback: try common arg fields
            if (!inferredToolkit) {
                const toolkit = (parsedArgs.toolkit as string) || (parsedArgs.app as string) || (parsedArgs.appName as string) || "";
                if (toolkit) {
                    inferredToolkit = toolkit.toLowerCase();
                    const formattedApp = inferredToolkit.charAt(0).toUpperCase() + inferredToolkit.slice(1);
                    derivedDisplayName = `Connecting to ${formattedApp}`;
                }
            }
        }
        // COMPOSIO_SEARCH_TOOLS usually has a query
        else if (name === "COMPOSIO_SEARCH_TOOLS") {
            const queryStr = JSON.stringify(parsedArgs).toLowerCase();
            const knownApps = Object.keys(toolkitLogos);
            for (const app of knownApps) {
                if (queryStr.includes(app)) {
                    inferredToolkit = app;
                    const formattedApp = app.charAt(0).toUpperCase() + app.slice(1);
                    derivedDisplayName = `Searching Tools (${formattedApp})`;
                    break;
                }
            }
        }
        // COMPOSIO_REMOTE_WORKBENCH — Python sandbox
        else if (name === "COMPOSIO_REMOTE_WORKBENCH") {
            const queryStr = JSON.stringify(parsedArgs).toLowerCase();
            const knownApps = Object.keys(toolkitLogos);
            for (const app of knownApps) {
                if (queryStr.includes(app)) {
                    inferredToolkit = app;
                    const formattedApp = app.charAt(0).toUpperCase() + app.slice(1);
                    derivedDisplayName = `Working in ${formattedApp}`;
                    break;
                }
            }
        }
        // COMPOSIO_REMOTE_BASH_TOOL — Bash commands
        else if (name === "COMPOSIO_REMOTE_BASH_TOOL") {
            const queryStr = JSON.stringify(parsedArgs).toLowerCase();
            const knownApps = Object.keys(toolkitLogos);
            for (const app of knownApps) {
                if (queryStr.includes(app)) {
                    inferredToolkit = app;
                    const formattedApp = app.charAt(0).toUpperCase() + app.slice(1);
                    derivedDisplayName = `Running command for ${formattedApp}`;
                    break;
                }
            }
        }

        if (inferredToolkit && toolkitLogos[inferredToolkit]) {
            specificLogoUrl = toolkitLogos[inferredToolkit];
        }
    }

    const [logoLoadFailed, setLogoLoadFailed] = useState(false);

    const finalIcon = (specificLogoUrl && !logoLoadFailed) ? (
        <img
            src={specificLogoUrl}
            alt=""
            className="size-4 object-contain"
            onError={() => setLogoLoadFailed(true)}
        />
    ) : fallbackIcon;

    const hasArgs = !isBuiltIn && args && Object.keys(parsedArgs).length > 0;

    // For built-in tools, show a simpler inline display
    if (isBuiltIn) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 px-3 py-2 text-sm mb-2">
                <span className="text-muted-foreground flex items-center justify-center">
                    {finalIcon}
                </span>
                <span className="font-medium text-muted-foreground">
                    {derivedDisplayName}
                </span>
                {statusIcon}
            </div>
        );
    }

    // For custom function tools, show expandable details
    return (
        <details className="group not-prose mb-3 w-full rounded-lg border border-border/60 bg-card/50 overflow-hidden">
            <summary className="flex w-full cursor-pointer items-center justify-between gap-3 p-3 text-sm hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground flex items-center justify-center">
                        {finalIcon}
                    </span>
                    <span className="font-medium">{derivedDisplayName}</span>
                </div>
                {statusIcon}
            </summary>
            <div className="border-t border-border/40 px-3 py-2 space-y-2 text-xs">
                {hasArgs && (
                    <div>
                        <span className="font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                            Parameters
                        </span>
                        <pre className="rounded-md bg-muted/50 p-2 overflow-x-auto whitespace-pre-wrap text-foreground">
                            {JSON.stringify(parsedArgs, null, 2)}
                        </pre>
                    </div>
                )}

                {result && (
                    <div>
                        <span className="font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                            Result
                        </span>
                        <pre className="rounded-md bg-muted/50 p-2 overflow-x-auto whitespace-pre-wrap text-foreground max-h-48 overflow-y-auto">
                            {result}
                        </pre>
                    </div>
                )}
            </div>
        </details>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function AgentChat() {
    const { messages, status, sendMessage, isLoading, toolkitLogos } = useAgentChat();

    const handleSubmit = useCallback(
        (value: string, _image: string | null) => {
            if (value.trim()) {
                sendMessage(value);
            }
        },
        [sendMessage]
    );

    const handleSuggestionClick = useCallback(
        (suggestion: string) => {
            sendMessage(suggestion);
        },
        [sendMessage]
    );

    const isEmpty = messages.length === 0;

    return (
        <div className="relative flex size-full flex-col overflow-hidden bg-background">
            {/* Empty state */}
            {isEmpty && (
                <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 ring-1 ring-primary/10">
                            <ZapIcon className="size-7 text-primary" />
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Autonomous Agent
                        </h1>
                        <p className="max-w-md text-center text-sm text-muted-foreground leading-relaxed">
                            An AI that works for you — autonomously searching, analyzing,
                            coding, and remembering. Powered by skills that free you from
                            repetitive work.
                        </p>
                    </div>

                    {/* Skill badges */}
                    <div className="flex flex-wrap justify-center gap-2 max-w-md">
                        {skillBadges.map((skill) => (
                            <div
                                key={skill.name}
                                className="flex items-center gap-1.5 rounded-full border border-border/50 bg-card/50 px-3 py-1.5 text-xs text-muted-foreground"
                            >
                                <skill.icon className={`size-3 ${skill.color}`} />
                                {skill.name}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Conversation */}
            {!isEmpty && (
                <Conversation>
                    <ConversationContent>
                        {messages.map((message) => (
                            <MessageBranch defaultBranch={0} key={message.key}>
                                <MessageBranchContent>
                                    <Message from={message.from}>
                                        <div>
                                            {/* Reasoning */}
                                            {message.reasoning && (
                                                <Reasoning duration={message.reasoning.duration}>
                                                    <ReasoningTrigger />
                                                    <ReasoningContent>
                                                        {message.reasoning.content}
                                                    </ReasoningContent>
                                                </Reasoning>
                                            )}

                                            {/* Tool calls */}
                                            {message.tools && message.tools.length > 0 && (
                                                <div className="mb-3 space-y-1">
                                                    {message.tools.map((tool) => (
                                                        <ToolCallCard
                                                            key={tool.id}
                                                            name={tool.name}
                                                            type={tool.type}
                                                            args={tool.arguments}
                                                            result={tool.result}
                                                            status={tool.status}
                                                            toolkitLogos={toolkitLogos}
                                                        />
                                                    ))}
                                                </div>
                                            )}

                                            {/* Connect button — rendered at message level, NOT inside tool card */}
                                            {(() => {
                                                const link = findConnectLink(message.tools);
                                                return link ? (
                                                    <div className="mb-4">
                                                        <ConnectButton
                                                            url={link.url}
                                                            toolkit={link.toolkit}
                                                            logoUrl={toolkitLogos[link.toolkit]}
                                                        />
                                                    </div>
                                                ) : null;
                                            })()}

                                            {/* Message content — strip connect URLs since we render a button */}
                                            <MessageContent>
                                                <MessageResponse>
                                                    {findConnectLink(message.tools)
                                                        ? stripConnectUrls(message.content)
                                                        : message.content}
                                                </MessageResponse>
                                            </MessageContent>
                                        </div>
                                    </Message>
                                </MessageBranchContent>
                            </MessageBranch>
                        ))}

                        {/* Status indicator */}
                        <StatusIndicator status={status} />
                    </ConversationContent>
                    <ConversationScrollButton />
                </Conversation>
            )}

            {/* Bottom panel */}
            <div className="grid shrink-0 gap-4 pt-4">
                {isEmpty && (
                    <Suggestions className="px-4">
                        {suggestions.map((suggestion) => (
                            <Suggestion
                                key={suggestion}
                                onClick={() => handleSuggestionClick(suggestion)}
                                suggestion={suggestion}
                            />
                        ))}
                    </Suggestions>
                )}
                <div className="w-full px-4 pb-4">
                    <div className="mx-auto w-full max-w-3xl">
                        <PromptBox
                            onSubmit={handleSubmit}
                            loading={isLoading}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
