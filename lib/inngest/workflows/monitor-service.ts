/**
 * Monitor Service Workflow
 *
 * Scheduled monitoring of URLs/endpoints:
 * 1. Check endpoint status
 * 2. Compare with previous state
 * 3. Analyze changes
 * 4. Generate alert if needed
 */

import { inngest } from "../client";
import { workflowState } from "../state";
import { selectModel, callModel } from "../models";

export const monitorService = inngest.createFunction(
    {
        id: "workflow-monitor-service",
        retries: 3,
    },
    { event: "workflow/monitor-service" },
    async ({ event, step }) => {
        const { runId, instructions, modelPreference, context } = event.data;
        const url = (context?.url as string) || "";

        await step.run("init-state", async () => {
            return workflowState.init(runId, "monitor-service", instructions, [
                "Check endpoint",
                "Compare with baseline",
                "Generate report",
            ]);
        });

        // Step 1: Check endpoint
        const check = await step.run("check-endpoint", async () => {
            workflowState.updateStep(runId, "step_0", { status: "running", startedAt: new Date().toISOString() });

            try {
                const startTime = Date.now();
                const response = await fetch(url, {
                    method: "GET",
                    headers: { "User-Agent": "RantChat-Monitor/1.0" },
                    signal: AbortSignal.timeout(30000),
                });
                const responseTime = Date.now() - startTime;
                const body = await response.text();

                const result = {
                    url,
                    status: response.status,
                    statusText: response.statusText,
                    responseTime,
                    contentLength: body.length,
                    headers: Object.fromEntries(response.headers.entries()),
                    bodyPreview: body.substring(0, 2000),
                    checkedAt: new Date().toISOString(),
                };

                workflowState.updateStep(runId, "step_0", { status: "completed", completedAt: new Date().toISOString(), result: `Status ${result.status}, ${responseTime}ms` });
                return result;
            } catch (error) {
                const result = {
                    url,
                    status: 0,
                    statusText: "UNREACHABLE",
                    responseTime: -1,
                    contentLength: 0,
                    error: String(error),
                    checkedAt: new Date().toISOString(),
                };
                workflowState.updateStep(runId, "step_0", { status: "completed", completedAt: new Date().toISOString(), result: `UNREACHABLE: ${error}` });
                return result;
            }
        });

        // Step 2: Analyze
        const analysis = await step.run("analyze-check", async () => {
            workflowState.updateStep(runId, "step_1", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("general", modelPreference);
            const result = await callModel(
                model,
                `You are a site reliability engineer. Analyze this endpoint check result. Report on:
1. Is the service UP or DOWN?
2. Response time assessment (good/slow/timeout)
3. Any concerning status codes or errors
4. Content changes (if relevant to monitoring goal)
Be brief and actionable.`,
                `Check result:\n${JSON.stringify(check, null, 2)}\n\nMonitoring goal: ${instructions}`
            );

            workflowState.updateStep(runId, "step_1", { status: "completed", completedAt: new Date().toISOString(), result: "Analysis done" });
            return result;
        });

        // Step 3: Report
        const report = await step.run("generate-report", async () => {
            workflowState.updateStep(runId, "step_2", { status: "running", startedAt: new Date().toISOString() });

            const report = [
                `# Service Monitor Report`,
                `**URL**: ${url}`,
                `**Checked**: ${check.checkedAt}`,
                `**Status**: ${check.status} ${check.statusText}`,
                `**Response Time**: ${check.responseTime}ms`,
                "",
                `## Analysis`,
                analysis,
            ].join("\n");

            workflowState.updateStep(runId, "step_2", { status: "completed", completedAt: new Date().toISOString(), result: "Report generated" });
            return report;
        });

        workflowState.complete(runId, report);
        return { runId, check, analysis };
    }
);
