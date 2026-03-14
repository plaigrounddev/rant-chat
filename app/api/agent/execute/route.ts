/**
 * Headless Agent Executor
 *
 * POST /api/agent/execute
 *
 * Non-streaming agent endpoint for background task execution.
 * Called by Convex cron jobs to auto-run enqueued tasks.
 *
 * Unlike the main /api/agent (SSE streaming for UI), this returns
 * a JSON response when the agent finishes. Same tools, same prompt.
 *
 * Protected by AGENT_INTERNAL_SECRET to prevent external abuse.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFilteredAgentTools, executeTool } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/prompts";
import {
    getComposioTools,
    executeComposioTool,
    isComposioTool,
    isComposioEnabled,
} from "@/lib/agent/composio";

// Force skills registration on module load
import "@/lib/agent/skills";

const MODEL = "gpt-4.1";
const MAX_TOOL_ROUNDS = 10; // Slightly lower than UI agent (15)
const OPENAI_API_URL = "https://api.openai.com/v1/responses";

interface ToolCall {
    id: string;
    call_id: string;
    type: "function_call";
    name: string;
    arguments: string;
}

interface ExecuteRequest {
    instructions: string;
    taskId?: string;
    apiSecret: string;
}

export async function POST(req: NextRequest) {
    // ── Auth check ─────────────────────────────────────────────────
    const internalSecret = process.env.AGENT_INTERNAL_SECRET;
    if (!internalSecret) {
        return NextResponse.json(
            { error: "AGENT_INTERNAL_SECRET not configured" },
            { status: 500 }
        );
    }

    let body: ExecuteRequest;
    try {
        body = (await req.json()) as ExecuteRequest;
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body.apiSecret !== internalSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!body.instructions?.trim()) {
        return NextResponse.json(
            { error: "instructions required" },
            { status: 400 }
        );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        return NextResponse.json(
            { error: "OPENAI_API_KEY not configured" },
            { status: 500 }
        );
    }

    // ── Run the headless agent loop ────────────────────────────────
    try {
        const result = await runHeadlessAgent(
            apiKey,
            body.instructions,
            body.taskId
        );
        return NextResponse.json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "Execution failed";
        console.error("[Execute] Fatal error:", message);
        return NextResponse.json(
            { success: false, error: message },
            { status: 500 }
        );
    }
}

async function runHeadlessAgent(
    apiKey: string,
    instructions: string,
    taskId?: string
): Promise<{
    success: boolean;
    result: string;
    toolsUsed: string[];
    rounds: number;
    error?: string;
}> {
    // Build tools + system prompt (same as main agent)
    const composioTools = await getComposioTools();
    const agentTools = [
        ...getFilteredAgentTools(instructions),
        ...composioTools,
    ];

    const systemInstructions = await buildSystemPrompt({
        composioEnabled: isComposioEnabled(),
    });

    const toolsUsed: string[] = [];
    let rounds = 0;
    let previousResponseId: string | undefined;
    let finalText = "";

    console.log(
        `[Execute] ▶ Headless run | task=${taskId || "none"} | tools=${agentTools.length}`
    );

    // ── Multi-round tool execution loop ────────────────────────────
    while (rounds < MAX_TOOL_ROUNDS) {
        rounds++;

        // Build the request payload
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const requestBody: Record<string, any> = {
            model: MODEL,
            instructions: systemInstructions,
            tools: agentTools,
            stream: false, // Non-streaming for headless execution
        };

        if (previousResponseId) {
            // Continuation: send tool results via previous_response_id
            requestBody.previous_response_id = previousResponseId;
        } else {
            // Initial request
            requestBody.input = [
                {
                    type: "message",
                    role: "user",
                    content: [{ type: "input_text", text: instructions }],
                },
            ];
        }

        // Call OpenAI Responses API (REST, non-streaming)
        const response = await fetch(OPENAI_API_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`OpenAI API error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        previousResponseId = data.id;

        // Extract function calls from the output
        const functionCalls: ToolCall[] = (data.output || []).filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (item: any) => item.type === "function_call"
        );

        // Extract text output
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textOutputs = (data.output || []).filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (item: any) => item.type === "message"
        );

        for (const msg of textOutputs) {
            if (msg.content) {
                for (const part of msg.content) {
                    if (part.type === "output_text" && part.text) {
                        finalText += part.text;
                    }
                }
            }
        }

        // If no function calls, the agent is done
        if (functionCalls.length === 0) {
            console.log(
                `[Execute] ✅ Done in ${rounds} round(s) | tools: ${toolsUsed.join(", ") || "none"}`
            );
            break;
        }

        // ── Execute tool calls ─────────────────────────────────────
        console.log(
            `[Execute] 🔧 Round ${rounds} | ${functionCalls.length} tool(s): ${functionCalls.map((fc) => fc.name).join(", ")}`
        );

        const toolResults = await Promise.all(
            functionCalls.map(async (fc) => {
                toolsUsed.push(fc.name);

                let args: Record<string, unknown> = {};
                try {
                    args = JSON.parse(fc.arguments);
                } catch {
                    // Pass empty args if parse fails
                }

                const result = isComposioTool(fc.name)
                    ? await executeComposioTool(fc.name, args, fc.call_id)
                    : await executeTool(fc.name, args);

                return {
                    type: "function_call_output" as const,
                    call_id: fc.call_id,
                    output: result,
                };
            })
        );

        // Send tool results back to OpenAI for the next round
        requestBody.input = toolResults;
        requestBody.previous_response_id = previousResponseId;

        // Re-use the requestBody pattern (loop continues)
        // We need to make the next call with tool results
        const continueResponse = await fetch(OPENAI_API_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: MODEL,
                instructions: systemInstructions,
                tools: agentTools,
                stream: false,
                previous_response_id: previousResponseId,
                input: toolResults,
            }),
        });

        if (!continueResponse.ok) {
            const errText = await continueResponse.text();
            throw new Error(
                `OpenAI continuation error (${continueResponse.status}): ${errText}`
            );
        }

        const continueData = await continueResponse.json();
        previousResponseId = continueData.id;

        // Check for more function calls in the continuation
        const moreFunctionCalls = (continueData.output || []).filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (item: any) => item.type === "function_call"
        );

        // Extract text from continuation
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const moreTextOutputs = (continueData.output || []).filter(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (item: any) => item.type === "message"
        );
        for (const msg of moreTextOutputs) {
            if (msg.content) {
                for (const part of msg.content) {
                    if (part.type === "output_text" && part.text) {
                        finalText += part.text;
                    }
                }
            }
        }

        // If no more function calls, we're done
        if (moreFunctionCalls.length === 0) {
            console.log(
                `[Execute] ✅ Done in ${rounds} round(s) | tools: ${toolsUsed.join(", ") || "none"}`
            );
            break;
        }

        // If there are more function calls, the loop will handle them
        // by continuing with the latest previousResponseId
    }

    return {
        success: true,
        result: finalText || "Task completed (no text output)",
        toolsUsed: [...new Set(toolsUsed)],
        rounds,
    };
}

// GET - health check
export async function GET() {
    return NextResponse.json({
        status: "ok",
        endpoint: "/api/agent/execute",
        description: "Headless agent executor for background automation tasks",
    });
}
