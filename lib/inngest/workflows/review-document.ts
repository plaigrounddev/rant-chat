/**
 * Review Document Workflow
 *
 * Analyzes large documents by:
 * 1. Chunking the document
 * 2. Analyzing each chunk
 * 3. Extracting key findings
 * 4. Synthesizing a comprehensive summary
 * 5. Generating action items
 */

import { inngest } from "../client";
import { workflowState } from "../state";
import { selectModel, callModel } from "../models";

export const reviewDocument = inngest.createFunction(
    {
        id: "workflow-review-document",
        retries: 2,
    },
    { event: "workflow/review-document" },
    async ({ event, step }) => {
        const { runId, instructions, modelPreference, documentContent, documentUrl } = event.data;
        const content = documentContent || `[Document URL: ${documentUrl || "not provided"}]`;

        await step.run("init-state", async () => {
            return workflowState.init(runId, "review-document", instructions, [
                "Prepare document for analysis",
                "Analyze document content",
                "Extract key findings",
                "Generate summary and recommendations",
                "Create action items",
            ]);
        });

        // Step 1: Prepare / chunk document
        const chunks = await step.run("prepare-document", async () => {
            workflowState.updateStep(runId, "step_0", { status: "running", startedAt: new Date().toISOString() });

            // Split into ~4000 char chunks with overlap
            const chunkSize = 4000;
            const overlap = 500;
            const result: string[] = [];
            for (let i = 0; i < content.length; i += chunkSize - overlap) {
                result.push(content.slice(i, i + chunkSize));
            }

            workflowState.updateStep(runId, "step_0", {
                status: "completed",
                completedAt: new Date().toISOString(),
                result: `Document split into ${result.length} chunks`,
            });
            return result;
        });

        // Step 2: Analyze each chunk
        const chunkAnalyses = await step.run("analyze-chunks", async () => {
            workflowState.updateStep(runId, "step_1", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("large-context", modelPreference);
            const analyses: string[] = [];

            for (let i = 0; i < chunks.length; i++) {
                const analysis = await callModel(
                    model,
                    `You are a document analyst. Analyze chunk ${i + 1}/${chunks.length} of a document. Extract:
1. Key points and arguments
2. Important data, numbers, or dates
3. Risks or concerns mentioned
4. Commitments or obligations
5. Notable language or clauses

Context: ${instructions}`,
                    chunks[i]
                );
                analyses.push(analysis);
            }

            workflowState.updateStep(runId, "step_1", {
                status: "completed",
                completedAt: new Date().toISOString(),
                result: `Analyzed ${analyses.length} chunks`,
            });
            workflowState.appendNotes(runId, "Chunk Analyses", analyses.map((a, i) => `### Chunk ${i + 1}\n${a}`).join("\n\n"));
            return analyses;
        });

        // Step 3: Extract key findings
        const findings = await step.run("extract-findings", async () => {
            workflowState.updateStep(runId, "step_2", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("analysis", modelPreference);
            const allAnalyses = chunkAnalyses.join("\n\n---\n\n");

            const result = await callModel(
                model,
                `You are a senior analyst. Synthesize all chunk analyses into a unified list of key findings. Group by theme, remove duplicates, and rank by importance. Focus on: ${instructions}`,
                allAnalyses
            );

            workflowState.updateStep(runId, "step_2", { status: "completed", completedAt: new Date().toISOString(), result: "Findings extracted" });
            return result;
        });

        // Step 4: Generate summary
        const summary = await step.run("generate-summary", async () => {
            workflowState.updateStep(runId, "step_3", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("general", modelPreference);
            const result = await callModel(
                model,
                `You are a professional document reviewer. Create a comprehensive review report including:
1. **Executive Summary** (2-3 paragraphs)
2. **Key Findings** (ranked by importance)
3. **Risks & Concerns** (if any)
4. **Opportunities** (if applicable)
5. **Recommendations**

Be specific and actionable. Use markdown formatting.`,
                `Review request: ${instructions}\n\nKey findings:\n${findings}`
            );

            workflowState.updateStep(runId, "step_3", { status: "completed", completedAt: new Date().toISOString(), result: "Summary generated" });
            return result;
        });

        // Step 5: Action items
        const actionItems = await step.run("create-action-items", async () => {
            workflowState.updateStep(runId, "step_4", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("planning", modelPreference);
            const result = await callModel(
                model,
                `Based on the document review summary below, create a prioritized action items list. For each item include:
- Priority: HIGH / MEDIUM / LOW
- Description
- Suggested owner/team
- Deadline suggestion (relative, e.g., "within 1 week")

Return as a numbered markdown list.`,
                summary
            );

            workflowState.updateStep(runId, "step_4", { status: "completed", completedAt: new Date().toISOString(), result: "Action items created" });
            return result;
        });

        const fullReport = `${summary}\n\n---\n\n## Action Items\n\n${actionItems}`;
        workflowState.complete(runId, fullReport);

        return { runId, summary, actionItems };
    }
);
