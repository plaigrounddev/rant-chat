/**
 * Agent Team Workflow
 *
 * Multi-agent orchestration — coordinates multiple specialist agents
 * that each contribute to a shared goal. Inspired by Manus AI and
 * the agency-agents orchestrator pattern.
 *
 * Pipeline: Planner → [Specialist agents] → QA Reviewer → Final report
 */

import { inngest } from "../client";
import { workflowState } from "../state";
import { selectModel, callModel } from "../models";

// Agent role definitions
const AGENT_ROLES: Record<string, { name: string; systemPrompt: string; bestModel: string }> = {
    planner: {
        name: "Project Planner",
        systemPrompt: `You are a senior project planner. Break down complex tasks into specific, actionable sub-tasks. Each sub-task should be self-contained and assigned to a specialist role. Return a JSON array of: [{ "task": "description", "role": "researcher|developer|analyst|writer|reviewer", "priority": 1-5 }]`,
        bestModel: "planning",
    },
    researcher: {
        name: "Research Specialist",
        systemPrompt: `You are a thorough research specialist. Investigate the given topic in depth, providing factual information with sources where possible. Be comprehensive but organized.`,
        bestModel: "general",
    },
    developer: {
        name: "Software Developer",
        systemPrompt: `You are an expert software developer. Write clean, production-quality code. Include error handling, types, and documentation.`,
        bestModel: "code-generation",
    },
    analyst: {
        name: "Data Analyst",
        systemPrompt: `You are a data analyst. Analyze information systematically, identify patterns, draw conclusions, and present findings clearly with supporting evidence.`,
        bestModel: "analysis",
    },
    writer: {
        name: "Content Writer",
        systemPrompt: `You are a professional writer. Create clear, well-structured, and engaging content. Adapt your tone and style to the context.`,
        bestModel: "creative-writing",
    },
    reviewer: {
        name: "Quality Reviewer",
        systemPrompt: `You are a quality reviewer. Evaluate work for accuracy, completeness, consistency, and quality. Provide specific, actionable feedback. Rate as PASS or NEEDS_WORK with detailed notes.`,
        bestModel: "reasoning",
    },
};

export const agentTeam = inngest.createFunction(
    {
        id: "workflow-agent-team",
        retries: 2,
    },
    { event: "workflow/agent-team" },
    async ({ event, step }) => {
        const { runId, instructions, modelPreference } = event.data;

        await step.run("init-state", async () => {
            return workflowState.init(runId, "agent-team", instructions, [
                "Plan and assign tasks",
                "Execute specialist work",
                "Quality review",
                "Compile final deliverable",
            ]);
        });

        // Step 1: Planner breaks down the task
        const taskPlan = await step.run("plan-tasks", async () => {
            workflowState.updateStep(runId, "step_0", { status: "running", startedAt: new Date().toISOString() });

            const planner = AGENT_ROLES.planner;
            const model = selectModel(planner.bestModel, modelPreference);
            const result = await callModel(
                model,
                planner.systemPrompt,
                `Project: ${instructions}\n\nAvailable specialist roles: researcher, developer, analyst, writer, reviewer. Break this into sub-tasks and assign each to the best role.`
            );

            workflowState.updateStep(runId, "step_0", { status: "completed", completedAt: new Date().toISOString(), result: "Task plan created" });
            workflowState.appendNotes(runId, "Task Plan", result);

            try {
                const parsed = JSON.parse(result.trim().replace(/```json?\n?/g, "").replace(/```/g, ""));
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [{ task: instructions, role: "researcher", priority: 1 }];
            }
        });

        // Step 2: Execute specialist work
        const results = await step.run("execute-specialists", async () => {
            workflowState.updateStep(runId, "step_1", { status: "running", startedAt: new Date().toISOString() });

            const taskResults: Array<{ task: string; role: string; result: string }> = [];

            // Sort by priority and execute sequentially
            const sortedTasks = [...taskPlan].sort((a: { priority: number }, b: { priority: number }) => a.priority - b.priority);

            for (const task of sortedTasks) {
                const agent = AGENT_ROLES[task.role] || AGENT_ROLES.researcher;
                const model = selectModel(agent.bestModel, modelPreference);

                const context = taskResults.length > 0
                    ? `\n\nContext from previous work:\n${taskResults.map((r) => `[${r.role}]: ${r.result.substring(0, 500)}`).join("\n")}`
                    : "";

                const result = await callModel(
                    model,
                    agent.systemPrompt,
                    `Task: ${task.task}${context}\n\nOverall project: ${instructions}`
                );
                taskResults.push({ task: task.task, role: task.role, result });
            }

            workflowState.updateStep(runId, "step_1", {
                status: "completed",
                completedAt: new Date().toISOString(),
                result: `${taskResults.length} tasks completed`,
            });
            workflowState.appendNotes(runId, "Specialist Results", taskResults.map((r) => `### ${r.role}: ${r.task}\n${r.result}`).join("\n\n---\n\n"));
            return taskResults;
        });

        // Step 3: QA Review
        const review = await step.run("qa-review", async () => {
            workflowState.updateStep(runId, "step_2", { status: "running", startedAt: new Date().toISOString() });

            const reviewer = AGENT_ROLES.reviewer;
            const model = selectModel(reviewer.bestModel, modelPreference);
            const allWork = results.map((r) => `## ${r.role}: ${r.task}\n${r.result}`).join("\n\n---\n\n");

            const result = await callModel(
                model,
                reviewer.systemPrompt,
                `Review the following deliverables against the original requirements:\n\nOriginal request: ${instructions}\n\nDeliverables:\n${allWork}`
            );

            workflowState.updateStep(runId, "step_2", { status: "completed", completedAt: new Date().toISOString(), result: "QA review done" });
            return result;
        });

        // Step 4: Compile final deliverable
        const deliverable = await step.run("compile-deliverable", async () => {
            workflowState.updateStep(runId, "step_3", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("general", modelPreference);
            const allWork = results.map((r) => `## ${r.role}: ${r.task}\n${r.result}`).join("\n\n---\n\n");

            const result = await callModel(
                model,
                `You are an editor. Compile all the specialist work below into a single, cohesive deliverable. Organize logically, remove redundancy, ensure consistency, and add an executive summary at the top. Incorporate the QA reviewer's feedback.`,
                `QA Review:\n${review}\n\nAll work:\n${allWork}`
            );

            workflowState.updateStep(runId, "step_3", { status: "completed", completedAt: new Date().toISOString(), result: "Final deliverable compiled" });
            return result;
        });

        workflowState.complete(runId, deliverable);
        return { runId, deliverable, review };
    }
);
