/**
 * Code Generation Workflow
 *
 * Generates code from a specification:
 * 1. Parse requirements
 * 2. Plan file structure
 * 3. Generate each file
 * 4. Validate code (lint/type-check)
 * 5. Fix any issues
 */

import { inngest } from "../client";
import { workflowState } from "../state";
import { selectModel, callModel } from "../models";

export const codeGeneration = inngest.createFunction(
    {
        id: "workflow-code-generation",
        retries: 2,
    },
    { event: "workflow/code-generation" },
    async ({ event, step }) => {
        const { runId, instructions, modelPreference, context } = event.data;
        const language = (context?.language as string) || "typescript";
        const framework = (context?.framework as string) || "";

        // Initialize
        await step.run("init-state", async () => {
            return workflowState.init(runId, "code-generation", instructions, [
                "Parse requirements",
                "Plan file structure",
                "Generate code files",
                "Review and validate",
                "Fix issues (if any)",
            ]);
        });

        // Step 1: Parse requirements
        const requirements = await step.run("parse-requirements", async () => {
            workflowState.updateStep(runId, "step_0", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("planning", modelPreference);
            const result = await callModel(
                model,
                `You are a senior software architect. Analyze the following specification and extract:
1. Functional requirements (what it should do)
2. Technical requirements (language: ${language}, framework: ${framework})
3. Data models / types needed
4. API endpoints or interfaces
5. Dependencies needed

Return a structured analysis in markdown.`,
                instructions
            );

            workflowState.updateStep(runId, "step_0", { status: "completed", completedAt: new Date().toISOString(), result: "Requirements parsed" });
            workflowState.appendNotes(runId, "Requirements", result);
            return result;
        });

        // Step 2: Plan file structure
        const filePlan = await step.run("plan-files", async () => {
            workflowState.updateStep(runId, "step_1", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("planning", modelPreference);
            const result = await callModel(
                model,
                `You are a senior software architect. Based on the requirements below, plan the file structure for this project. For each file, provide:
- File path
- Purpose (1 line)
- Key exports / functions
- Dependencies on other files

Return ONLY a JSON array of objects with: { "path": "string", "purpose": "string", "exports": ["string"], "dependencies": ["string"] }`,
                `Requirements:\n${requirements}\n\nLanguage: ${language}\nFramework: ${framework}`
            );

            workflowState.updateStep(runId, "step_1", { status: "completed", completedAt: new Date().toISOString(), result: "File structure planned" });

            try {
                const parsed = JSON.parse(result.trim().replace(/```json?\n?/g, "").replace(/```/g, ""));
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [{ path: `main.${language === "typescript" ? "ts" : language}`, purpose: "Main application file", exports: [], dependencies: [] }];
            }
        });

        // Step 3: Generate code files
        const generatedFiles = await step.run("generate-code", async () => {
            workflowState.updateStep(runId, "step_2", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("code-generation", modelPreference);
            const files: Array<{ path: string; content: string }> = [];

            for (const file of filePlan) {
                const content = await callModel(
                    model,
                    `You are an expert ${language} developer${framework ? ` specializing in ${framework}` : ""}. Generate production-quality code for the following file. Include proper types, error handling, and documentation. Return ONLY the code, no markdown fences.`,
                    `File: ${file.path}\nPurpose: ${file.purpose}\nExports: ${JSON.stringify(file.exports)}\nDependencies: ${JSON.stringify(file.dependencies)}\n\nFull requirements:\n${requirements}`
                );
                files.push({ path: file.path, content });
            }

            workflowState.updateStep(runId, "step_2", {
                status: "completed",
                completedAt: new Date().toISOString(),
                result: `Generated ${files.length} files`,
            });
            workflowState.appendNotes(runId, "Generated Files", files.map((f) => `### ${f.path}\n\`\`\`${language}\n${f.content}\n\`\`\``).join("\n\n"));
            return files;
        });

        // Step 4: Review and validate
        const review = await step.run("review-code", async () => {
            workflowState.updateStep(runId, "step_3", { status: "running", startedAt: new Date().toISOString() });

            const model = selectModel("code-review", modelPreference);
            const allCode = generatedFiles.map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");

            const result = await callModel(
                model,
                `You are a senior code reviewer. Review the following codebase for:
1. Bugs and logic errors
2. Missing error handling
3. Type safety issues
4. Security vulnerabilities
5. Missing imports or dependencies
6. Code quality and best practices

For each issue found, provide:
- File and line (approximate)
- Severity: CRITICAL / MAJOR / MINOR
- Description and fix suggestion

If the code looks good, say "PASS" with brief notes.`,
                allCode
            );

            workflowState.updateStep(runId, "step_3", { status: "completed", completedAt: new Date().toISOString(), result: "Review complete" });
            return result;
        });

        // Step 5: Fix issues if any
        const finalFiles = await step.run("fix-issues", async () => {
            workflowState.updateStep(runId, "step_4", { status: "running", startedAt: new Date().toISOString() });

            if (review.toUpperCase().includes("PASS") && !review.toUpperCase().includes("CRITICAL")) {
                workflowState.updateStep(runId, "step_4", { status: "completed", completedAt: new Date().toISOString(), result: "No critical issues" });
                return generatedFiles;
            }

            // Fix the code based on review feedback
            const model = selectModel("code-generation", modelPreference);
            const fixedFiles: Array<{ path: string; content: string }> = [];

            for (const file of generatedFiles) {
                const fixed = await callModel(
                    model,
                    `You are an expert ${language} developer. Fix the following code based on the review feedback. Apply ALL suggested fixes. Return ONLY the fixed code, no markdown fences.`,
                    `Original code:\n${file.content}\n\nReview feedback:\n${review}\n\nFix ALL issues mentioned for ${file.path}.`
                );
                fixedFiles.push({ path: file.path, content: fixed });
            }

            workflowState.updateStep(runId, "step_4", {
                status: "completed",
                completedAt: new Date().toISOString(),
                result: `Fixed ${fixedFiles.length} files`,
            });
            return fixedFiles;
        });

        // Complete with full output
        const output = finalFiles.map((f) => `## ${f.path}\n\`\`\`${language}\n${f.content}\n\`\`\``).join("\n\n");
        workflowState.complete(runId, output);

        return { runId, files: finalFiles, review };
    }
);
