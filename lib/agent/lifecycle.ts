/**
 * Agent Lifecycle State Machine
 *
 * Inspired by claw-code's worker_boot.rs pattern.
 * Provides explicit lifecycle states for agent sessions so the UI
 * can show exactly what the agent is doing at any point.
 *
 * States:
 *   initializing → ready → thinking → using_tool → waiting_for_auth → responding → completed/failed
 *
 * Each transition emits a typed AgentLifecycleEvent.
 */

// ── Lifecycle States ────────────────────────────────────────────────

export type AgentState =
    | "initializing"     // Loading tools, building prompt
    | "ready"            // Ready to process user message
    | "thinking"         // LLM is generating (no tool call yet)
    | "using_tool"       // Executing a tool call
    | "waiting_for_auth" // Blocked on user authentication (e.g. Composio)
    | "recovering"       // Auto-recovery in progress
    | "responding"       // Streaming final text response
    | "completed"        // Task finished successfully
    | "failed"           // Task failed (with error details)
    | "cancelled";       // User cancelled

// ── Failure Classification ──────────────────────────────────────────

export type FailureClass =
    | "tool_runtime"     // Tool execution error
    | "api_error"        // OpenAI / provider error
    | "auth_required"    // User auth needed
    | "rate_limit"       // API rate limit
    | "timeout"          // Operation timed out
    | "context_overflow" // Token limit exceeded
    | "config_error"     // Missing env var / config
    | "unknown";         // Unclassified

// ── Lifecycle Events ────────────────────────────────────────────────

export interface AgentLifecycleEvent {
    type: AgentLifecycleEventType;
    state: AgentState;
    previousState?: AgentState;
    timestamp: string;
    detail?: string;
    data?: Record<string, unknown>;
}

export type AgentLifecycleEventType =
    | "state_changed"
    | "tool_started"
    | "tool_completed"
    | "tool_failed"
    | "recovery_started"
    | "recovery_completed"
    | "error_classified"
    | "round_completed";

// ── Lifecycle Manager ───────────────────────────────────────────────

export class AgentLifecycle {
    private state: AgentState = "initializing";
    private events: AgentLifecycleEvent[] = [];
    private listeners: Array<(event: AgentLifecycleEvent) => void> = [];

    // ── Current tool tracking ───────────────────────────────────────
    private currentToolName: string | null = null;
    private currentToolStartTime: number | null = null;
    private toolRound = 0;
    private totalToolCalls = 0;

    // ── Error tracking ──────────────────────────────────────────────
    private lastError: string | null = null;
    private lastFailureClass: FailureClass | null = null;

    // ── Public API ──────────────────────────────────────────────────

    getState(): AgentState {
        return this.state;
    }

    getRound(): number {
        return this.toolRound;
    }

    getTotalToolCalls(): number {
        return this.totalToolCalls;
    }

    getCurrentTool(): string | null {
        return this.currentToolName;
    }

    getLastError(): string | null {
        return this.lastError;
    }

    getLastFailureClass(): FailureClass | null {
        return this.lastFailureClass;
    }

    getEvents(): AgentLifecycleEvent[] {
        return [...this.events];
    }

    /** Subscribe to lifecycle events (for SSE streaming) */
    onEvent(listener: (event: AgentLifecycleEvent) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }

    // ── State Transitions ───────────────────────────────────────────

    /** Call when agent starts initializing (loading tools, building prompt) */
    markInitializing(detail?: string): void {
        this.transition("initializing", "state_changed", detail);
    }

    /** Call when agent is ready and about to send to LLM */
    markReady(detail?: string): void {
        this.transition("ready", "state_changed", detail);
    }

    /** Call when LLM starts generating (first SSE event received) */
    markThinking(detail?: string): void {
        this.transition("thinking", "state_changed", detail);
    }

    /** Call when a tool call starts executing */
    markToolStarted(toolName: string): void {
        this.currentToolName = toolName;
        this.currentToolStartTime = Date.now();
        this.totalToolCalls++;
        this.transition("using_tool", "tool_started", `Executing: ${toolName}`, {
            toolName,
            round: this.toolRound,
            totalCalls: this.totalToolCalls,
        });
    }

