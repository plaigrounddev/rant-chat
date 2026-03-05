/**
 * Task Store — Execution Monitoring
 *
 * Mirrors Lindy AI's Tasks view: logs every step of every agent run
 * for real-time monitoring and debugging.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type TaskStepStatus = "running" | "completed" | "error";
export type TaskRunStatus = "running" | "completed" | "error";

export interface TaskStep {
    id: string;
    type: "tool_call" | "reasoning" | "response" | "error";
    name: string;
    input?: unknown;
    output?: unknown;
    status: TaskStepStatus;
    startedAt: string;
    completedAt?: string;
    duration?: number; // ms
    error?: string;
}

export interface TaskRun {
    id: string;
    status: TaskRunStatus;
    userMessage: string;
    steps: TaskStep[];
    toolRounds: number;
    startedAt: string;
    completedAt?: string;
    error?: string;
}

// ── Store ──────────────────────────────────────────────────────────────────

const MAX_HISTORY = 100;
const taskHistory: TaskRun[] = [];

function generateStepId(): string {
    return `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

class TaskStore {
    createRun(userMessage: string): TaskRun {
        const run: TaskRun = {
            id: `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            status: "running",
            userMessage,
            steps: [],
            toolRounds: 0,
            startedAt: new Date().toISOString(),
        };
        taskHistory.unshift(run);
        // Trim history
        if (taskHistory.length > MAX_HISTORY) {
            taskHistory.length = MAX_HISTORY;
        }
        return run;
    }

    addStep(
        runId: string,
        step: Omit<TaskStep, "id" | "startedAt">
    ): TaskStep | null {
        const run = taskHistory.find((r) => r.id === runId);
        if (!run) return null;

        const fullStep: TaskStep = {
            ...step,
            id: generateStepId(),
            startedAt: new Date().toISOString(),
        };
        run.steps.push(fullStep);
        return fullStep;
    }

    completeStep(
        runId: string,
        stepId: string,
        output: unknown,
        status: TaskStepStatus = "completed"
    ) {
        const run = taskHistory.find((r) => r.id === runId);
        if (!run) return;

        const step = run.steps.find((s) => s.id === stepId);
        if (!step) return;

        step.output = output;
        step.status = status;
        step.completedAt = new Date().toISOString();
        step.duration =
            new Date(step.completedAt).getTime() -
            new Date(step.startedAt).getTime();
    }

    incrementToolRound(runId: string) {
        const run = taskHistory.find((r) => r.id === runId);
        if (run) run.toolRounds++;
    }

    completeRun(runId: string, status: TaskRunStatus = "completed", error?: string) {
        const run = taskHistory.find((r) => r.id === runId);
        if (!run) return;

        run.status = status;
        run.completedAt = new Date().toISOString();
        if (error) run.error = error;
    }

    getRun(runId: string): TaskRun | undefined {
        return taskHistory.find((r) => r.id === runId);
    }

    getHistory(limit = 20): TaskRun[] {
        return taskHistory.slice(0, limit);
    }

    getStats() {
        const total = taskHistory.length;
        const completed = taskHistory.filter((r) => r.status === "completed").length;
        const errors = taskHistory.filter((r) => r.status === "error").length;
        const avgSteps =
            total > 0
                ? Math.round(
                    taskHistory.reduce((sum, r) => sum + r.steps.length, 0) / total
                )
                : 0;

        return { total, completed, errors, avgSteps };
    }
}

export const taskStore = new TaskStore();
