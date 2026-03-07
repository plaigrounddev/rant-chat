/**
 * Workflow State Manager — Manus-Style Three-File System
 *
 * Each workflow run maintains 3 state files:
 * - task_plan.md: Steps with progress tracking ([ ] / [/] / [x])
 * - notes.md: Accumulated research findings and intermediate results
 * - context.md: Current awareness — what's been done, what's next
 *
 * State is stored in data/workflows/{runId}/
 * (file-based now, swappable to DB for multi-tenant later)
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowState {
    runId: string;
    workflowType: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
    startedAt: string;
    completedAt?: string;
    error?: string;
    result?: string;
    steps: WorkflowStep[];
}

export interface WorkflowStep {
    id: string;
    name: string;
    status: "pending" | "running" | "completed" | "failed";
    startedAt?: string;
    completedAt?: string;
    result?: string;
    model?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const WORKFLOWS_DIR = path.join(process.cwd(), "data", "workflows");

// ── Helpers ────────────────────────────────────────────────────────────────

function getWorkflowDir(runId: string): string {
    return path.join(WORKFLOWS_DIR, runId);
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// ── State Manager ──────────────────────────────────────────────────────────

export const workflowState = {
    /**
     * Generate a unique run ID
     */
    generateRunId(): string {
        const timestamp = Date.now().toString(36);
        const random = crypto.randomBytes(4).toString("hex");
        return `wf_${timestamp}_${random}`;
    },

    /**
     * Initialize a new workflow run with the three-file system
     */
    init(runId: string, workflowType: string, instructions: string, steps: string[]): WorkflowState {
        const dir = getWorkflowDir(runId);
        ensureDir(dir);

        const state: WorkflowState = {
            runId,
            workflowType,
            status: "running",
            startedAt: new Date().toISOString(),
            steps: steps.map((name, i) => ({
                id: `step_${i}`,
                name,
                status: "pending",
            })),
        };

        // Write state.json
        fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));

        // Write task_plan.md
        const plan = [
            `# Workflow: ${workflowType}`,
            `**Run ID**: ${runId}`,
            `**Started**: ${state.startedAt}`,
            `**Instructions**: ${instructions}`,
            "",
            "## Steps",
            ...steps.map((s) => `- [ ] ${s}`),
        ].join("\n");
        fs.writeFileSync(path.join(dir, "task_plan.md"), plan);

        // Write notes.md (empty initially)
        fs.writeFileSync(path.join(dir, "notes.md"), `# Notes — ${workflowType}\n\n`);

        // Write context.md
        const context = [
            `# Context — ${workflowType}`,
            "",
            `## Current Status`,
            `Starting workflow with ${steps.length} steps.`,
            "",
            `## Instructions`,
            instructions,
        ].join("\n");
        fs.writeFileSync(path.join(dir, "context.md"), context);

        return state;
    },

    /**
     * Get the current state of a workflow run
     */
    get(runId: string): WorkflowState | null {
        const file = path.join(getWorkflowDir(runId), "state.json");
        if (!fs.existsSync(file)) return null;
        return JSON.parse(fs.readFileSync(file, "utf8")) as WorkflowState;
    },

    /**
     * Update a step's status
     */
    updateStep(runId: string, stepId: string, update: Partial<WorkflowStep>): void {
        const state = this.get(runId);
        if (!state) return;

        const step = state.steps.find((s) => s.id === stepId);
        if (step) {
            Object.assign(step, update);
        }

        // Also update task_plan.md
        const dir = getWorkflowDir(runId);
        const plan = [
            `# Workflow: ${state.workflowType}`,
            `**Run ID**: ${runId}`,
            `**Started**: ${state.startedAt}`,
            "",
            "## Steps",
            ...state.steps.map((s) => {
                const marker = s.status === "completed" ? "x" : s.status === "running" ? "/" : " ";
                const suffix = s.result ? ` — ${s.result.substring(0, 100)}` : "";
                return `- [${marker}] ${s.name}${suffix}`;
            }),
        ].join("\n");
        fs.writeFileSync(path.join(dir, "task_plan.md"), plan);
        fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
    },

    /**
     * Append notes from a step
     */
    appendNotes(runId: string, stepName: string, notes: string): void {
        const file = path.join(getWorkflowDir(runId), "notes.md");
        if (!fs.existsSync(file)) return;
        const entry = `\n## ${stepName}\n_${new Date().toISOString()}_\n\n${notes}\n`;
        fs.appendFileSync(file, entry);
    },

    /**
     * Update the context file
     */
    updateContext(runId: string, context: string): void {
        const file = path.join(getWorkflowDir(runId), "context.md");
        const dir = getWorkflowDir(runId);
        ensureDir(dir);
        fs.writeFileSync(file, context);
    },

    /**
     * Mark workflow as completed
     */
    complete(runId: string, result: string): void {
        const state = this.get(runId);
        if (!state) return;
        state.status = "completed";
        state.completedAt = new Date().toISOString();
        state.result = result;
        const dir = getWorkflowDir(runId);
        fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
    },

    /**
     * Mark workflow as failed
     */
    fail(runId: string, error: string): void {
        const state = this.get(runId);
        if (!state) return;
        state.status = "failed";
        state.completedAt = new Date().toISOString();
        state.error = error;
        const dir = getWorkflowDir(runId);
        fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
    },

    /**
     * Cancel a workflow
     */
    cancel(runId: string): boolean {
        const state = this.get(runId);
        if (!state || state.status !== "running") return false;
        state.status = "cancelled";
        state.completedAt = new Date().toISOString();
        const dir = getWorkflowDir(runId);
        fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
        return true;
    },

    /**
     * List all workflow runs
     */
    listAll(): WorkflowState[] {
        if (!fs.existsSync(WORKFLOWS_DIR)) return [];
        const dirs = fs.readdirSync(WORKFLOWS_DIR);
        return dirs
            .map((d) => this.get(d))
            .filter((s): s is WorkflowState => s !== null)
            .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    },

    /**
     * Get the full notes for a workflow
     */
    getNotes(runId: string): string | null {
        const file = path.join(getWorkflowDir(runId), "notes.md");
        if (!fs.existsSync(file)) return null;
        return fs.readFileSync(file, "utf8");
    },

    /**
     * Get the full context for a workflow
     */
    getContext(runId: string): string | null {
        const file = path.join(getWorkflowDir(runId), "context.md");
        if (!fs.existsSync(file)) return null;
        return fs.readFileSync(file, "utf8");
    },
};
