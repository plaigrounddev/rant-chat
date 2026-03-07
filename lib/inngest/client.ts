/**
 * Inngest Client
 *
 * Central Inngest client instance for RantChat.
 * All workflow functions use this client to register with Inngest.
 */

import { Inngest } from "inngest";

// ── Event Types ────────────────────────────────────────────────────────────

export interface WorkflowEventData {
    /** Unique run ID for tracking */
    runId: string;
    /** The user's instructions for this workflow */
    instructions: string;
    /** Preferred model provider: "openai" | "anthropic" | "google" | "auto" */
    modelPreference?: string;
    /** Whether to notify the user when done */
    notifyWhenDone?: boolean;
    /** Additional context or data for the workflow */
    context?: Record<string, unknown>;
}

export type InngestEvents = {
    "workflow/deep-research": { data: WorkflowEventData };
    "workflow/build-app": { data: WorkflowEventData };
    "workflow/review-document": { data: WorkflowEventData & { documentUrl?: string; documentContent?: string } };
    "workflow/code-generation": { data: WorkflowEventData & { language?: string; framework?: string } };
    "workflow/process-data": { data: WorkflowEventData & { inputData?: string } };
    "workflow/monitor-service": { data: WorkflowEventData & { url: string; intervalMinutes?: number } };
    "workflow/agent-team": { data: WorkflowEventData & { teamRoles?: string[] } };
};

// ── Client ─────────────────────────────────────────────────────────────────

export const inngest = new Inngest({
    id: "rantchat",
    schemas: new Map() as never, // typed via generic
});
