/**
 * Typed Agent Event System
 *
 * Inspired by claw-code's lane_events.rs pattern.
 * Replaces console.log with structured, typed events that can be:
 * - Streamed to the UI via SSE
 * - Filtered by type for debugging
 * - Persisted for audit/replay
 *
 * Event taxonomy mirrors claw-code's failure classes:
 *   tool_runtime | api_error | auth_required | rate_limit |
 *   timeout | context_overflow | config_error
 */

// ── Event Types ─────────────────────────────────────────────────────

export type AgentEventType =
    // Session lifecycle
    | "session.started"
    | "session.completed"
    | "session.failed"
    | "session.cancelled"
    // Tool execution
    | "tool.started"
    | "tool.completed"
    | "tool.failed"
    | "tool.skipped"
    // Composio
    | "composio.tools_loaded"
    | "composio.auth_required"
    | "composio.auth_link_generated"
    | "composio.connection_established"
    // Recovery
    | "recovery.started"
    | "recovery.succeeded"
    | "recovery.failed"
    | "recovery.escalated"
    // Model
    | "model.request_sent"
    | "model.response_received"
    | "model.streaming_started"
    | "model.round_completed"
    // Agent
    | "agent.state_changed"
    | "agent.thinking"
    | "agent.responding"
    | "agent.tool_routing";

// ── Event Severity ──────────────────────────────────────────────────

export type EventSeverity = "debug" | "info" | "warn" | "error";

// ── Agent Event ─────────────────────────────────────────────────────

export interface AgentEvent {
    type: AgentEventType;
    severity: EventSeverity;
    timestamp: string;
    message: string;
    data?: Record<string, unknown>;
    /** Duration in ms (for timed events like tool.completed) */
    durationMs?: number;
    /** Error details if applicable */
    error?: {
        message: string;
        code?: string;
        failureClass?: string;
    };
}

// ── Event Listener ──────────────────────────────────────────────────

export type AgentEventListener = (event: AgentEvent) => void;

// ── Event Emitter ───────────────────────────────────────────────────

export class AgentEventEmitter {
    private listeners: AgentEventListener[] = [];
    private events: AgentEvent[] = [];
    private maxHistory = 200;

