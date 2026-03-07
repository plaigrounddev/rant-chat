/**
 * Agent API Route — Autonomous Agent Engine
 *
 * Mirrors Lindy AI's agent architecture:
 * - Skills-based tool execution
 * - Persistent memory with auto-injection
 * - Dynamic system prompt with exit conditions
 * - Task monitoring with step-by-step logging
 * - Multi-round autonomous tool loop
 *
 * Opens a WebSocket to OpenAI's Responses API, runs the autonomous
 * tool-call loop server-side, and streams events back to the client via SSE.
 *
 * POST /api/agent
 * Body: { message: string, previousResponseId?: string }
 */

import { NextRequest } from "next/server";
import WebSocket from "ws";
import { getAgentTools, getCustomTools, executeTool } from "@/lib/agent/tools";
import { buildSystemPrompt } from "@/lib/agent/prompts";
import { getTemplate } from "@/lib/agent/prompt-templates";
import { taskStore } from "@/lib/agent/task-store";
import {
    getComposioTools,
    executeComposioTool,
    isComposioTool,
    isComposioEnabled,
    getToolkitLogos,
} from "@/lib/agent/composio";

// Force skills registration on module load
import "@/lib/agent/skills";

const OPENAI_WS_URL = "wss://api.openai.com/v1/responses";
const MODEL = "gpt-4o";
const MAX_TOOL_ROUNDS = 15; // Lindy agents can run 8+ actions; we allow 15

interface FunctionCall {
    id: string;
    call_id: string;
    name: string;
    arguments: string;
}

