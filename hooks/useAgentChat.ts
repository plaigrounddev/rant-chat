/**
 * useAgentChat — Client-side hook for the autonomous agent
 *
 * Communicates with /api/agent via SSE (fetch + ReadableStream).
 * Manages messages, streaming state, tool call display, reasoning,
 * and task execution monitoring.
 */

"use client";

import { useCallback, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ToolCallInfo {
    id: string;
    name: string;
    type: "function_call" | "web_search_call";
    arguments: string;
    result?: string;
    status: "streaming" | "searching" | "executing" | "completed" | "error";
}

export interface AgentMessage {
    key: string;
    from: "user" | "assistant";
    content: string;
    reasoning?: {
        content: string;
        duration: number;
    };
    tools?: ToolCallInfo[];
}

export type AgentStatus =
    | "ready"
    | "connecting"
    | "thinking"
    | "streaming"
    | "executing_tools"
    | "error";

export interface TaskStepInfo {
    name: string;
    status: string;
    result?: string;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useAgentChat() {
    const [messages, setMessages] = useState<AgentMessage[]>([]);
    const [status, setStatus] = useState<AgentStatus>("ready");
    const [error, setError] = useState<string | null>(null);
    const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
    const [taskSteps, setTaskSteps] = useState<TaskStepInfo[]>([]);
    const [toolkitLogos, setToolkitLogos] = useState<Record<string, string>>({});
    const previousResponseIdRef = useRef<string | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const sendMessage = useCallback(async (text: string) => {
        if (!text.trim()) return;

        // Add user message
        const userMessage: AgentMessage = {
            key: `user-${Date.now()}`,
            from: "user",
            content: text,
        };

        // Prepare assistant message placeholder
        const assistantKey = `assistant-${Date.now()}`;
        const assistantMessage: AgentMessage = {
            key: assistantKey,
            from: "assistant",
            content: "",
            tools: [],
        };

        setMessages((prev) => [...prev, userMessage, assistantMessage]);
        setStatus("connecting");
        setError(null);
        setTaskSteps([]);

        // Abort any existing request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        // Tracking state for the current response
        let currentContent = "";
        let reasoningContent = "";
        const reasoningStart = Date.now();
        const toolCalls: Map<string, ToolCallInfo> = new Map();

        function updateAssistant(updates: Partial<AgentMessage>) {
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.key === assistantKey ? { ...msg, ...updates } : msg
                )
            );
        }

        try {
            const response = await fetch("/api/agent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: text,
                    previousResponseId: previousResponseIdRef.current,
                }),
                signal: abortController.signal,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(
                    (errData as { error?: string }).error ||
                    `Server error: ${response.status}`
                );
            }

            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response stream");

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse SSE events from buffer
                const lines = buffer.split("\n");
                buffer = lines.pop() || ""; // Keep incomplete line

                let eventName = "";
                let eventData = "";

                for (const line of lines) {
                    if (line.startsWith("event: ")) {
                        eventName = line.slice(7);
                    } else if (line.startsWith("data: ")) {
                        eventData = line.slice(6);

                        if (eventName && eventData) {
                            try {
                                const parsed = JSON.parse(eventData);
                                handleSSEEvent(eventName, parsed);
                            } catch {
                                // Ignore parse errors
                            }
                            eventName = "";
                            eventData = "";
                        }
                    }
                }
            }
        } catch (err) {
            if ((err as Error).name === "AbortError") return;
            const errorMsg =
                (err as Error).message || "Failed to connect to agent";
            setError(errorMsg);
            setStatus("error");
            updateAssistant({
                content: `⚠️ Error: ${errorMsg}`,
            });
        }

        function handleSSEEvent(event: string, data: Record<string, unknown>) {
            switch (event) {
                case "status": {
                    const statusType = data.type as string;
                    if (statusType === "thinking") {
                        setStatus("thinking");
                    } else if (statusType === "executing_tools") {
                        setStatus("executing_tools");
                    } else if (statusType === "connected") {
                        setStatus("connecting");
                    }
                    break;
                }

                case "response_created":
                    if (data.responseId) {
                        previousResponseIdRef.current = data.responseId as string;
                    }
                    break;

                // ── Composio toolkit logos ──────────────────────────────
                case "composio_ready": {
                    // Toolkit logos from session.toolkits() → meta.logo
                    const logos = data.toolkitLogos as Record<string, string> | undefined;
                    if (logos && Object.keys(logos).length > 0) {
                        setToolkitLogos(logos);
                    }
                    break;
                }

                // ── Task monitoring events ─────────────────────────────
                case "task_created":
                    setCurrentTaskId(data.taskId as string);
                    break;

                case "task_step": {
                    const step = data.step as TaskStepInfo;
                    if (step) {
                        setTaskSteps((prev) => [...prev, step]);
                    }
                    break;
                }

                case "task_completed":
                    // Task run is done
                    break;

                // ── Message events ─────────────────────────────────────
                case "message_start":
                    setStatus("streaming");
                    currentContent = "";
                    break;

                case "text_delta":
                    currentContent += data.delta as string;
                    setStatus("streaming");
                    updateAssistant({ content: currentContent });
                    break;

                case "text_done":
                    currentContent = data.text as string;
                    updateAssistant({ content: currentContent });
                    break;

                case "reasoning_delta":
                    reasoningContent += data.delta as string;
                    updateAssistant({
                        reasoning: {
                            content: reasoningContent,
                            duration: Math.round((Date.now() - reasoningStart) / 1000),
                        },
                    });
                    break;

                case "reasoning_done":
                    reasoningContent = data.text as string;
                    updateAssistant({
                        reasoning: {
                            content: reasoningContent,
                            duration: Math.round((Date.now() - reasoningStart) / 1000),
                        },
                    });
                    break;

                case "tool_start": {
                    const toolCall: ToolCallInfo = {
                        id: data.id as string,
                        name: data.name as string,
                        type: (data.type as ToolCallInfo["type"]) || "function_call",
                        arguments: "",
                        status: data.type === "web_search_call" ? "searching" : "streaming",
                    };
                    toolCalls.set(toolCall.id, toolCall);
                    updateAssistant({
                        tools: Array.from(toolCalls.values()),
                    });
                    break;
                }

                case "tool_update": {
                    const existingTool = toolCalls.get(data.id as string);
                    if (existingTool) {
                        existingTool.status = (data.status as ToolCallInfo["status"]) || existingTool.status;
                        updateAssistant({
                            tools: Array.from(toolCalls.values()),
                        });
                    }
                    break;
                }

                case "tool_args_delta": {
                    const tc = toolCalls.get(data.id as string);
                    if (tc) {
                        tc.arguments += data.delta as string;
                        updateAssistant({
                            tools: Array.from(toolCalls.values()),
                        });
                    }
                    break;
                }

                case "tool_call_complete": {
                    const tc = toolCalls.get(data.id as string);
                    if (tc) {
                        tc.arguments = data.arguments as string;
                        tc.status = "executing";
                        updateAssistant({
                            tools: Array.from(toolCalls.values()),
                        });
                    }
                    break;
                }

                case "tool_result": {
                    // Find tool call by call_id
                    for (const tc of toolCalls.values()) {
                        if (tc.name === (data.name as string) && !tc.result) {
                            tc.result = data.result as string;
                            tc.status = "completed";
                            break;
                        }
                    }
                    updateAssistant({
                        tools: Array.from(toolCalls.values()),
                    });
                    break;
                }

                case "done":
                    if (data.responseId) {
                        previousResponseIdRef.current = data.responseId as string;
                    }
                    setStatus("ready");
                    break;

                case "error":
                    setError(data.message as string);
                    setStatus("error");
                    if (currentContent === "") {
                        updateAssistant({
                            content: `⚠️ ${data.message as string}`,
                        });
                    }
                    break;
            }
        }
    }, []);

    const resetChat = useCallback(() => {
        setMessages([]);
        setStatus("ready");
        setError(null);
        setCurrentTaskId(null);
        setTaskSteps([]);
        previousResponseIdRef.current = null;
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
    }, []);

    return {
        messages,
        status,
        error,
        sendMessage,
        resetChat,
        isLoading: status !== "ready" && status !== "error",
        currentTaskId,
        taskSteps,
        toolkitLogos,
    };
}
