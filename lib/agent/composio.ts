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
 */
function toOpenAITool(tool: ComposioToolSchema): OpenAIFunctionTool {
    return {
        type: "function",
        name: tool.name,
        description: tool.description || `Composio tool: ${tool.name}`,
        parameters: tool.parameters || { type: "object", properties: {}, required: [] },
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

        // The default Composio provider returns an array of tool objects
        // We need to extract the schema from each and convert to OpenAI format
        if (Array.isArray(tools)) {
            return tools
                .map((tool: ComposioToolSchema) => {
                    try {
                        return toOpenAITool(tool);
                    } catch {
                        return null;
                    }
                })
                .filter((t): t is OpenAIFunctionTool => t !== null);
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
