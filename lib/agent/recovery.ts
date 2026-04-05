/**
 * Recovery Recipes — Auto-healing failure system
 *
 * Inspired by claw-code's recovery_recipes.rs pattern.
 * Encodes known failure scenarios → recovery steps → escalation policies.
 * Each recipe enforces one automatic recovery attempt before escalation.
 *
 * Usage in agent loop:
 *   const ctx = new RecoveryContext();
 *   const result = await attemptRecovery("tool_timeout", ctx, { toolName, args });
 */

// ── Failure Scenarios ────────────────────────────────────────────────

export type FailureScenario =
    | "composio_auth_required"
    | "composio_tool_failed"
    | "tool_timeout"
    | "tool_execution_error"
    | "api_rate_limit"
    | "api_provider_error"
    | "sandbox_timeout"
    | "browser_navigation_error"
    | "context_overflow"
    | "sub_agent_failed";

// ── Recovery Steps ──────────────────────────────────────────────────

export type RecoveryStep =
    | { type: "retry"; delayMs: number }
    | { type: "retry_with_backoff"; baseMs: number; maxMs: number }
    | { type: "present_auth_link" }
    | { type: "switch_tool"; fallbackTool: string }
    | { type: "compact_context" }
    | { type: "extend_timeout"; multiplier: number }
    | { type: "restart_sandbox" }
    | { type: "simplify_request" }
    | { type: "escalate_to_user"; reason: string };

// ── Escalation Policy ───────────────────────────────────────────────

export type EscalationPolicy =
    | "alert_user"      // Tell the user what happened + what they need to do
    | "log_and_continue" // Log the failure, skip the tool, continue the task
    | "abort";           // Stop the entire task

// ── Recovery Recipe ─────────────────────────────────────────────────

export interface RecoveryRecipe {
    scenario: FailureScenario;
    steps: RecoveryStep[];
    maxAttempts: number;
    escalationPolicy: EscalationPolicy;
    /** Human-readable description for logging */
    description: string;
}

// ── Recipe Registry ─────────────────────────────────────────────────

const RECIPES: Record<FailureScenario, RecoveryRecipe> = {
    composio_auth_required: {
        scenario: "composio_auth_required",
        steps: [
            { type: "present_auth_link" },
        ],
        maxAttempts: 1,
        escalationPolicy: "alert_user",
        description: "Composio service not connected — present auth link to user",
    },
    composio_tool_failed: {
        scenario: "composio_tool_failed",
        steps: [
            { type: "retry", delayMs: 1000 },
        ],
        maxAttempts: 2,
        escalationPolicy: "alert_user",
        description: "Composio tool execution failed — retry once, then alert user",
    },
    tool_timeout: {
        scenario: "tool_timeout",
        steps: [
            { type: "extend_timeout", multiplier: 2 },
            { type: "retry", delayMs: 500 },
        ],
        maxAttempts: 2,
        escalationPolicy: "log_and_continue",
        description: "Tool execution timed out — extend timeout and retry",
    },
    tool_execution_error: {
        scenario: "tool_execution_error",
        steps: [
            { type: "retry", delayMs: 500 },
        ],
        maxAttempts: 1,
        escalationPolicy: "log_and_continue",
        description: "Tool returned an error — retry once, then skip",
    },
    api_rate_limit: {
        scenario: "api_rate_limit",
        steps: [
            { type: "retry_with_backoff", baseMs: 2000, maxMs: 30000 },
        ],
        maxAttempts: 3,
        escalationPolicy: "alert_user",
        description: "API rate limit hit — exponential backoff retry",
    },
    api_provider_error: {
        scenario: "api_provider_error",
        steps: [
            { type: "retry_with_backoff", baseMs: 1000, maxMs: 10000 },
        ],
        maxAttempts: 2,
        escalationPolicy: "abort",
        description: "API provider error (5xx) — retry with backoff, then abort",
    },
    sandbox_timeout: {
        scenario: "sandbox_timeout",
        steps: [
            { type: "extend_timeout", multiplier: 3 },
            { type: "restart_sandbox" },
            { type: "retry", delayMs: 1000 },
        ],
        maxAttempts: 1,
        escalationPolicy: "alert_user",
        description: "Sandbox execution timed out — restart and retry",
    },
    browser_navigation_error: {
        scenario: "browser_navigation_error",
        steps: [
            { type: "retry", delayMs: 2000 },
        ],
        maxAttempts: 2,
        escalationPolicy: "log_and_continue",
        description: "Browser navigation failed — retry with delay",
    },
    context_overflow: {
        scenario: "context_overflow",
        steps: [
            { type: "compact_context" },
        ],
        maxAttempts: 1,
        escalationPolicy: "alert_user",
        description: "Context window overflow — compact conversation history",
    },
    sub_agent_failed: {
        scenario: "sub_agent_failed",
        steps: [
            { type: "simplify_request" },
            { type: "retry", delayMs: 1000 },
        ],
        maxAttempts: 1,
        escalationPolicy: "log_and_continue",
        description: "Sub-agent delegation failed — simplify and retry",
    },
};

