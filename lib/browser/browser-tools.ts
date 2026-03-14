/**
 * BrowserToolDefinitions — JSON schema tool definitions for the agent.
 *
 * These are the tools the AI agent can invoke to interact with a cloud browser.
 * Each tool has a name, description, and parameter schema that the LLM uses
 * for structured function calling.
 *
 * Inspired by Manus AI's 29-tool approach: browser_navigate, browser_click,
 * browser_type, etc.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Tool Schemas (Zod)
// ---------------------------------------------------------------------------

export const browserNavigateSchema = z.object({
    url: z.string().url().describe("The URL to navigate to"),
});

export const browserClickSchema = z.object({
    selector: z
        .string()
        .describe(
            "CSS selector or XPath expression identifying the element to click"
        ),
});

export const browserTypeSchema = z.object({
    selector: z
        .string()
        .describe("CSS selector for the input element to type into"),
    text: z.string().describe("The text to type into the element"),
    clearFirst: z
        .boolean()
        .optional()
        .default(true)
        .describe("Whether to clear the field before typing (default: true)"),
});

export const browserScrollSchema = z.object({
    direction: z
        .enum(["up", "down", "left", "right"])
        .describe("The direction to scroll"),
    amount: z
        .number()
        .optional()
        .default(500)
        .describe("Number of pixels to scroll (default: 500)"),
});

export const browserExtractTextSchema = z.object({
    selector: z
        .string()
        .optional()
        .describe(
            "CSS selector for the element to extract text from. If omitted, extracts all visible text from the page."
        ),
});

export const browserScreenshotSchema = z.object({
    fullPage: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to capture the full page or just the viewport"),
    selector: z
        .string()
        .optional()
        .describe("CSS selector to screenshot a specific element"),
});

export const browserFillFormSchema = z.object({
    fields: z
        .array(
            z.object({
                selector: z.string().describe("CSS selector for the form field"),
                value: z.string().describe("Value to set"),
                type: z
                    .enum(["text", "select", "checkbox", "radio"])
                    .optional()
                    .default("text")
                    .describe("The type of form field"),
            })
        )
        .describe("Array of form fields to fill"),
});

export const browserEvaluateJsSchema = z.object({
    expression: z
        .string()
        .describe("JavaScript expression to evaluate in the page context"),
});

export const browserWaitSchema = z.object({
    selector: z
        .string()
        .optional()
        .describe("CSS selector to wait for"),
    timeout: z
        .number()
        .optional()
        .default(10000)
        .describe("Maximum time to wait in milliseconds (default: 10000)"),
    ms: z
        .number()
        .optional()
        .describe("Wait for a fixed number of milliseconds instead of a selector"),
});

export const browserGetLinksSchema = z.object({}).describe("No parameters needed — extracts all links from the current page");

export const browserGetPageSummarySchema = z.object({}).describe("No parameters needed — returns a structured summary of the current page");

export const browserFindElementsSchema = z.object({}).describe("No parameters needed — returns all interactive elements on the page");

export const browserPressKeySchema = z.object({
    key: z
        .string()
        .describe(
            'The key to press (e.g., "Enter", "Tab", "Escape", "ArrowDown")'
        ),
});

export const browserNewTabSchema = z.object({
    url: z
        .string()
        .url()
        .optional()
        .describe("URL to navigate to in the new tab"),
});

export const browserCloseTabSchema = z.object({}).describe("Close the current tab");

export const browserGoBackSchema = z.object({}).describe("Go back in browser history");

export const browserCloseSchema = z.object({}).describe("Close the browser instance");

// ---------------------------------------------------------------------------
// Tool Definitions for Agent Registration
// ---------------------------------------------------------------------------

export interface BrowserToolDefinition {
    name: string;
    description: string;
    schema: z.ZodType;
}

export const BROWSER_TOOLS: BrowserToolDefinition[] = [
    {
        name: "browser_navigate",
        description:
            "Navigate the browser to a specific URL. Use this to visit websites, open web applications, or go to specific pages.",
        schema: browserNavigateSchema,
    },
    {
        name: "browser_click",
        description:
            "Click an element on the current page. Use CSS selectors to target buttons, links, or other interactive elements.",
        schema: browserClickSchema,
    },
    {
        name: "browser_type",
        description:
            "Type text into an input field on the current page. Specify the CSS selector and the text to type.",
        schema: browserTypeSchema,
    },
    {
        name: "browser_scroll",
        description:
            "Scroll the current page in a specific direction. Useful for viewing content below the fold or navigating long pages.",
        schema: browserScrollSchema,
    },
    {
        name: "browser_extract_text",
        description:
            "Extract text content from the current page or a specific element. Use this to read page content, article text, product descriptions, etc.",
        schema: browserExtractTextSchema,
    },
    {
        name: "browser_screenshot",
        description:
            "Capture a screenshot of the current page or a specific element. Returns a base64-encoded PNG image.",
        schema: browserScreenshotSchema,
    },
    {
        name: "browser_fill_form",
        description:
            "Fill multiple form fields at once. Supports text inputs, selects, checkboxes, and radio buttons.",
        schema: browserFillFormSchema,
    },
    {
        name: "browser_evaluate_js",
        description:
            "Execute JavaScript code in the browser page context. Use for advanced interactions, DOM manipulation, or extracting data that requires JS execution.",
        schema: browserEvaluateJsSchema,
    },
    {
        name: "browser_wait",
        description:
            "Wait for a specific element to appear on the page or wait for a fixed duration. Use after navigation or actions that trigger page changes.",
        schema: browserWaitSchema,
    },
    {
        name: "browser_get_links",
        description:
            "Extract all links (anchors with href) from the current page. Returns an array of { text, href } objects.",
        schema: browserGetLinksSchema,
    },
    {
        name: "browser_get_page_summary",
        description:
            "Get a structured summary of the current page including title, URL, headings, links, form count, etc. Use this to understand the page before interacting.",
        schema: browserGetPageSummarySchema,
    },
    {
        name: "browser_find_elements",
        description:
            "Find all interactive elements on the page (buttons, links, inputs, etc.) with their selectors. Use this to discover what actions are available.",
        schema: browserFindElementsSchema,
    },
    {
        name: "browser_press_key",
        description:
            'Press a keyboard key (e.g., "Enter", "Tab", "Escape", "ArrowDown"). Use after typing to submit forms or for keyboard navigation.',
        schema: browserPressKeySchema,
    },
    {
        name: "browser_new_tab",
        description:
            "Open a new browser tab, optionally navigating to a URL. Use for multi-tab workflows.",
        schema: browserNewTabSchema,
    },
    {
        name: "browser_close_tab",
        description: "Close the current browser tab and switch to the previous one.",
        schema: browserCloseTabSchema,
    },
    {
        name: "browser_go_back",
        description: "Navigate back in the browser history to the previous page.",
        schema: browserGoBackSchema,
    },
    {
        name: "browser_close",
        description:
            "Close the browser instance entirely. Use when all browser tasks are complete.",
        schema: browserCloseSchema,
    },
];

/**
 * Get all browser tool names for quick lookup.
 */
export const BROWSER_TOOL_NAMES = new Set(BROWSER_TOOLS.map((t) => t.name));

/**
 * Check if a tool name is a browser tool.
 */
export function isBrowserTool(name: string): boolean {
    return BROWSER_TOOL_NAMES.has(name);
}
