/**
 * Sub-Agent Executor — Gemini-Powered Autonomous Tool Loop
 *
 * Runs a sub-agent with its own model (Gemini), system prompt, and tool access.
 * Mirrors the main agent loop in route.ts but uses Gemini's generateContent API
 * with function calling instead of OpenAI's WebSocket streaming.
 *
 * The executor:
 * 1. Loads the sub-agent persona from the registry
 * 2. Converts available tools to Gemini's FunctionDeclaration format
 * 3. Runs an autonomous loop: generate → call tools → feed results → repeat
 * 4. Returns the final text response + artifacts created
 */

import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType, type FunctionCall, type Part, type Schema } from "@google/generative-ai";
import { getSubAgent, listSubAgents, type SubAgentPersona, type SubAgentToolCategory } from "../sub-agents";
import { SANDBOX_TOOLS, type SandboxToolDefinition } from "../../sandbox/sandbox-tools";
import { executeSandboxTool } from "./sandbox-executor";
import { zodToJsonSchema } from "../utils/zod-to-json-schema";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SubAgentResult {
    success: boolean;
    agentId: string;
    agentName: string;
    response: string;
    toolCallsExecuted: number;
    toolRounds: number;
    artifacts: SubAgentArtifact[];
    error?: string;
}

interface SubAgentArtifact {
    type: "file" | "url";
    path?: string;
    url?: string;
    description: string;
}

// ── Tool Conversion ────────────────────────────────────────────────────────

/**
 * Convert our Zod-based sandbox tool definitions to Gemini's FunctionDeclaration format.
 */
function sandboxToolToGeminiFn(tool: SandboxToolDefinition): FunctionDeclaration {
    const jsonSchema = zodToJsonSchema(tool.schema);

    // Convert JSON Schema properties to Gemini Schema format
    const properties: Record<string, { type: SchemaType; description?: string; enum?: string[] }> = {};
    const required: string[] = jsonSchema.required || [];

    for (const [key, prop] of Object.entries(jsonSchema.properties)) {
        const geminiType = jsonSchemaTypeToGemini(prop.type);
        properties[key] = {
            type: geminiType,
            ...(prop.description && { description: prop.description }),
            ...(prop.enum && { enum: prop.enum }),
        } as Schema;
    }

    return {
        name: tool.name,
        description: tool.description,
        parameters: {
            type: SchemaType.OBJECT,
            properties: properties as { [k: string]: Schema },
            required,
        },
    };
}

function jsonSchemaTypeToGemini(type: string): SchemaType {
    switch (type) {
        case "string": return SchemaType.STRING;
        case "number": return SchemaType.NUMBER;
        case "integer": return SchemaType.INTEGER;
        case "boolean": return SchemaType.BOOLEAN;
        case "array": return SchemaType.ARRAY;
        case "object": return SchemaType.OBJECT;
        default: return SchemaType.STRING;
    }
}

/**
 * Get Gemini FunctionDeclarations for the sub-agent's allowed tool categories.
 */
function getGeminiTools(toolCategories: SubAgentToolCategory[]): FunctionDeclaration[] {
    const declarations: FunctionDeclaration[] = [];

    if (toolCategories.includes("sandbox")) {
        for (const tool of SANDBOX_TOOLS) {
            try {
                declarations.push(sandboxToolToGeminiFn(tool));
            } catch (err) {
                console.warn(`[SUB-AGENT] Failed to convert tool ${tool.name}:`, err);
            }
        }
    }

    return declarations;
}

// ── Executor ───────────────────────────────────────────────────────────────

/**
 * Execute a sub-agent with the given task.
 *
 * @param agentId   — ID of the sub-agent persona to use
 * @param task      — The task description from the main agent
 * @param sessionId — Session ID for sandbox isolation (shared with main agent)
 * @param onProgress — Optional callback for streaming progress updates
 */