// ── Recovery Result ─────────────────────────────────────────────────

export type RecoveryResult =
    | { status: "recovered"; stepsTaken: number; message: string }
    | { status: "partial"; recovered: RecoveryStep[]; remaining: RecoveryStep[] }
    | { status: "escalation_required"; reason: string; policy: EscalationPolicy };

// ── Recovery Event (for typed event stream) ─────────────────────────

export interface RecoveryEvent {
    type: "recovery_attempted" | "recovery_succeeded" | "recovery_failed" | "escalated";
    scenario: FailureScenario;
    recipe?: RecoveryRecipe;
    result?: RecoveryResult;
    timestamp: string;
}

// ── Recovery Context ────────────────────────────────────────────────

export class RecoveryContext {
    private attempts: Map<FailureScenario, number> = new Map();
    private events: RecoveryEvent[] = [];

    getAttemptCount(scenario: FailureScenario): number {
        return this.attempts.get(scenario) ?? 0;
    }

    incrementAttempt(scenario: FailureScenario): number {
        const current = this.getAttemptCount(scenario);
        this.attempts.set(scenario, current + 1);
        return current + 1;
    }

    addEvent(event: RecoveryEvent): void {
        this.events.push(event);
    }

    getEvents(): RecoveryEvent[] {
        return [...this.events];
    }

    /** Reset attempt count for a scenario (e.g., after successful recovery) */
    resetAttempts(scenario: FailureScenario): void {
        this.attempts.delete(scenario);
    }
}

// ── Core Recovery Logic ─────────────────────────────────────────────

export function getRecipe(scenario: FailureScenario): RecoveryRecipe {
    return RECIPES[scenario];
}

/**
 * Classify a tool execution error into a FailureScenario.
 * Returns undefined if the error doesn't match any known scenario.
 */
export function classifyError(
    error: unknown,
    context?: { toolName?: string; statusCode?: number }
): FailureScenario | undefined {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();

    // Composio auth / connection issues
    if (context?.toolName?.startsWith("COMPOSIO_") || lower.includes("composio")) {
        if (lower.includes("not connected") || lower.includes("auth") || lower.includes("redirect")) {
            return "composio_auth_required";
        }
        return "composio_tool_failed";
    }

    // API rate limits
    if (context?.statusCode === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
        return "api_rate_limit";
    }

    // API provider errors (5xx)
    if (context?.statusCode && context.statusCode >= 500) {
        return "api_provider_error";
    }

    // Timeouts
    if (lower.includes("timeout") || lower.includes("timed out") || lower.includes("econnreset")) {
        if (lower.includes("sandbox") || lower.includes("e2b")) {
            return "sandbox_timeout";
        }
        return "tool_timeout";
    }

    // Context overflow
    if (lower.includes("context") && (lower.includes("overflow") || lower.includes("too long") || lower.includes("maximum"))) {
        return "context_overflow";
    }

    // Browser errors
    if (lower.includes("navigation") || lower.includes("browser") || lower.includes("puppeteer")) {
        return "browser_navigation_error";
    }

    // Sub-agent failures
    if (lower.includes("sub-agent") || lower.includes("delegation") || lower.includes("handoff")) {
        return "sub_agent_failed";
    }

    // Generic tool errors
    if (lower.includes("error") || lower.includes("failed") || lower.includes("exception")) {
        return "tool_execution_error";
    }

    return undefined;
}

