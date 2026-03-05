/**
 * Composio Integration — 1000+ Tool Access
 *
 * Integration pattern from docs.composio.dev/docs/providers/openai:
 *
 * 1. Create Composio client with OpenAIResponsesProvider
 * 2. Create session per user → session.tools() returns meta tools
 * 3. Pass meta tools to OpenAI alongside our custom tools
 * 4. Execute tool calls via provider.executeToolCall(userId, toolCall)
 *
 * Meta tools (COMPOSIO_SEARCH_TOOLS, COMPOSIO_MANAGE_CONNECTIONS, etc.)
 * handle discovery, auth, and execution of 1000+ app integrations.
 */

import { Composio } from "@composio/core";
import { OpenAIResponsesProvider } from "@composio/openai";

// ── Types ──────────────────────────────────────────────────────────────────

// OpenAI Responses API function tool format
interface OpenAIFunctionTool {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

// ── Composio Client (singleton) ────────────────────────────────────────────

let composioInstance: Composio | null = null;
let providerInstance: OpenAIResponsesProvider | null = null;

function getComposio(): Composio | null {
    if (composioInstance) return composioInstance;

    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
        console.warn("[Composio] COMPOSIO_API_KEY not set — Composio tools disabled");
        return null;
    }

    providerInstance = new OpenAIResponsesProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    composioInstance = new Composio({
        apiKey,
        provider: providerInstance as any,
    });

    return composioInstance;
}

function getProvider(): OpenAIResponsesProvider | null {
    if (!providerInstance) getComposio();
    return providerInstance;
}

// ── Session Cache ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionCache: Map<string, { session: any; createdAt: number }> = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSession(userId: string): Promise<any | null> {
    const cached = sessionCache.get(userId);
    if (cached && Date.now() - cached.createdAt < SESSION_TTL) {
        return cached.session;
    }

    const composio = getComposio();
    if (!composio) return null;

    try {
        const session = await composio.create(userId);
        sessionCache.set(userId, { session, createdAt: Date.now() });
        return session;
    } catch (err) {
        console.error("[Composio] Failed to create session:", err);
        return null;
    }
}

// ── Tool Retrieval ─────────────────────────────────────────────────────────

/**
 * Convert a Composio tool to our flat OpenAI function-calling format.
 *
 * OpenAIResponsesProvider.wrapTool returns:
 *   { type: "function", name: "...", description: "...", parameters: {...} }
 * which is exactly the OpenAI Responses API format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeToFlatTool(tool: any): OpenAIFunctionTool | null {
    // Format: { type: "function", name: "COMPOSIO_*", ... } — already flat
    if (tool.type === "function" && tool.name && typeof tool.name === "string") {
        return {
            type: "function",
            name: tool.name,
            description: tool.description || `Composio tool: ${tool.name}`,
            parameters: tool.parameters || { type: "object", properties: {}, required: [] },
        };
    }

    // Format: { type: "function", function: { name, description, parameters } }
    if (tool.function && typeof tool.function === "object" && tool.function.name) {
        return {
            type: "function",
            name: tool.function.name,
            description: tool.function.description || `Composio tool: ${tool.function.name}`,
            parameters: tool.function.parameters || { type: "object", properties: {}, required: [] },
        };
    }

    console.warn("[Composio] Skipping tool with unknown format:", JSON.stringify(tool).slice(0, 200));
    return null;
}

/**
 * Get Composio's meta tools formatted for OpenAI WebSocket API.
 * Returns empty array if COMPOSIO_API_KEY is not set.
 */
export async function getComposioTools(
    userId = "default_user"
): Promise<OpenAIFunctionTool[]> {
    const session = await getSession(userId);
    if (!session) return [];

    try {
        const tools = await session.tools();

        if (Array.isArray(tools) && tools.length > 0) {
            console.log(
                `[Composio] Got ${tools.length} meta tools. Sample keys:`,
                Object.keys(tools[0])
            );

            return tools
                .map(normalizeToFlatTool)
                .filter((t): t is OpenAIFunctionTool => t !== null);
        }

        return [];
    } catch (err) {
        console.error("[Composio] Failed to get tools:", err);
        return [];
    }
}

// ── Tool Execution ─────────────────────────────────────────────────────────

/**
 * Execute a Composio tool call using the OpenAIResponsesProvider.
 *
 * Uses provider.executeToolCall(userId, toolCall) which expects:
 *   { type: "function_call", call_id, name, arguments }
 * This matches the OpenAI Responses/WebSocket API format.
 */
export async function executeComposioTool(
    toolName: string,
    args: Record<string, unknown>,
    callId: string,
    userId = "default_user"
): Promise<string> {
    const provider = getProvider();
    if (!provider) {
        return JSON.stringify({
            error: "Composio not configured. Set COMPOSIO_API_KEY in .env.local",
        });
    }

    try {
        // Format as OpenAI Responses function call
        // This matches OpenAI.Responses.ResponseFunctionToolCall
        const toolCall = {
            type: "function_call" as const,
            call_id: callId,
            name: toolName,
            arguments: JSON.stringify(args),
            id: callId,
            status: "completed" as const,
        };

        // executeToolCall is the per-call execution method
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await provider.executeToolCall(userId, toolCall as any);

        if (typeof result === "string") return result;
        return JSON.stringify(result, null, 2);
    } catch (err) {
        const message = (err as Error).message || "Composio tool execution failed";
        console.error(`[Composio] Execution error (${toolName}):`, message);
        return JSON.stringify({ error: message, tool: toolName });
    }
}

// ── Toolkit Logos ──────────────────────────────────────────────────────────

/**
 * Fetch toolkit logos from Composio via session.toolkits().
 *
 * Per the SDK types (ToolKitItemSchema), each toolkit has:
 *   { name, slug, meta: { logo?: string, description?, ... } }
 *
 * Returns a map of toolkit slug → logo URL.
 * Results are cached for the session TTL.
 */
let toolkitLogosCache: { logos: Record<string, string>; createdAt: number } | null = null;

export async function getToolkitLogos(
    userId = "default_user"
): Promise<Record<string, string>> {
    // Return cached logos if fresh
    if (toolkitLogosCache && Date.now() - toolkitLogosCache.createdAt < SESSION_TTL) {
        return toolkitLogosCache.logos;
    }

    const session = await getSession(userId);
    if (!session) return {};

    try {
        const toolkits = await session.toolkits();
        const logos: Record<string, string> = {};

        if (Array.isArray(toolkits)) {
            for (const tk of toolkits) {
                const slug = tk.slug || tk.name;
                const logo = tk.meta?.logo || tk.logo;
                if (slug && logo) {
                    logos[slug.toLowerCase()] = logo;
                }
            }
            console.log(`[Composio] Cached ${Object.keys(logos).length} toolkit logos`);
        }

        toolkitLogosCache = { logos, createdAt: Date.now() };
        return logos;
    } catch (err) {
        console.error("[Composio] Failed to fetch toolkit logos:", err);
        return {};
    }
}

// ── Utility ────────────────────────────────────────────────────────────────

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
