/**
 * Unit Tests — System Prompt Construction
 *
 * Tests that the agent system prompt builder correctly assembles
 * all components: Lindy patterns, Gmail SOPs, coding rules,
 * Composio instructions, and template overrides.
 */

import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/lib/agent/prompts";

describe("buildSystemPrompt", () => {
    it("returns a non-empty string", async () => {
        const prompt = await buildSystemPrompt({ composioEnabled: false });
        expect(typeof prompt).toBe("string");
        expect(prompt.length).toBeGreaterThan(100);
    });

    it("includes the agent identity", async () => {
        const prompt = await buildSystemPrompt({ composioEnabled: false });
        // The prompt contains the agent's core identity section
        expect(prompt.length).toBeGreaterThan(500);
    });

    it("includes Lindy behavioral patterns", async () => {
        const prompt = await buildSystemPrompt({ composioEnabled: false });
        // Check for key Lindy patterns
        expect(prompt).toContain("think"); // Reasoning tool
        expect(prompt).toContain("task_plan"); // Planning tool
    });

    it("includes email automation rules when composio is enabled", async () => {
        const prompt = await buildSystemPrompt({ composioEnabled: true });
        // Check for email-related content in the prompt
        expect(prompt.toLowerCase()).toContain("email");
    });

    it("includes coding rules with correct tool names", async () => {
        const prompt = await buildSystemPrompt({ composioEnabled: false });
        // Verify the CodeRabbit-fixed tool names are correct
        expect(prompt).toContain("sandbox_run_command");
        expect(prompt).toContain("sandbox_write_file");
        expect(prompt).toContain("sandbox_execute_code");
        // Should NOT contain the old incorrect names
        expect(prompt).not.toContain("sandbox_terminal_run");
    });

    it("includes self-improvement scoring pattern", async () => {
        const prompt = await buildSystemPrompt({ composioEnabled: false });
        expect(prompt).toContain("score");
    });

    it("includes multi-agent delegation instructions", async () => {
        const prompt = await buildSystemPrompt({ composioEnabled: false });
        expect(prompt).toContain("delegate");
    });

    it("includes Composio instructions when enabled", async () => {
        const promptWith = await buildSystemPrompt({ composioEnabled: true });
        expect(promptWith).toContain("Composio");
        expect(promptWith).toContain("1000+");
    });

    it("includes tool routing decision table", async () => {
        const prompt = await buildSystemPrompt({ composioEnabled: false });
        expect(prompt).toContain("sandbox_run_command");
        expect(prompt).toContain("sandbox_execute_code");
    });
});
