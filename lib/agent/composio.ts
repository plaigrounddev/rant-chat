/**
 * Composio Integration — 1000+ Tool Access
 *
 * Manages Composio sessions and provides tools for the agent.
 * Composio's 5 meta tools handle discovery, auth, and execution
 * across 1000+ apps (Gmail, GitHub, Slack, Sheets, etc.).
 *
 * Uses @composio/core with its default provider to get tool schemas,
 * then converts them to OpenAI function-calling format for our
 * WebSocket-based agent loop.
 */

import { Composio } from "@composio/core";

// ── Types ──────────────────────────────────────────────────────────────────

interface ComposioToolSchema {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    [key: string]: unknown;
}

interface OpenAIFunctionTool {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

// ── Session Cache ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionCache: Map<string, { session: any; createdAt: number }> = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

// ── Composio Client ────────────────────────────────────────────────────────

function getComposioClient(): Composio | null {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
        console.warn("COMPOSIO_API_KEY not set — Composio tools disabled");
        return null;
    }
    return new Composio();
}

/**
 * Create or retrieve a cached Composio session for a user.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(userId: string): Promise<any | null> {
    const cached = sessionCache.get(userId);
    if (cached && Date.now() - cached.createdAt < SESSION_TTL) {
        return cached.session;
    }

    const client = getComposioClient();
    if (!client) return null;

    try {
        const session = await client.create(userId);
        sessionCache.set(userId, { session, createdAt: Date.now() });
        return session;
    } catch (err) {
        console.error("Failed to create Composio session:", err);
        return null;
    }
}

/**
 * Convert a Composio tool schema to OpenAI function-calling format.
 * Handles multiple possible formats from the Composio SDK:
 * 1. { name, description, parameters } — flat format
 * 2. { type: "function", function: { name, description, parameters } } — OpenAI format
 * 3. { name } — minimal format from default provider
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toOpenAITool(tool: any): OpenAIFunctionTool | null {
    let name: string | undefined;
    let description: string | undefined;
    let parameters: Record<string, unknown> | undefined;

    // Format 1: OpenAI nested format { type: "function", function: { name, ... } }
    if (tool.function && typeof tool.function === "object") {
        name = tool.function.name;
        description = tool.function.description;
        parameters = tool.function.parameters;
    }
    // Format 2: Flat format { name, description, parameters }
    else if (tool.name && typeof tool.name === "string") {
        name = tool.name;
        description = tool.description;
        parameters = tool.parameters || tool.inputSchema;
    }

    if (!name) {
        console.warn("Composio tool missing name, skipping:", JSON.stringify(tool).slice(0, 200));
        return null;
    }

    return {
        type: "function",
        name,
        description: description || `Composio tool: ${name}`,
        parameters: parameters || { type: "object", properties: {}, required: [] },
    };
}

/**
 * Get Composio's meta tools formatted for OpenAI.
 * Returns empty array if COMPOSIO_API_KEY is not set.
 */
export async function getComposioTools(
    userId = "default_user"
): Promise<OpenAIFunctionTool[]> {
    const session = await getSession(userId);
    if (!session) return [];

    try {
        const tools = await session.tools();

        // Debug: log the raw format so we can understand what Composio returns
        if (Array.isArray(tools) && tools.length > 0) {
            console.log(
                `[Composio] Got ${tools.length} tools. Sample format:`,
                JSON.stringify(tools[0]).slice(0, 300)
            );
        }

        if (Array.isArray(tools)) {
            return tools
                .map((tool: unknown) => {
                    try {
                        return toOpenAITool(tool);
                    } catch (err) {
                        console.warn("[Composio] Failed to convert tool:", err);
                        return null;
                    }
                })
                .filter((t): t is OpenAIFunctionTool => t !== null && !!t.name);
        }

        return [];
    } catch (err) {
        console.error("Failed to get Composio tools:", err);
        return [];
    }
}

/**
 * Execute a Composio tool call.
 * Routes through the session's tool execution.
 */
export async function executeComposioTool(
    toolName: string,
    args: Record<string, unknown>,
    userId = "default_user"
): Promise<string> {
    const session = await getSession(userId);
    if (!session) {
        return JSON.stringify({
            error: "Composio not configured. Set COMPOSIO_API_KEY in .env.local",
        });
    }

    try {
        // Use the session to execute the tool
        // Composio handles auth, execution, and result formatting
        const result = await session.executeTool({
            name: toolName,
            arguments: args,
        });

        if (typeof result === "string") return result;
        return JSON.stringify(result, null, 2);
    } catch (err) {
        const message = (err as Error).message || "Composio tool execution failed";
        return JSON.stringify({ error: message, tool: toolName });
    }
}

/**
 * Check if a tool name is a Composio meta tool.
 */
export function isComposioTool(toolName: string): boolean {
    return toolName.startsWith("COMPOSIO_");
}

/**
 * Check if Composio is configured (API key is set).
 */
export function isComposioEnabled(): boolean {
    return !!process.env.COMPOSIO_API_KEY;
}
