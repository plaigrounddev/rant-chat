/**
 * Convex HTTP Client for Inngest
 *
 * Allows Inngest workflow functions to call Convex mutations
 * to update workflow state and push results to threads.
 *
 * Uses the Convex HTTP API with an admin/deploy key for
 * server-to-server communication (no auth context needed).
 */

/**
 * Call a Convex mutation from server-side code (Inngest workflows).
 * Uses the Convex HTTP API directly.
 */
export async function callConvexMutation(
    functionPath: string,
    args: Record<string, unknown>,
): Promise<unknown> {
    // Read env vars per-call (not module-level) to avoid stale captures
    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    const adminKey = process.env.CONVEX_DEPLOY_KEY;

    if (!convexUrl) {
        console.warn("[convex-bridge] NEXT_PUBLIC_CONVEX_URL not set, skipping mutation:", functionPath);
        return null;
    }

    const httpUrl = convexUrl.replace(/\/$/, "");

    const response = await fetch(`${httpUrl}/api/mutation`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(adminKey ? { Authorization: `Convex ${adminKey}` } : {}),
        },
        body: JSON.stringify({
            path: functionPath,
            args,
            format: "json",
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`[convex-bridge] Mutation ${functionPath} failed:`, text);
        throw new Error(`Convex mutation failed: ${text}`);
    }

    return response.json();
}

/**
 * Convenience wrappers for common workflow operations
 */
export const convexBridge = {
    /**
     * Update a workflow step's status
     */
    async updateWorkflowStep(
        runId: string,
        stepId: string,
        status: "pending" | "running" | "completed" | "failed",
        result?: string,
    ) {
        return callConvexMutation("workflows:updateStep", {
            runId,
            stepId,
            status,
            result,
        });
    },

    /**
     * Complete a workflow and announce result to thread
     */
    async completeWorkflow(runId: string, result: string) {
        return callConvexMutation("workflows:complete", {
            runId,
            result,
        });
    },

    /**
     * Mark a workflow as failed
     */
    async failWorkflow(runId: string, error: string) {
        return callConvexMutation("workflows:fail", {
            runId,
            error,
        });
    },

    /**
     * Send a message to a thread (for non-workflow announcements)
     */
    async sendMessage(threadId: string, content: string, role: "assistant" | "system" = "assistant") {
        return callConvexMutation("messages:sendSystem", {
            threadId,
            content,
            role,
        });
    },
};
