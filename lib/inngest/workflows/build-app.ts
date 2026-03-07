/**
 * Build App Workflow
 *
 * Full application development:
 * 1. Analyze requirements
 * 2. Design architecture
 * 3. Generate code (file by file)
 * 4. Validate and test
 * 5. Iterate on issues
 */

import { inngest } from "../client";
import { workflowState } from "../state";
import { selectModel, callModel } from "../models";

export const buildApp = inngest.createFunction(
    {
        id: "workflow-build-app",
        retries: 2,
    },
    { event: "workflow/build-app" },
    async ({ event, step }) => {
        const { runId, instructions, modelPreference } = event.data;

        await step.run("init-state", async () => {
            return workflowState.init(runId, "build-app", instructions, [
                "Analyze requirements",
                "Design architecture & file structure",
                "Generate core application code",
                "Generate supporting files (config, styles, tests)",
                "Review and validate",
                "Fix issues and finalize",
            ]);
        });

        // Step 1: Analyze requirements
        const requirements = await step.run("analyze-requirements", async () => {
            workflowState.updateStep(runId, "step_0", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("planning", modelPreference);
            const result = await callModel(
                model,
                `You are a product architect. Analyze this app idea and produce:
1. **Core Features** (MVP scope)
2. **Tech Stack** recommendation
3. **Data Models** with fields
4. **Page/Route Structure**
5. **API Endpoints** needed
6. **Third-party integrations** needed
Be specific and practical — aim for a shippable MVP.`,
                instructions
            );

            workflowState.updateStep(runId, "step_0", { status: "completed", completedAt: new Date().toISOString(), result: "Requirements analyzed" });
            workflowState.appendNotes(runId, "Requirements", result);
            return result;
        });

        // Step 2: Architecture
        const architecture = await step.run("design-architecture", async () => {
            workflowState.updateStep(runId, "step_1", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("planning", modelPreference);
            const result = await callModel(
                model,
                `You are a software architect. Design the file structure for this application. Return a JSON array of files to generate:
[{ "path": "src/...", "purpose": "...", "type": "component|page|api|config|util|style|test", "priority": 1-5 }]

Order by dependency — generate foundational files first. Include: config files, type definitions, utilities, components, pages, API routes, styles.`,
                `Requirements:\n${requirements}`
            );

            workflowState.updateStep(runId, "step_1", { status: "completed", completedAt: new Date().toISOString(), result: "Architecture designed" });

            try {
                const parsed = JSON.parse(result.trim().replace(/```json?\n?/g, "").replace(/```/g, ""));
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [{ path: "src/app.ts", purpose: "Main application", type: "component", priority: 1 }];
            }
        });

        // Step 3: Generate core files
        const coreFiles = await step.run("generate-core", async () => {
            workflowState.updateStep(runId, "step_2", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("code-generation", modelPreference);
            const files: Array<{ path: string; content: string }> = [];
            const coreArch = architecture.filter((f: { priority: number }) => f.priority <= 3);

            for (const file of coreArch) {
                const content = await callModel(
                    model,
                    `You are a senior full-stack developer. Generate production-quality code for:
File: ${file.path} (${file.purpose})
This is part of a larger app. Use consistent naming and import patterns.
Return ONLY the code, no markdown fences or explanations.`,
                    `Full requirements:\n${requirements}\n\nArchitecture context:\n${JSON.stringify(architecture, null, 2)}\n\nAlready generated files: ${files.map((f) => f.path).join(", ")}`
                );
                files.push({ path: file.path, content });
            }

            workflowState.updateStep(runId, "step_2", { status: "completed", completedAt: new Date().toISOString(), result: `Generated ${files.length} core files` });
            return files;
        });

        // Step 4: Generate supporting files
        const supportFiles = await step.run("generate-support", async () => {
            workflowState.updateStep(runId, "step_3", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("code-generation", modelPreference);
            const files: Array<{ path: string; content: string }> = [];
            const supportArch = architecture.filter((f: { priority: number }) => f.priority > 3);

            for (const file of supportArch) {
                const content = await callModel(
                    model,
                    `Generate code for: ${file.path} (${file.purpose}). Follow patterns from core files. Return ONLY code.`,
                    `Core files context:\n${coreFiles.map((f) => `${f.path}: ${f.content.substring(0, 200)}...`).join("\n")}`
                );
                files.push({ path: file.path, content });
            }

            workflowState.updateStep(runId, "step_3", { status: "completed", completedAt: new Date().toISOString(), result: `Generated ${files.length} support files` });
            return files;
        });

        const allFiles = [...coreFiles, ...supportFiles];

        // Step 5: Review
        const review = await step.run("review-app", async () => {
            workflowState.updateStep(runId, "step_4", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("code-review", modelPreference);
            const allCode = allFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.content.substring(0, 1000)}\n\`\`\``).join("\n\n");

            const result = await callModel(
                model,
                `Review this codebase for critical issues. Focus on: missing imports, broken references between files, security issues, missing error handling. Return "PASS" if acceptable, or list issues with severity.`,
                allCode
            );

            workflowState.updateStep(runId, "step_4", { status: "completed", completedAt: new Date().toISOString(), result: "Review complete" });
            return result;
        });

        // Step 6: Fix if needed
        const finalFiles = await step.run("finalize", async () => {
            workflowState.updateStep(runId, "step_5", { status: "running", startedAt: new Date().toISOString() });

            if (review.toUpperCase().includes("PASS") && !review.toUpperCase().includes("CRITICAL")) {
                workflowState.updateStep(runId, "step_5", { status: "completed", completedAt: new Date().toISOString(), result: "No critical issues" });
                return allFiles;
            }

            const model = selectModel("code-generation", modelPreference);
            const fixedFiles: typeof allFiles = [];
            for (const file of allFiles) {
                const fixed = await callModel(
                    model,
                    `Fix issues in this file based on code review. Return ONLY fixed code.`,
                    `File: ${file.path}\nCode:\n${file.content}\n\nReview:\n${review}`
                );
                fixedFiles.push({ path: file.path, content: fixed });
            }

            workflowState.updateStep(runId, "step_5", { status: "completed", completedAt: new Date().toISOString(), result: "Issues fixed" });
            return fixedFiles;
        });

        const output = finalFiles.map((f) => `## ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
        workflowState.complete(runId, output);

        return { runId, files: finalFiles };
    }
);