    /** Call when a tool call completes successfully */
    markToolCompleted(toolName: string, durationMs?: number): void {
        const duration = durationMs ?? (this.currentToolStartTime ? Date.now() - this.currentToolStartTime : 0);
        this.emit({
            type: "tool_completed",
            state: this.state,
            timestamp: new Date().toISOString(),
            detail: `${toolName} completed in ${duration}ms`,
            data: { toolName, durationMs: duration },
        });
        this.currentToolName = null;
        this.currentToolStartTime = null;
    }

    /** Call when a tool call fails */
    markToolFailed(toolName: string, error: string, failureClass?: FailureClass): void {
        this.lastError = error;
        this.lastFailureClass = failureClass ?? "tool_runtime";
        this.emit({
            type: "tool_failed",
            state: this.state,
            timestamp: new Date().toISOString(),
            detail: `${toolName} failed: ${error}`,
            data: { toolName, error, failureClass: this.lastFailureClass },
        });
        this.currentToolName = null;
        this.currentToolStartTime = null;
    }

    /** Call when blocked on user auth (e.g. Composio) */
    markWaitingForAuth(service: string, authUrl?: string): void {
        this.transition("waiting_for_auth", "state_changed",
            `Waiting for ${service} authentication`, { service, authUrl });
    }

    /** Call when auto-recovery starts */
    markRecovering(scenario: string): void {
        this.transition("recovering", "recovery_started",
            `Auto-recovering from: ${scenario}`, { scenario });
    }

    /** Call when auto-recovery completes */
    markRecoveryCompleted(scenario: string, success: boolean): void {
        this.emit({
            type: "recovery_completed",
            state: this.state,
            timestamp: new Date().toISOString(),
            detail: success ? `Recovered from ${scenario}` : `Recovery failed for ${scenario}`,
            data: { scenario, success },
        });
    }

    /** Call when a tool round completes (all parallel tool calls done) */
    markRoundCompleted(): void {
        this.toolRound++;
        this.emit({
            type: "round_completed",
            state: this.state,
            timestamp: new Date().toISOString(),
            detail: `Tool round ${this.toolRound} completed`,
            data: { round: this.toolRound, totalCalls: this.totalToolCalls },
        });
    }

    /** Call when streaming the final text response */
    markResponding(detail?: string): void {
        this.transition("responding", "state_changed", detail);
    }

    /** Call when the task completes successfully */
    markCompleted(summary?: string): void {
        this.transition("completed", "state_changed",
            summary ?? `Completed in ${this.toolRound} round(s) with ${this.totalToolCalls} tool call(s)`);
    }

    /** Call when the task fails */
    markFailed(error: string, failureClass?: FailureClass): void {
        this.lastError = error;
        this.lastFailureClass = failureClass ?? "unknown";
        this.transition("failed", "error_classified", error, {
            failureClass: this.lastFailureClass,
        });
    }

    /** Call when user cancels the task */
    markCancelled(): void {
        this.transition("cancelled", "state_changed", "Cancelled by user");
    }

    // ── Serialization ───────────────────────────────────────────────

    /** Serialize current state for SSE transmission */
    toSSEPayload(): Record<string, unknown> {
        return {
            agentState: this.state,
            currentTool: this.currentToolName,
            round: this.toolRound,
            totalToolCalls: this.totalToolCalls,
            lastError: this.lastError,
            lastFailureClass: this.lastFailureClass,
        };
    }

    // ── Private Helpers ─────────────────────────────────────────────

    private transition(
        newState: AgentState,
        eventType: AgentLifecycleEventType,
        detail?: string,
        data?: Record<string, unknown>,
    ): void {
        const previousState = this.state;
        this.state = newState;
        this.emit({
            type: eventType,
            state: newState,
            previousState,
            timestamp: new Date().toISOString(),
            detail,
            data,
        });
    }

    private emit(event: AgentLifecycleEvent): void {
        this.events.push(event);
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch {
                // Listeners should not throw, but be defensive
            }
        }
    }
}

// ── Classify errors into failure classes ─────────────────────────────

export function classifyFailure(error: unknown, context?: { statusCode?: number }): FailureClass {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    if (context?.statusCode === 429 || lower.includes("rate limit")) return "rate_limit";
    if (context?.statusCode && context.statusCode >= 500) return "api_error";
    if (lower.includes("timeout") || lower.includes("timed out")) return "timeout";
    if (lower.includes("auth") || lower.includes("not connected")) return "auth_required";
    if (lower.includes("context") && lower.includes("overflow")) return "context_overflow";
    if (lower.includes("api_key") || lower.includes("not configured")) return "config_error";

    return "tool_runtime";
}