/**
 * Execute a recovery recipe for a given failure scenario.
 * Returns the recovery result and emits structured events.
 */
export async function attemptRecovery(
    scenario: FailureScenario,
    ctx: RecoveryContext,
    stepExecutor?: (step: RecoveryStep) => Promise<boolean>,
): Promise<RecoveryResult> {
    const recipe = getRecipe(scenario);
    const attemptCount = ctx.getAttemptCount(scenario);
    const now = new Date().toISOString();

    // Enforce max attempts before escalation
    if (attemptCount >= recipe.maxAttempts) {
        const result: RecoveryResult = {
            status: "escalation_required",
            reason: `Max recovery attempts (${recipe.maxAttempts}) exceeded for ${scenario}`,
            policy: recipe.escalationPolicy,
        };
        ctx.addEvent({
            type: "escalated",
            scenario,
            recipe,
            result,
            timestamp: now,
        });
        return result;
    }

    ctx.incrementAttempt(scenario);

    // Execute recovery steps
    const executed: RecoveryStep[] = [];
    let failed = false;

    for (const step of recipe.steps) {
        try {
            if (stepExecutor) {
                const success = await stepExecutor(step);
                if (!success) {
                    failed = true;
                    break;
                }
            } else {
                // Default step execution: just handle delays
                await executeDefaultStep(step);
            }
            executed.push(step);
        } catch {
            failed = true;
            break;
        }
    }

    let result: RecoveryResult;

    if (failed) {
        const remaining = recipe.steps.slice(executed.length);
        if (executed.length === 0) {
            result = {
                status: "escalation_required",
                reason: `Recovery failed at first step for ${scenario}`,
                policy: recipe.escalationPolicy,
            };
            ctx.addEvent({ type: "recovery_failed", scenario, recipe, result, timestamp: now });
        } else {
            result = { status: "partial", recovered: executed, remaining };
            ctx.addEvent({ type: "recovery_failed", scenario, recipe, result, timestamp: now });
        }
    } else {
        result = {
            status: "recovered",
            stepsTaken: recipe.steps.length,
            message: `Successfully recovered from ${scenario} in ${recipe.steps.length} step(s)`,
        };
        ctx.addEvent({ type: "recovery_succeeded", scenario, recipe, result, timestamp: now });
        ctx.resetAttempts(scenario);
    }

    return result;
}

/**
 * Default step executor — handles delays/backoff.
 * More complex steps (present_auth_link, restart_sandbox, etc.)
 * should be handled by a custom stepExecutor.
 */
async function executeDefaultStep(step: RecoveryStep): Promise<void> {
    switch (step.type) {
        case "retry":
            await sleep(step.delayMs);
            break;
        case "retry_with_backoff":
            // The actual backoff multiplier should be tracked externally;
            // for default execution, use baseMs
            await sleep(step.baseMs);
            break;
        case "extend_timeout":
        case "compact_context":
        case "simplify_request":
        case "present_auth_link":
        case "switch_tool":
        case "restart_sandbox":
        case "escalate_to_user":
            // These are no-op in default execution — the caller's
            // stepExecutor should handle them
            break;
    }
}

/**
 * Format a recovery result as a human-readable message for the agent's response.
 */
export function formatRecoveryMessage(
    scenario: FailureScenario,
    result: RecoveryResult
): string {
    const recipe = getRecipe(scenario);

    switch (result.status) {
        case "recovered":
            return `✅ Auto-recovered from ${recipe.description}`;

        case "partial":
            return `⚠️ Partial recovery for ${recipe.description}. ` +
                `Completed ${result.recovered.length} of ${result.recovered.length + result.remaining.length} steps.`;

        case "escalation_required":
            switch (result.policy) {
                case "alert_user":
                    return `❌ ${recipe.description}. ${result.reason}. ` +
                        `Please check your configuration and try again.`;
                case "log_and_continue":
                    return `⚠️ ${recipe.description}. Skipping this step and continuing.`;
                case "abort":
                    return `🛑 ${recipe.description}. ${result.reason}. Task aborted.`;
            }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