export async function POST(req: NextRequest) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === "sk-your-key-here") {
        return new Response(
            JSON.stringify({ error: "OPENAI_API_KEY not configured in .env.local" }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return new Response(
            JSON.stringify({ error: "Invalid JSON body" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }
    const { message, previousResponseId, templateSlug } = body as {
        message: string;
        previousResponseId?: string;
        templateSlug?: string;
    };

    if (!message?.trim()) {
        return new Response(JSON.stringify({ error: "Message is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    // Create a readable stream for SSE
    const encoder = new TextEncoder();
    const runAbort = new AbortController();
    const stream = new ReadableStream({
        start(controller) {
            function sendSSE(event: string, data: unknown) {
                const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
                controller.enqueue(encoder.encode(payload));
            }

            function close() {
                controller.close();
            }

            void runAgentLoop(apiKey, message, previousResponseId, templateSlug, sendSSE, close).catch((err) => {
                sendSSE("error", { code: "agent_error", message: String(err) });
                close();
            });
        },
        cancel() {
            runAbort.abort();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
}

async function runAgentLoop(
    apiKey: string,
    userMessage: string,
    previousResponseId: string | undefined,
    templateSlug: string | undefined,
    sendSSE: (event: string, data: unknown) => void,
    close: () => void
) {
    let ws: WebSocket | null = null;
    const customTools = getCustomTools();

    // Get Composio tools (1000+ integrations) if configured
    const composioTools = await getComposioTools();
    const hasCustomTools = customTools.length > 0 || composioTools.length > 0;

    // Create a task run for monitoring
    const taskRun = taskStore.createRun(userMessage);
    sendSSE("task_created", { taskId: taskRun.id });

    if (composioTools.length > 0) {
        // Fetch toolkit logos from session.toolkits() → meta.logo
        const toolkitLogos = await getToolkitLogos();
        sendSSE("composio_ready", { toolCount: composioTools.length, toolkitLogos });
    }

    // Look up prompt template overrides
    const template = templateSlug ? getTemplate(templateSlug) : undefined;

    // Build the dynamic system prompt with memories & skills
    const systemInstructions = await buildSystemPrompt({
        composioEnabled: isComposioEnabled(),
        ...(template?.config || {}),
    });

    try {
        ws = new WebSocket(OPENAI_WS_URL, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
            },
        });

        let currentResponseId: string | null = null;
        let toolRound = 0;

        // Track function calls being streamed
        const pendingFunctionCalls: Map<string, FunctionCall> = new Map();

        ws.on("open", () => {
            sendSSE("status", { type: "connected" });

            // Build the initial request with full tool suite
            // Merge our custom skills + Composio's meta tools
            const agentTools = [...getAgentTools(), ...composioTools];
            const request: Record<string, unknown> = {
                type: "response.create",
                model: MODEL,
                instructions: systemInstructions,
                tools: agentTools,
                input: [
                    {
                        type: "message",
                        role: "user",
                        content: [{ type: "input_text", text: userMessage }],
                    },
                ],
            };

            if (previousResponseId) {
                request.previous_response_id = previousResponseId;
            }

            ws!.send(JSON.stringify(request));
            sendSSE("status", { type: "thinking" });
        });

        ws.on("message", async (data: WebSocket.Data) => {
            try {
                const event = JSON.parse(data.toString());
                const eventType: string = event.type;

                switch (eventType) {
                    // ── Response lifecycle ──────────────────────────────────
                    case "response.created":
                        currentResponseId = event.response?.id || null;
                        sendSSE("response_created", {
                            responseId: currentResponseId,
                        });
                        break;

                    // ── Output items ───────────────────────────────────────
                    case "response.output_item.added":
                        if (event.item?.type === "function_call") {
                            const fc: FunctionCall = {
                                id: event.item.id,
                                call_id: event.item.call_id,
                                name: event.item.name,
                                arguments: "",
                            };
                            pendingFunctionCalls.set(event.item.id, fc);
                            sendSSE("tool_start", {
                                id: event.item.id,
                                call_id: event.item.call_id,
                                name: event.item.name,
                                type: "function_call",
                            });

                            // Log step to task store
                            const step = taskStore.addStep(taskRun.id, {
                                type: "tool_call",
                                name: event.item.name,
                                status: "running",
                            });
                            if (step) {
                                sendSSE("task_step", {
                                    taskId: taskRun.id,
                                    step: { id: step.id, name: step.name, status: step.status },
                                });
                            }
                        } else if (event.item?.type === "web_search_call") {
                            sendSSE("tool_start", {
                                id: event.item.id,
                                name: "web_search",
                                type: "web_search_call",
                                status: event.item.status,
                            });
                            taskStore.addStep(taskRun.id, {
                                type: "tool_call",
                                name: "web_search",
                                status: "running",
                            });
                        } else if (event.item?.type === "message") {
                            sendSSE("message_start", { id: event.item.id });
                        }
                        break;

                    // ── Web search events (built-in) ───────────────────────
                    case "response.web_search_call.in_progress":
                        sendSSE("tool_update", {
                            id: event.item_id,
                            name: "web_search",
                            type: "web_search_call",
                            status: "searching",
                        });
                        break;

                    case "response.web_search_call.searching":
                        sendSSE("tool_update", {
                            id: event.item_id,
                            name: "web_search",
                            type: "web_search_call",
                            status: "searching",
                        });
                        break;

                    case "response.web_search_call.completed":
                        sendSSE("tool_update", {
                            id: event.item_id,
                            name: "web_search",
                            type: "web_search_call",
                            status: "completed",
                        });
                        break;

                    // ── Text streaming ─────────────────────────────────────
                    case "response.output_text.delta":
                        sendSSE("text_delta", { delta: event.delta });
                        break;

                    case "response.output_text.done":
                        sendSSE("text_done", { text: event.text });
                        break;

                    // ── Reasoning / chain-of-thought ───────────────────────
                    case "response.reasoning_summary_text.delta":
                        sendSSE("reasoning_delta", { delta: event.delta });
                        break;

                    case "response.reasoning_summary_text.done":
                        sendSSE("reasoning_done", { text: event.text });
                        break;

                    // ── Function call arguments streaming ──────────────────
                    case "response.function_call_arguments.delta":
                        if (hasCustomTools) {
                            const fc = pendingFunctionCalls.get(event.item_id);
                            if (fc) {
                                fc.arguments += event.delta;
                                sendSSE("tool_args_delta", {
                                    id: event.item_id,
                                    delta: event.delta,
                                });
                            }
                        }
                        break;

                    case "response.function_call_arguments.done":
                        if (hasCustomTools) {
                            const fc = pendingFunctionCalls.get(event.item_id);
                            if (fc) {
                                fc.arguments = event.arguments;
                            }
                        }
                        break;

                    // ── Output item done ───────────────────────────────────
                    case "response.output_item.done":
                        if (event.item?.type === "function_call") {
                            sendSSE("tool_call_complete", {
                                id: event.item.id,
                                call_id: event.item.call_id,
                                name: event.item.name,
                                arguments: event.item.arguments,
                            });
                        } else if (event.item?.type === "web_search_call") {
                            sendSSE("tool_update", {
                                id: event.item.id,
                                name: "web_search",
                                type: "web_search_call",
                                status: "completed",
                            });
                        }
                        break;

                    // ── Response completed ─────────────────────────────────
                    case "response.completed": {
                        const response = event.response;
                        currentResponseId = response?.id || currentResponseId;

                        const functionCallOutputs =
                            response?.output?.filter(
                                (o: { type: string }) => o.type === "function_call"
                            ) || [];

                        if (
                            hasCustomTools &&
                            functionCallOutputs.length > 0 &&
                            toolRound < MAX_TOOL_ROUNDS
                        ) {
                            toolRound++;
                            taskStore.incrementToolRound(taskRun.id);
                            sendSSE("status", {
                                type: "executing_tools",
                                round: toolRound,
                            });

                            // Execute all tool calls via skills or Composio
                            const toolResults = await Promise.all(
                                functionCallOutputs.map(
                                    async (fc: {
                                        call_id: string;
                                        name: string;
                                        arguments: string;
                                    }) => {
                                        let args: Record<string, unknown> = {};
                                        try {
                                            args = JSON.parse(fc.arguments);
                                        } catch {
                                            // If args don't parse, pass empty
                                        }

                                        // Route to Composio or our custom skills
                                        const result = isComposioTool(fc.name)
                                            ? await executeComposioTool(fc.name, args, fc.call_id)
                                            : await executeTool(fc.name, args);

                                        // Log tool result to task store
                                        const existingStep = taskRun.steps.find(
                                            (s) =>
                                                s.name === fc.name && s.status === "running"
                                        );
                                        if (existingStep) {
                                            taskStore.completeStep(
                                                taskRun.id,
                                                existingStep.id,
                                                result
                                            );
                                        }

                                        sendSSE("tool_result", {
                                            call_id: fc.call_id,
                                            name: fc.name,
                                            arguments: args,
                                            result,
                                        });

                                        sendSSE("task_step", {
                                            taskId: taskRun.id,
                                            step: {
                                                name: fc.name,
                                                status: "completed",
                                                result:
                                                    typeof result === "string"
                                                        ? result.slice(0, 200)
                                                        : result,
                                            },
                                        });

                                        return {
                                            type: "function_call_output" as const,
                                            call_id: fc.call_id,
                                            output: result,
                                        };
                                    }
                                )
                            );

                            // Send follow-up with tool results
                            pendingFunctionCalls.clear();

                            const agentTools = [...getAgentTools(), ...composioTools];
                            const continuationRequest = {
                                type: "response.create",
                                model: MODEL,
                                instructions: systemInstructions,
                                tools: agentTools,
                                previous_response_id: currentResponseId,
                                input: toolResults,
                            };

                            sendSSE("status", { type: "thinking" });
                            ws!.send(JSON.stringify(continuationRequest));
                        } else {
                            // ── Iterative loop: decide whether to continue or stop ──
                            // Extract the text content from this response
                            const textOutputs = response?.output?.filter(
                                (o: { type: string }) => o.type === "message"
                            ) || [];
                            const lastText = textOutputs
                                .flatMap((o: { content?: { text?: string }[] }) =>
                                    (o.content || []).map((c) => c.text || "")
                                )
                                .join("");

                            // The agent is truly done when:
                            // 1. It signals [TASK_COMPLETE] explicitly, OR
                            // 2. It has never used tools (simple Q&A), OR
                            // 3. It has hit the tool round limit
                            const isExplicitDone = lastText.includes("[TASK_COMPLETE]");
                            const isSimpleQA = toolRound === 0;
                            const isMaxedOut = toolRound >= MAX_TOOL_ROUNDS;

                            if (isExplicitDone || isSimpleQA || isMaxedOut) {
                                // Strip the [TASK_COMPLETE] marker from the final message
                                // (it's an internal signal, not for the user)
                                taskStore.completeRun(taskRun.id, "completed");
                                sendSSE("task_completed", {
                                    taskId: taskRun.id,
                                    toolRounds: toolRound,
                                });
                                sendSSE("done", {
                                    responseId: currentResponseId,
                                });
                                ws!.close();
                                close();
                            } else {
                                // Agent paused with text but hasn't finished — push it to keep going
                                toolRound++;
                                sendSSE("status", { type: "thinking" });

                                const agentTools = [...getAgentTools(), ...composioTools];
                                const continuationRequest = {
                                    type: "response.create",
                                    model: MODEL,
                                    instructions: systemInstructions,
                                    tools: agentTools,
                                    previous_response_id: currentResponseId,
                                    input: [
                                        {
                                            type: "message",
                                            role: "user",
                                            content: [
                                                {
                                                    type: "input_text",
                                                    text: "Continue working. Don't stop to ask me questions — use your tools and keep making progress. If you're completely done, include [TASK_COMPLETE] at the end of your final response.",
                                                },
                                            ],
                                        },
                                    ],
                                };
                                ws!.send(JSON.stringify(continuationRequest));
                            }
                        }
                        break;
                    }

                    // ── Errors ─────────────────────────────────────────────
                    case "error":
                        taskStore.completeRun(
                            taskRun.id,
                            "error",
                            event.error?.message
                        );
                        sendSSE("error", {
                            code: event.error?.code,
                            message: event.error?.message,
                        });
                        ws!.close();
                        close();
                        break;

                    case "rate_limit_exceeded":
                        taskStore.completeRun(
                            taskRun.id,
                            "error",
                            "Rate limit exceeded"
                        );
                        sendSSE("error", {
                            code: "rate_limit_exceeded",
                            message: "Rate limit exceeded. Please try again later.",
                        });
                        ws!.close();
                        close();
                        break;
                }
            } catch (err) {
                console.error("Error processing WS message:", err);
                sendSSE("error", {
                    code: "parse_error",
                    message: "Failed to process server event",
                });
            }
        });

        ws.on("error", (err: Error) => {
            console.error("WebSocket error:", err);
            taskStore.completeRun(taskRun.id, "error", err.message);
            sendSSE("error", {
                code: "ws_error",
                message: err.message || "WebSocket connection error",
            });
            close();
        });

        ws.on("close", () => {
            // Connection closed; stream may already be closed
        });
    } catch (err) {
        console.error("Agent loop error:", err);
        taskStore.completeRun(taskRun.id, "error", "Failed to start agent");
        sendSSE("error", {
            code: "agent_error",
            message: "Failed to start agent",
        });
        close();
    }
}
