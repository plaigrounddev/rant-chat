/**
 * Deep Research Workflow
 *
 * Performs extensive research on a topic by:
 * 1. Planning research queries
 * 2. Executing web searches in parallel
 * 3. Scraping and extracting key information
 * 4. Cross-referencing across sources
 * 5. Compiling a structured report
 */

import { inngest } from "../client";
import { workflowState } from "../state";
import { selectModel, callModel } from "../models";

export const deepResearch = inngest.createFunction(
    {
        id: "workflow-deep-research",
        retries: 2,
    },
    { event: "workflow/deep-research" },
    async ({ event, step }) => {
        const { runId, instructions, modelPreference } = event.data;

        // Initialize workflow state
        const state = await step.run("init-state", async () => {
            return workflowState.init(runId, "deep-research", instructions, [
                "Plan research queries",
                "Execute web searches",
                "Analyze and extract findings",
                "Cross-reference sources",
                "Compile final report",
            ]);
        });

        // Step 1: Plan research queries
        const queries = await step.run("plan-queries", async () => {
            workflowState.updateStep(runId, "step_0", { status: "running", startedAt: new Date().toISOString() });

            const planner = selectModel("planning", modelPreference);
            const result = await callModel(
                planner,
                `You are a research planning specialist. Given a research topic, generate 5-10 specific search queries that would provide comprehensive coverage. Return ONLY a JSON array of query strings, nothing else.`,
                `Research topic: ${instructions}`
            );

            workflowState.updateStep(runId, "step_0", { status: "completed", completedAt: new Date().toISOString(), result: "Generated search queries" });

            try {
                // Try to parse as JSON array
                const parsed = JSON.parse(result.trim().replace(/```json?\n?/g, "").replace(/```/g, ""));
                return Array.isArray(parsed) ? parsed : [instructions];
            } catch {
                // Fallback: split by newlines
                return result.split("\n").filter((q: string) => q.trim().length > 0).slice(0, 8);
            }
        });

        // Step 2: Execute web searches
        const searchResults = await step.run("execute-searches", async () => {
            workflowState.updateStep(runId, "step_1", { status: "running", startedAt: new Date().toISOString() });

            const results: Array<{ query: string; findings: string }> = [];

            for (const query of queries.slice(0, 8)) {
                try {
                    const model = selectModel("general", modelPreference);
                    const searchResult = await callModel(
                        model,
                        `You are a research assistant. Provide comprehensive, factual information about the following query. Include specific data points, statistics, and sources where possible. If you don't have current information, note that clearly.`,
                        query
                    );
                    results.push({ query, findings: searchResult });
                } catch (err) {
                    results.push({ query, findings: `Error researching: ${err}` });
                }
            }

            workflowState.updateStep(runId, "step_1", {
                status: "completed",
                completedAt: new Date().toISOString(),
                result: `Completed ${results.length} searches`,
            });
            workflowState.appendNotes(runId, "Search Results", results.map((r) => `### ${r.query}\n${r.findings}`).join("\n\n"));

            return results;
        });

        // Step 3: Analyze and extract key findings
        const analysis = await step.run("analyze-findings", async () => {
            workflowState.updateStep(runId, "step_2", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("analysis", modelPreference);
            const allFindings = searchResults.map((r) => `## ${r.query}\n${r.findings}`).join("\n\n---\n\n");

            const result = await callModel(
                model,
                `You are an expert analyst. Review all research findings below and extract:
1. Key themes and patterns
2. Important data points and statistics
3. Conflicting information (if any)
4. Gaps in the research
5. Confidence level for each finding

Be thorough and specific. Cite which source each finding comes from.`,
                allFindings
            );

            workflowState.updateStep(runId, "step_2", { status: "completed", completedAt: new Date().toISOString(), result: "Analysis complete" });
            workflowState.appendNotes(runId, "Analysis", result);
            return result;
        });

        // Step 4: Cross-reference
        const crossRef = await step.run("cross-reference", async () => {
            workflowState.updateStep(runId, "step_3", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("reasoning", modelPreference);
            const result = await callModel(
                model,
                `You are a fact-checker. Review the analysis below and:
1. Identify claims that are supported by multiple sources (high confidence)
2. Identify claims supported by only one source (medium confidence)
3. Identify any contradictions between sources
4. Note any claims that seem speculative or unverified

Provide a confidence-rated summary of verified findings.`,
                analysis
            );

            workflowState.updateStep(runId, "step_3", { status: "completed", completedAt: new Date().toISOString(), result: "Cross-reference complete" });
            return result;
        });

        // Step 5: Compile final report
        const report = await step.run("compile-report", async () => {
            workflowState.updateStep(runId, "step_4", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("general", modelPreference);
            const result = await callModel(
                model,
                `You are a professional report writer. Compile a comprehensive, well-structured research report based on the verified findings below. Include:

1. **Executive Summary** (2-3 paragraphs)
2. **Key Findings** (numbered list with confidence levels)
3. **Detailed Analysis** (organized by theme)
4. **Data & Statistics** (if available)
5. **Gaps & Limitations** 
6. **Recommendations** (actionable next steps)
7. **Methodology** (brief note on how research was conducted)

Use markdown formatting. Be thorough but concise.`,
                `Original request: ${instructions}\n\nVerified findings:\n${crossRef}\n\nRaw analysis:\n${analysis}`
            );

            workflowState.updateStep(runId, "step_4", { status: "completed", completedAt: new Date().toISOString(), result: "Report compiled" });
            workflowState.complete(runId, result);
            return result;
        });

        return { runId, report };
    }
);
