/**
 * Process Data Workflow
 *
 * ETL-style data processing:
 * 1. Understand data structure
 * 2. Plan transformations
 * 3. Execute transformations
 * 4. Validate output
 * 5. Generate summary report
 */

import { inngest } from "../client";
import { workflowState } from "../state";
import { selectModel, callModel } from "../models";

export const processData = inngest.createFunction(
    {
        id: "workflow-process-data",
        retries: 2,
    },
    { event: "workflow/process-data" },
    async ({ event, step }) => {
        const { runId, instructions, modelPreference, context } = event.data;
        const inputData = (context?.inputData as string) || "";

        await step.run("init-state", async () => {
            return workflowState.init(runId, "process-data", instructions, [
                "Analyze data structure",
                "Plan transformations",
                "Execute transformations",
                "Validate output",
                "Generate summary",
            ]);
        });

        // Step 1: Analyze structure
        const structure = await step.run("analyze-structure", async () => {
            workflowState.updateStep(runId, "step_0", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("general", modelPreference);
            const result = await callModel(
                model,
                `Analyze this data and describe: format, schema/columns, data types, row count estimate, quality issues, and any patterns.`,
                `Data sample:\n${inputData.substring(0, 5000)}\n\nUser instructions: ${instructions}`
            );

            workflowState.updateStep(runId, "step_0", { status: "completed", completedAt: new Date().toISOString(), result: "Structure analyzed" });
            return result;
        });

        // Step 2: Plan transformations
        const plan = await step.run("plan-transforms", async () => {
            workflowState.updateStep(runId, "step_1", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("planning", modelPreference);
            const result = await callModel(
                model,
                `You are a data engineer. Based on the data structure and user instructions, plan the transformations needed. Include:
1. Cleaning steps (nulls, duplicates, format issues)
2. Transformation logic
3. Output format
4. Any computed/derived fields
Return as a numbered step list.`,
                `Structure:\n${structure}\n\nInstructions: ${instructions}`
            );

            workflowState.updateStep(runId, "step_1", { status: "completed", completedAt: new Date().toISOString(), result: "Plan created" });
            return result;
        });

        // Step 3: Execute
        const transformed = await step.run("execute-transforms", async () => {
            workflowState.updateStep(runId, "step_2", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("code-generation", modelPreference);
            const result = await callModel(
                model,
                `Apply the transformations described below to the data. Return the transformed data in the requested output format. If the data is too large, return a representative sample and describe the full transformation.`,
                `Transformation plan:\n${plan}\n\nData:\n${inputData.substring(0, 10000)}`
            );

            workflowState.updateStep(runId, "step_2", { status: "completed", completedAt: new Date().toISOString(), result: "Transforms applied" });
            return result;
        });

        // Step 4: Validate
        const validation = await step.run("validate-output", async () => {
            workflowState.updateStep(runId, "step_3", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("general", modelPreference);
            const result = await callModel(
                model,
                `Validate this transformed data against the original requirements. Check for: data completeness, format correctness, edge cases handled, any data loss.`,
                `Requirements: ${instructions}\n\nTransformed data:\n${transformed.substring(0, 5000)}`
            );

            workflowState.updateStep(runId, "step_3", { status: "completed", completedAt: new Date().toISOString(), result: "Validation done" });
            return result;
        });

        // Step 5: Summary
        const summary = await step.run("generate-summary", async () => {
            workflowState.updateStep(runId, "step_4", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("general", modelPreference);
            const result = await callModel(
                model,
                `Create a brief processing report: what was done, rows processed, any issues found, output format.`,
                `Transformations: ${plan}\nValidation: ${validation}`
            );

            workflowState.updateStep(runId, "step_4", { status: "completed", completedAt: new Date().toISOString(), result: "Summary complete" });
            return result;
        });

        workflowState.complete(runId, `${summary}\n\n---\n\n## Processed Data\n\n${transformed}`);
        return { runId, summary, transformed };
    }
);