export async function executeSubAgent(
    agentId: string,
    task: string,
    sessionId?: string,
    onProgress?: (event: string, data: unknown) => void,
): Promise<SubAgentResult> {
    const persona = getSubAgent(agentId);
    if (!persona) {
        return {
            success: false,
            agentId,
            agentName: "Unknown",
            response: "",
            toolCallsExecuted: 0,
            toolRounds: 0,
            artifacts: [],
            error: `Sub-agent "${agentId}" not found. Available: ${listAvailableAgents()}`,
        };
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
        return {
            success: false,
            agentId: persona.id,
            agentName: persona.name,
            response: "",
            toolCallsExecuted: 0,
            toolRounds: 0,
            artifacts: [],
            error: "GOOGLE_GENERATIVE_AI_API_KEY not configured",
        };
    }

    const progress = onProgress || (() => { });
    progress("sub_agent_start", {
        agentId: persona.id,
        agentName: persona.name,
        model: persona.model,
    });

    try {
        return await runSubAgentLoop(persona, apiKey, task, sessionId, progress);
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[SUB-AGENT] Error running ${persona.id}:`, errorMsg);
        return {
            success: false,
            agentId: persona.id,
            agentName: persona.name,
            response: "",
            toolCallsExecuted: 0,
            toolRounds: 0,
            artifacts: [],
            error: errorMsg,
        };
    }
}

function listAvailableAgents(): string {
    return listSubAgents().map((a) => a.id).join(", ");
}

// ── Agent Loop ─────────────────────────────────────────────────────────────

async function runSubAgentLoop(
    persona: SubAgentPersona,
    apiKey: string,
    task: string,
    sessionId: string | undefined,
    progress: (event: string, data: unknown) => void,
): Promise<SubAgentResult> {
    const genAI = new GoogleGenerativeAI(apiKey);

    const geminiTools = getGeminiTools(persona.tools);
    const model = genAI.getGenerativeModel({
        model: persona.model,
        systemInstruction: persona.systemPrompt,
        tools: geminiTools.length > 0 ? [{ functionDeclarations: geminiTools }] : undefined,
    });

    let toolCallsExecuted = 0;
    let toolRound = 0;
    const artifacts: SubAgentArtifact[] = [];

    // Start the conversation with the task
    const chat = model.startChat({});

    let result = await chat.sendMessage(task);
    let response = result.response;

    // Autonomous tool loop — keep going until the model stops calling tools
    while (toolRound < persona.maxRounds) {
        const candidates = response.candidates;
        if (!candidates || candidates.length === 0) break;

        const parts = candidates[0].content?.parts || [];
        const functionCalls = parts.filter(
            (p): p is Part & { functionCall: FunctionCall } => "functionCall" in p && p.functionCall !== undefined
        );

        // No more tool calls — the model is done
        if (functionCalls.length === 0) break;

        toolRound++;
        progress("sub_agent_tool_round", {
            round: toolRound,
            tools: functionCalls.map((fc) => fc.functionCall.name),
        });

        console.log(
            `[SUB-AGENT:${persona.id}] 🔧 Tool round ${toolRound} | ${functionCalls.length} call(s): ${functionCalls.map((fc) => fc.functionCall.name).join(", ")}`
        );

        // Execute all tool calls
        const toolResults: Part[] = [];
        for (const fc of functionCalls) {
            const { name, args } = fc.functionCall;
            toolCallsExecuted++;

            progress("sub_agent_tool_call", {
                name,
                round: toolRound,
                callNumber: toolCallsExecuted,
            });

            try {
                const toolResult = await executeSandboxTool(
                    name,
                    (args as Record<string, unknown>) || {},
                    sessionId,
                );

                // Track file writes as artifacts
                if (name === "sandbox_write_file" && args) {
                    const filePath = (args as Record<string, unknown>).path as string;
                    if (filePath) {
                        artifacts.push({
                            type: "file",
                            path: filePath,
                            description: `File written by ${persona.name}`,
                        });
                    }
                }

                // Track exposed ports as artifacts
                if (name === "sandbox_expose_port") {
                    try {
                        const parsed = JSON.parse(toolResult);
                        if (parsed.success && parsed.url) {
                            artifacts.push({
                                type: "url",
                                url: parsed.url,
                                description: `Live preview from ${persona.name}`,
                            });
                        }
                    } catch { /* ignore parse errors */ }
                }

                toolResults.push({
                    functionResponse: {
                        name,
                        response: { result: toolResult },
                    },
                });

                progress("sub_agent_tool_result", {
                    name,
                    success: true,
                    preview: typeof toolResult === "string" ? toolResult.slice(0, 200) : "",
                });
            } catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                toolResults.push({
                    functionResponse: {
                        name,
                        response: { error: errorMsg },
                    },
                });

                progress("sub_agent_tool_result", {
                    name,
                    success: false,
                    error: errorMsg,
                });
            }
        }

        // Send tool results back to the model
        result = await chat.sendMessage(toolResults);
        response = result.response;
    }

    // Extract the final text response
    const finalText = response.text() || "";

    progress("sub_agent_complete", {
        agentId: persona.id,
        toolCallsExecuted,
        toolRounds: toolRound,
        artifactCount: artifacts.length,
    });

    console.log(
        `[SUB-AGENT:${persona.id}] ✅ Complete | toolRounds=${toolRound} | toolCalls=${toolCallsExecuted} | artifacts=${artifacts.length}`
    );

    return {
        success: true,
        agentId: persona.id,
        agentName: persona.name,
        response: finalText,
        toolCallsExecuted,
        toolRounds: toolRound,
        artifacts,
    };
}