    /** Subscribe to events. Returns unsubscribe function. */
    on(listener: AgentEventListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    /** Get all events (most recent first) */
    getHistory(): AgentEvent[] {
        return [...this.events].reverse();
    }

    /** Get events of a specific type */
    getByType(type: AgentEventType): AgentEvent[] {
        return this.events.filter((e) => e.type === type);
    }

    /** Clear event history */
    clear(): void {
        this.events = [];
    }

    // ── Convenience Emitters ────────────────────────────────────────

    // Session events
    sessionStarted(model: string, toolCount: number): void {
        this.emit("session.started", "info",
            `Agent session started | model=${model} | tools=${toolCount}`,
            { model, toolCount });
    }

    sessionCompleted(rounds: number, toolCalls: number, durationMs: number): void {
        this.emit("session.completed", "info",
            `Session completed in ${rounds} round(s) with ${toolCalls} tool call(s) (${durationMs}ms)`,
            { rounds, toolCalls }, durationMs);
    }

    sessionFailed(error: string, failureClass?: string): void {
        this.emitError("session.failed", error, failureClass);
    }

    sessionCancelled(): void {
        this.emit("session.cancelled", "warn", "Session cancelled by user");
    }

    // Tool events
    toolStarted(toolName: string, round: number): void {
        this.emit("tool.started", "info", `🔧 ${toolName} (round ${round})`,
            { toolName, round });
    }

    toolCompleted(toolName: string, durationMs: number, resultPreview?: string): void {
        this.emit("tool.completed", "info",
            `✅ ${toolName} completed (${durationMs}ms)`,
            { toolName, resultPreview: resultPreview?.slice(0, 200) }, durationMs);
    }

    toolFailed(toolName: string, error: string, failureClass?: string): void {
        this.emitError("tool.failed", `${toolName}: ${error}`, failureClass, { toolName });
    }

    toolSkipped(toolName: string, reason: string): void {
        this.emit("tool.skipped", "warn", `⏭️ ${toolName} skipped: ${reason}`,
            { toolName, reason });
    }

    // Composio events
    composioToolsLoaded(count: number, sampleTools?: string[]): void {
        this.emit("composio.tools_loaded", "info",
            `Composio loaded ${count} meta tools`,
            { count, sampleTools });
    }

    composioAuthRequired(service: string, authUrl?: string): void {
        this.emit("composio.auth_required", "warn",
            `🔑 ${service} authentication required`,
            { service, authUrl });
    }

    composioConnectionEstablished(service: string): void {
        this.emit("composio.connection_established", "info",
            `✅ ${service} connected via Composio`,
            { service });
    }

    // Recovery events
    recoveryStarted(scenario: string): void {
        this.emit("recovery.started", "warn",
            `🔄 Auto-recovery started: ${scenario}`, { scenario });
    }

    recoverySucceeded(scenario: string, stepsTaken: number): void {
        this.emit("recovery.succeeded", "info",
            `✅ Recovered from ${scenario} (${stepsTaken} step(s))`,
            { scenario, stepsTaken });
    }

    recoveryFailed(scenario: string, reason: string): void {
        this.emitError("recovery.failed", `Recovery failed for ${scenario}: ${reason}`,
            undefined, { scenario });
    }

    recoveryEscalated(scenario: string, policy: string): void {
        this.emit("recovery.escalated", "error",
            `⚠️ Escalated: ${scenario} (policy: ${policy})`,
            { scenario, policy });
    }

    // Model events
    modelRequestSent(model: string, inputTokens?: number): void {
        this.emit("model.request_sent", "debug",
            `→ Request sent to ${model}`,
            { model, inputTokens });
    }

    modelResponseReceived(model: string, outputTokens?: number): void {
        this.emit("model.response_received", "debug",
            `← Response from ${model}`,
            { model, outputTokens });
    }

    modelRoundCompleted(round: number, toolCallCount: number): void {
        this.emit("model.round_completed", "info",
            `Round ${round} completed (${toolCallCount} tool calls)`,
            { round, toolCallCount });
    }

    // Agent state events
    agentStateChanged(from: string, to: string, detail?: string): void {
        this.emit("agent.state_changed", "debug",
            `State: ${from} → ${to}${detail ? ` (${detail})` : ""}`,
            { from, to });
    }

    agentToolRouting(totalTools: number, filteredTools: number, intent?: string): void {
        this.emit("agent.tool_routing", "debug",
            `Tool routing: ${filteredTools} of ${totalTools} tools selected${intent ? ` (intent: ${intent})` : ""}`,
            { totalTools, filteredTools, intent });
    }

    // ── Core Emit ───────────────────────────────────────────────────

    private emit(
        type: AgentEventType,
        severity: EventSeverity,
        message: string,
        data?: Record<string, unknown>,
        durationMs?: number,
    ): void {
        const event: AgentEvent = {
            type,
            severity,
            timestamp: new Date().toISOString(),
            message,
            data,
            durationMs,
        };
        this.pushEvent(event);

        // Also log to console with appropriate level
        const consoleFn = severity === "error" ? console.error
            : severity === "warn" ? console.warn
            : severity === "debug" ? console.debug
            : console.log;
        consoleFn(`[Agent] ${message}`);
    }

    private emitError(
        type: AgentEventType,
        message: string,
        failureClass?: string,
        data?: Record<string, unknown>,
    ): void {
        const event: AgentEvent = {
            type,
            severity: "error",
            timestamp: new Date().toISOString(),
            message,
            data,
            error: { message, failureClass },
        };
        this.pushEvent(event);
        console.error(`[Agent] ❌ ${message}`);
    }

    private pushEvent(event: AgentEvent): void {
        this.events.push(event);
        // Trim history
        if (this.events.length > this.maxHistory) {
            this.events = this.events.slice(-this.maxHistory);
        }
        // Notify listeners
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // Defensive — listeners should not throw
            }
        }
    }
}

// ── Singleton for the agent process ─────────────────────────────────

let globalEmitter: AgentEventEmitter | null = null;

export function getAgentEventEmitter(): AgentEventEmitter {
    if (!globalEmitter) {
        globalEmitter = new AgentEventEmitter();
    }
    return globalEmitter;
}

/**
 * Create a fresh event emitter for a new agent session.
 * Call this at the start of each /api/agent request.
 */
export function createSessionEmitter(): AgentEventEmitter {
    return new AgentEventEmitter();
}
