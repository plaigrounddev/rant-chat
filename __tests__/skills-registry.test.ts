/**
 * Unit Tests — Skills Registry
 *
 * Tests that all expected skills are registered with correct metadata,
 * valid tool definitions, and proper categories.
 */

import { describe, it, expect, beforeAll } from "vitest";

// Force skill registration
import "@/lib/agent/skills";
import { getCustomTools } from "@/lib/agent/tools";

describe("Skills Registry", () => {
    let toolNames: string[];

    beforeAll(() => {
        toolNames = getCustomTools().map((t) => t.name);
    });

    it("registers more than 10 skills", () => {
        expect(toolNames.length).toBeGreaterThan(10);
    });

    // ── Core reasoning tools ──────────────────────────────────────────
    it("registers 'think' tool", () => {
        expect(toolNames).toContain("think");
    });

    it("registers 'task_plan' tool", () => {
        expect(toolNames).toContain("task_plan");
    });

    it("registers 'run_code' tool", () => {
        expect(toolNames).toContain("run_code");
    });

    // ── Memory tools ──────────────────────────────────────────────────
    it("registers memory tools", () => {
        expect(toolNames).toContain("read_memories");
        expect(toolNames).toContain("create_memory");
        expect(toolNames).toContain("save_learning");
        expect(toolNames).toContain("update_memory");
        expect(toolNames).toContain("delete_memory");
    });

    // ── Web/research tools ────────────────────────────────────────────
    it("registers web search tools", () => {
        expect(toolNames).toContain("web_search");
        expect(toolNames).toContain("scrape_website");
    });

    it("registers Perplexity search tool", () => {
        expect(toolNames).toContain("ask_perplexity");
    });

    // ── Integration tools ─────────────────────────────────────────────
    it("registers trigger management tools", () => {
        expect(toolNames).toContain("list_trigger_types");
        expect(toolNames).toContain("create_trigger");
        expect(toolNames).toContain("list_active_triggers");
        expect(toolNames).toContain("manage_trigger");
        expect(toolNames).toContain("get_trigger_events");
    });

    // ── Delegation tools ──────────────────────────────────────────────
    it("registers delegate_to tool", () => {
        expect(toolNames).toContain("delegate_to");
    });

    // ── Tool definitions format ───────────────────────────────────────
    it("all tools have valid function definitions", () => {
        const tools = getCustomTools();
        for (const tool of tools) {
            expect(tool.type).toBe("function");
            expect(typeof tool.name).toBe("string");
            expect(tool.name.length).toBeGreaterThan(0);
            expect(typeof tool.description).toBe("string");
            expect(tool.description.length).toBeGreaterThan(0);
            expect(tool.parameters).toBeDefined();
            expect(tool.parameters.type).toBe("object");
        }
    });

    it("no duplicate tool names", () => {
        const uniqueNames = new Set(toolNames);
        expect(uniqueNames.size).toBe(toolNames.length);
    });

    it("all tool names follow snake_case convention", () => {
        for (const name of toolNames) {
            expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
        }
    });
});
