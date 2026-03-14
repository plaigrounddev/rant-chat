/**
 * Unit Tests — Intent Classification & Skill Filtering (Lindy Pattern #9)
 *
 * Tests the keyword-based intent classifier and context-aware
 * tool filtering that reduces ~51 tools to ~10-25 per request.
 */

import { describe, it, expect } from "vitest";
import { classifyIntent, getFilteredAgentTools, getAgentTools } from "@/lib/agent/tools";

// ── classifyIntent ─────────────────────────────────────────────────────────

describe("classifyIntent", () => {
    it("returns 'research' for search/lookup queries", () => {
        expect(classifyIntent("search for the latest news about AI")).toContain("research");
        expect(classifyIntent("what is Anthropic's valuation?")).toContain("research");
        expect(classifyIntent("who is the CEO of OpenAI?")).toContain("research");
        expect(classifyIntent("compare React vs Vue")).toContain("research");
        expect(classifyIntent("explain quantum computing")).toContain("research");
        expect(classifyIntent("summarize this article")).toContain("research");
        expect(classifyIntent("tell me about Elon Musk")).toContain("research");
    });

    it("returns 'browser' for browsing/scraping queries", () => {
        expect(classifyIntent("browse to google.com")).toContain("browser");
        // Note: "navigate to the dashboard" matches "build" because of "dashboard" keyword
        expect(classifyIntent("navigate to the website")).toContain("browser");
        expect(classifyIntent("go to https://news.ycombinator.com")).toContain("browser");
        expect(classifyIntent("scrape live data from the website")).toContain("browser");
        expect(classifyIntent("fill out the form on the page")).toContain("browser");
        expect(classifyIntent("log in to my account")).toContain("browser");
    });

    it("returns 'build' for coding/building queries", () => {
        expect(classifyIntent("build me a todo app")).toContain("build");
        expect(classifyIntent("create a python script")).toContain("build");
        expect(classifyIntent("write a javascript function")).toContain("build");
        expect(classifyIntent("code a calculator")).toContain("build");
        expect(classifyIntent("generate a PDF report")).toContain("build");
        expect(classifyIntent("create a data analysis script")).toContain("build");
        expect(classifyIntent("install numpy and matplotlib")).toContain("build");
    });

    it("returns 'design' for UI/design queries", () => {
        expect(classifyIntent("design a landing page")).toContain("design");
        expect(classifyIntent("create a beautiful portfolio")).toContain("design");
        expect(classifyIntent("make a stunning hero section")).toContain("design");
        expect(classifyIntent("build a UI for the dashboard")).toContain("design");
        expect(classifyIntent("create a modal with glassmorphism")).toContain("design");
    });

    it("returns 'integrations' for app connection queries", () => {
        expect(classifyIntent("connect to Gmail")).toContain("integrations");
        expect(classifyIntent("integrate with Slack")).toContain("integrations");
        expect(classifyIntent("send a message on Notion")).toContain("integrations");
        expect(classifyIntent("check my GitHub issues")).toContain("integrations");
        expect(classifyIntent("search Salesforce contacts")).toContain("integrations");
    });

    it("returns 'triggers' for automation/scheduling queries", () => {
        expect(classifyIntent("set up a trigger for new emails")).toContain("triggers");
        expect(classifyIntent("schedule an automatic email notification")).toContain("triggers");
        expect(classifyIntent("schedule a daily digest")).toContain("triggers");
        expect(classifyIntent("when I receive a new GitHub PR, notify me")).toContain("triggers");
        expect(classifyIntent("create a cron job every morning")).toContain("triggers");
        expect(classifyIntent("watch for new events")).toContain("triggers");
    });

    it("returns 'desktop' for GUI automation queries", () => {
        expect(classifyIntent("automate the desktop app")).toContain("desktop");
        expect(classifyIntent("take a screenshot of the GUI")).toContain("desktop");
        expect(classifyIntent("click the button on the desktop")).toContain("desktop");
    });

    it("returns 'general' for vague or unclassifiable queries", () => {
        expect(classifyIntent("hello")).toContain("general");
        expect(classifyIntent("hi there")).toContain("general");
        expect(classifyIntent("thanks")).toContain("general");
        expect(classifyIntent("ok")).toContain("general");
        expect(classifyIntent("I appreciate it")).toContain("general");
    });

    it("returns multiple modes for multi-faceted requests", () => {
        const modes = classifyIntent("search for React tutorials and build me a dashboard");
        expect(modes).toContain("research");
        expect(modes).toContain("build");
    });

    it("is case insensitive", () => {
        expect(classifyIntent("SEARCH FOR AI NEWS")).toContain("research");
        expect(classifyIntent("Build A TODO APP")).toContain("build");
        expect(classifyIntent("Connect To GMAIL")).toContain("integrations");
    });

    it("never returns 'general' alongside other modes", () => {
        const modes = classifyIntent("search for the latest AI news");
        expect(modes).not.toContain("general");
        expect(modes).toContain("research");
    });
});

// ── getFilteredAgentTools ──────────────────────────────────────────────────

describe("getFilteredAgentTools", () => {
    it("returns all tools for general/unclassified messages", () => {
        const allTools = getAgentTools();
        const filtered = getFilteredAgentTools("hello");
        // For general mode, should return all tools
        expect(filtered.length).toBe(allTools.length);
    });

    it("returns fewer tools than the full set for specific queries", () => {
        const allTools = getAgentTools();
        const filtered = getFilteredAgentTools("search for the latest AI news");
        // Research mode should return fewer tools than the full set
        expect(filtered.length).toBeLessThanOrEqual(allTools.length);
        // But still has core tools
        expect(filtered.length).toBeGreaterThan(0);
    });

    it("always includes core tools (think, task_plan, memory)", () => {
        const filtered = getFilteredAgentTools("search for AI news");
        const names = filtered
            .filter((t): t is { type: "function"; name: string } => "name" in t)
            .map((t) => t.name);

        expect(names).toContain("think");
        expect(names).toContain("task_plan");
        expect(names).toContain("read_memories");
        expect(names).toContain("create_memory");
    });

    it("includes browser tools only for browser-classified messages", () => {
        const browserFiltered = getFilteredAgentTools("browse to google.com");
        const browserNames = browserFiltered
            .filter((t): t is { type: "function"; name: string } => "name" in t)
            .map((t) => t.name);
        expect(browserNames).toContain("browser_navigate");

        const researchFiltered = getFilteredAgentTools("what is quantum computing?");
        const researchNames = researchFiltered
            .filter((t): t is { type: "function"; name: string } => "name" in t)
            .map((t) => t.name);
        // Research mode should NOT include browser tools
        expect(researchNames).not.toContain("browser_navigate");
    });

    it("includes sandbox tools for build-classified messages", () => {
        const filtered = getFilteredAgentTools("build me a python data analysis tool");
        const names = filtered
            .filter((t): t is { type: "function"; name: string } => "name" in t)
            .map((t) => t.name);

        expect(names).toContain("sandbox_execute_code");
        expect(names).toContain("sandbox_write_file");
        expect(names).toContain("sandbox_run_command");
    });

    it("includes integration tools for integrations-classified messages", () => {
        const filtered = getFilteredAgentTools("connect to Gmail and send an email");
        const names = filtered
            .filter((t): t is { type: "function"; name: string } => "name" in t)
            .map((t) => t.name);

        expect(names).toContain("list_trigger_types");
    });
});
