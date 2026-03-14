/**
 * Skills Registry
 *
 * Mirrors Lindy AI's skills system. Each skill has:
 * - Name & description
 * - Category for organization
 * - Tool definition (OpenAI function-calling schema)
 * - Executor function
 *
 * Categories mirror Lindy's skill organization:
 * - web-browsing (web search, web scraper)
 * - utilities (memory, code runner, set variables)
 * - http (HTTP request maker)
 * - email (send/search email)
 * - calendar (create/list events)
 */

import type { FunctionToolDefinition } from "./tools";
import { memoryStore, type MemoryCategory } from "./memory";
import { scrapeUrl } from "./executors/web-scraper";
import { makeHttpRequest } from "./executors/http-request";
import { runCode } from "./executors/code-runner";
import { perplexitySearch } from "./executors/perplexity-search";
import { parallelWebSearch, parallelExtract } from "./executors/parallel-search";
import { searchKnowledge } from "./executors/embedding-search";
import { executeSubAgent } from "./executors/sub-agent-executor";
import { listSubAgents } from "./sub-agents";
import {
    listTriggerTypes,
    createTrigger,
    listActiveTriggers,
    enableTrigger,
    disableTrigger,
    deleteTrigger,
    getRecentEvents,
} from "./triggers";

// Force sub-agent registration on module load
import "./sub-agents";

// ── Types ──────────────────────────────────────────────────────────────────

export type SkillCategory =
    | "web-browsing"
    | "utilities"
    | "http"
    | "email"
    | "calendar"
    | "code"
    | "reasoning"
    | "triggers";

export interface Skill {
    name: string;
    description: string;
    category: SkillCategory;
    toolDefinition: FunctionToolDefinition;
    executor: (args: Record<string, unknown>) => Promise<string>;
}

// ── Registry ───────────────────────────────────────────────────────────────

const skills: Map<string, Skill> = new Map();

export function registerSkill(skill: Skill) {
    if (skills.has(skill.name)) {
        // Allow identical re-registration (module reload), block mismatches
        const existing = skills.get(skill.name)!;
        if (existing.toolDefinition.name !== skill.toolDefinition.name) {
            throw new Error(`Skill registration conflict: ${skill.name}`);
        }
        return; // no-op for identical re-registration
    }
    skills.set(skill.name, skill);
}

export function getSkill(name: string): Skill | undefined {
    return skills.get(name);
}

export function getAllSkills(): Skill[] {
    return Array.from(skills.values());
}

export function getSkillsByCategory(category: SkillCategory): Skill[] {
    return getAllSkills().filter((s) => s.category === category);
}

export function getToolDefinitions(): FunctionToolDefinition[] {
    return getAllSkills().map((s) => s.toolDefinition);
}

export async function executeSkill(
    name: string,
    args: Record<string, unknown>
): Promise<string> {
    const skill = skills.get(name);
    if (!skill) {
        return JSON.stringify({ error: `Unknown skill: ${name}` });
    }
    try {
        return await skill.executor(args);
    } catch (err) {
        const message = (err as Error).message || "Skill execution failed";
        console.error(`[skills] Error executing ${name}:`, message);
        return JSON.stringify({ error: message, skill: name });
    }
}

// ── Arg Validation Helper ───────────────────────────────────────────────────

function asNonEmptyString(v: unknown): string | undefined {
    return typeof v === "string" && v.trim() ? v : undefined;
}

// ── Built-in Skills Registration ────────────────────────────────────────────

// Web Scraper — mirrors Lindy's "Website Content Crawler"
registerSkill({
    name: "scrape_website",
    description:
        "Fetch and extract text content from a web page URL. Use this to read articles, documentation, or any web page content.",
    category: "web-browsing",
    toolDefinition: {
        type: "function",
        name: "scrape_website",
        description:
            "Fetch and extract text content from a web page URL. Best for static pages like articles, docs, blog posts. Examples: scrape_website('https://docs.python.org/3/tutorial/') to read Python docs, scrape_website('https://en.wikipedia.org/wiki/Anthropic') for a Wikipedia article.",
        parameters: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "The full URL of the web page to scrape",
                },
            },
            required: ["url"],
        },
    },
    executor: async (args) => {
        const url = asNonEmptyString(args.url);
        if (!url) return JSON.stringify({ error: "url must be a non-empty string" });
        return scrapeUrl(url);
    },
});

// Web Search — Parallel AI Search API (ranked URLs with excerpts)
registerSkill({
    name: "web_search",
    description:
        "Search the web for current information. Returns ranked URLs with titles, excerpts, and publish dates. Best for finding specific web pages, articles, and sources.",
    category: "web-browsing",
    toolDefinition: {
        type: "function",
        name: "web_search",
        description:
            "Search the web and get ranked results with URLs, titles, and excerpts. Examples of effective queries: 'Anthropic Series C funding amount 2024', 'best React state management library comparison', 'site:github.com openai function calling'. Use specific keywords, include dates for recent info, use site: for domain-scoped searches.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "The search query — be specific and descriptive for best results",
                },
                mode: {
                    type: "string",
                    description:
                        "Search mode: 'fast' (lower latency), 'one-shot' (comprehensive), or 'agentic' (concise for tool loops). Default: fast",
                    enum: ["fast", "one-shot", "agentic"],
                },
            },
            required: ["query"],
        },
    },
    executor: async (args) => {
        const query = asNonEmptyString(args.query);
        if (!query) return JSON.stringify({ error: "query must be a non-empty string" });
        const validModes = ["fast", "one-shot", "agentic"] as const;
        const rawMode = args.mode as string;
        const mode = validModes.includes(rawMode as typeof validModes[number])
            ? (rawMode as typeof validModes[number])
            : "fast";
        return parallelWebSearch(query, mode);
    },
});

// Extract URL — Parallel AI Extract API (scrape content from specific URLs)
registerSkill({
    name: "extract_url",
    description:
        "Extract and read the content of one or more web pages. Returns clean, LLM-optimized excerpts from the URLs. Use when you have specific URLs to read.",
    category: "web-browsing",
    toolDefinition: {
        type: "function",
        name: "extract_url",
        description:
            "Extract content from specific URLs. Returns clean excerpts. Use when you need to read the content of known web pages.",
        parameters: {
            type: "object",
            properties: {
                urls: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "One or more URLs to extract content from",
                },
                objective: {
                    type: "string",
                    description:
                        "Optional objective to focus the extraction on specific information",
                },
            },
            required: ["urls"],
        },
    },
    executor: async (args) => {
        const urls = args.urls as string[];
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
            return JSON.stringify({ error: "urls must be a non-empty array of strings" });
        }
        const objective = asNonEmptyString(args.objective);
        return parallelExtract(urls, objective || undefined);
    },
});

// Ask Perplexity — LLM knowledge search via Perplexity Sonar (OpenRouter)
registerSkill({
    name: "ask_perplexity",
    description:
        "Ask Perplexity AI for a comprehensive, synthesized answer with source citations. Best for questions that need a direct answer rather than a list of links.",
    category: "web-browsing",
    toolDefinition: {
        type: "function",
        name: "ask_perplexity",
        description:
            "Ask Perplexity AI a question and get a comprehensive answer with citations. Best for complex questions needing synthesis, e.g.: 'Compare the pros and cons of PostgreSQL vs MongoDB for a SaaS app', 'What are the latest FDA regulations on AI in healthcare?', 'Explain how transformer attention mechanisms work'.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "The question to ask Perplexity — be specific for best results",
                },
            },
            required: ["query"],
        },
    },
    executor: async (args) => {
        const query = asNonEmptyString(args.query);
        if (!query) return JSON.stringify({ error: "query must be a non-empty string" });
        return perplexitySearch(query);
    },
});

// HTTP Request — mirrors Lindy's "HTTP Request" skill
registerSkill({
    name: "http_request",
    description:
        "Make an HTTP request to any API endpoint. Supports GET, POST, PUT, PATCH, DELETE methods.",
    category: "http",
    toolDefinition: {
        type: "function",
        name: "http_request",
        description:
            "Make an HTTP request to any API endpoint. Supports GET, POST, PUT, PATCH, DELETE.",
        parameters: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "The API endpoint URL",
                },
                method: {
                    type: "string",
                    enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
                    description: "HTTP method (default: GET)",
                },
                headers: {
                    type: "object",
                    description: "Optional HTTP headers as key-value pairs",
                },
                body: {
                    type: "string",
                    description:
                        "Request body as a JSON string (for POST/PUT/PATCH)",
                },
            },
            required: ["url"],
        },
    },
    executor: async (args) => {
        const url = asNonEmptyString(args.url);
        if (!url) return JSON.stringify({ error: "url must be a non-empty string" });
        const method = typeof args.method === "string" ? args.method : undefined;
        const headers = args.headers && typeof args.headers === "object"
            ? (args.headers as Record<string, string>)
            : undefined;
        const body = typeof args.body === "string" ? args.body : undefined;
        return makeHttpRequest({ url, method, headers, body });
    },
});

// Run Code — mirrors Lindy's "Run Code" skill
registerSkill({
    name: "run_code",
    description:
        "Execute JavaScript code in a sandboxed environment. Use for calculations, data transformations, or logic. No network/filesystem access.",
    category: "code",
    toolDefinition: {
        type: "function",
        name: "run_code",
        description:
            "Execute JavaScript code in a sandboxed environment. Use for calculations, data transformations, or logic processing. No network or filesystem access.",
        parameters: {
            type: "object",
            properties: {
                code: {
                    type: "string",
                    description: "JavaScript code to execute",
                },
            },
            required: ["code"],
        },
    },
    executor: async (args) => {
        const code = asNonEmptyString(args.code);
        if (!code) return JSON.stringify({ error: "code must be a non-empty string" });
        return runCode(code);
    },
});

// ── Memory Skills — mirrors Lindy's Memory Actions ──────────────────────────

registerSkill({
    name: "read_memories",
    description:
        "Read all stored memories. Use this to recall information saved from previous conversations.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "read_memories",
        description:
            "Read all stored memories to recall information from previous conversations.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "Optional search query to filter memories by keyword",
                },
            },
            required: [],
        },
    },
    executor: async (args) => {
        const query = typeof args.query === "string" && args.query.trim()
            ? args.query
            : undefined;
        const memories = query
            ? await memoryStore.search(query)
            : await memoryStore.readAll();
        return JSON.stringify({
            count: memories.length,
            memories: memories.map((m) => ({
                id: m.id,
                content: m.content,
                createdAt: m.createdAt,
            })),
        });
    },
});

registerSkill({
    name: "create_memory",
    description:
        "Store a new memory that persists across conversations. Use this to remember user preferences, important facts, or learned information.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "create_memory",
        description:
            "Store a new persistent memory. Use to remember user preferences, important facts, or learned information.",
        parameters: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description:
                        "The information to remember (be concise but specific)",
                },
                category: {
                    type: "string",
                    enum: ["preference", "fact", "instruction", "correction"],
                    description:
                        "Memory category: 'preference' (user style/prefs), 'fact' (learned info), 'instruction' (operational rules), 'correction' (lessons from mistakes). Default: fact",
                },
            },
            required: ["content"],
        },
    },
    executor: async (args) => {
        if (typeof args.content !== "string" || !args.content.trim()) {
            return JSON.stringify({ error: "content must be a non-empty string" });
        }
        const validCategories: MemoryCategory[] = ["preference", "fact", "instruction", "correction"];
        const category: MemoryCategory = validCategories.includes(args.category as MemoryCategory)
            ? (args.category as MemoryCategory)
            : "fact";
        const memory = await memoryStore.create(args.content, category);
        return JSON.stringify({
            success: true,
            memory: { id: memory.id, content: memory.content, category: memory.category },
            message: "Memory stored successfully",
        });
    },
});

// Save Learning — self-improving agent memory (inspired by Lindy's auto-learning)
registerSkill({
    name: "save_learning",
    description:
        "PROACTIVELY save a lesson learned during this conversation. Call this when: (1) a user corrects your output, (2) you discover a working API configuration, (3) a tool fails and you figure out why, (4) the user states a preference. This is how you SELF-IMPROVE across conversations.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "save_learning",
        description:
            "Save a lesson learned for future reference. Use proactively when you discover something useful.",
        parameters: {
            type: "object",
            properties: {
                learning: {
                    type: "string",
                    description:
                        "What you learned — be specific and actionable (e.g., 'User prefers tables over bullet lists' or 'GitHub API needs Accept header')",
                },
                category: {
                    type: "string",
                    enum: ["preference", "fact", "instruction", "correction"],
                    description:
                        "Category: 'preference' (user style), 'fact' (discovered info), 'instruction' (operational rule), 'correction' (mistake lesson)",
                },
            },
            required: ["learning", "category"],
        },
    },
    executor: async (args) => {
        const learning = asNonEmptyString(args.learning);
        if (!learning) return JSON.stringify({ error: "learning must be a non-empty string" });

        const validCategories: MemoryCategory[] = ["preference", "fact", "instruction", "correction"];
        const category: MemoryCategory = validCategories.includes(args.category as MemoryCategory)
            ? (args.category as MemoryCategory)
            : "correction";

        const memory = await memoryStore.create(learning, category);
        return JSON.stringify({
            success: true,
            memory: { id: memory.id, content: memory.content, category: memory.category },
            message: `Learning saved as ${category} — will be applied in future conversations`,
        });
    },
});

registerSkill({
    name: "update_memory",
    description:
        "Update an existing memory with new information.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "update_memory",
        description: "Update an existing memory with new information.",
        parameters: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "The memory ID to update",
                },
                content: {
                    type: "string",
                    description: "The new content for the memory",
                },
            },
            required: ["id", "content"],
        },
    },
    executor: async (args) => {
        if (typeof args.id !== "string" || !args.id.trim()) {
            return JSON.stringify({ error: "id must be a non-empty string" });
        }
        if (typeof args.content !== "string" || !args.content.trim()) {
            return JSON.stringify({ error: "content must be a non-empty string" });
        }
        const memory = await memoryStore.update(args.id, args.content);
        if (!memory) {
            return JSON.stringify({ error: "Memory not found", id: args.id });
        }
        return JSON.stringify({
            success: true,
            memory: { id: memory.id, content: memory.content },
        });
    },
});

registerSkill({
    name: "delete_memory",
    description: "Delete a stored memory by its ID.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "delete_memory",
        description: "Delete a stored memory by its ID.",
        parameters: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "The memory ID to delete",
                },
            },
            required: ["id"],
        },
    },
    executor: async (args) => {
        if (typeof args.id !== "string" || !args.id.trim()) {
            return JSON.stringify({ error: "id must be a non-empty string" });
        }
        const deleted = await memoryStore.delete(args.id);
        if (!deleted) {
            return JSON.stringify({ error: "Memory not found", id: args.id });
        }
        return JSON.stringify({
            success: true,
            message: "Memory deleted successfully",
        });
    },
});

// ── Integration Discovery — mirrors Lindy's "Get New Skills" ─────────────

registerSkill({
    name: "discover_integration",
    description:
        "Search for API documentation and integration methods for a service that doesn't have a native Composio tool. Searches the web for the service's REST API docs, reads them, and returns a structured report with API base URL, authentication method, key endpoints, and a suggested integration plan using http_request.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "discover_integration",
        description:
            "Search for API documentation and integration methods for a service without a native integration. Returns a structured report with API details and a suggested plan.",
        parameters: {
            type: "object",
            properties: {
                service_name: {
                    type: "string",
                    description:
                        "The name of the service to discover (e.g. 'Folks CRM', 'Airtable', 'Notion')",
                },
                use_case: {
                    type: "string",
                    description:
                        "What the user wants to accomplish (e.g. 'create contacts from emails', 'sync spreadsheet data')",
                },
            },
            required: ["service_name", "use_case"],
        },
    },
    executor: async (args) => {
        const serviceName = asNonEmptyString(args.service_name);
        const useCase = asNonEmptyString(args.use_case);
        if (!serviceName) return JSON.stringify({ error: "service_name must be a non-empty string" });
        if (!useCase) return JSON.stringify({ error: "use_case must be a non-empty string" });

        const report: {
            service: string;
            use_case: string;
            api_docs_searched: string[];
            api_findings: string[];
            suggested_plan: string;
        } = {
            service: serviceName,
            use_case: useCase,
            api_docs_searched: [],
            api_findings: [],
            suggested_plan: "",
        };

        // Step 1: Search for API docs using web scraping of search results
        const searchQueries = [
            `${serviceName} API documentation REST endpoint`,
            `${serviceName} developer API authentication how to`,
        ];

        for (const query of searchQueries) {
            try {
                // Use our http_request executor to search via a search engine
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=3`;
                const searchResult = await makeHttpRequest({
                    url: searchUrl,
                    method: "GET",
                    headers: {
                        "User-Agent": "Mozilla/5.0 (compatible; RantChat/1.0)",
                    },
                });
                report.api_docs_searched.push(query);

                // Extract any URLs from the search results that look like API docs
                const urlMatches = searchResult.match(/https?:\/\/[^\s"'<>]+(?:api|developer|docs|documentation)[^\s"'<>]*/gi);
                if (urlMatches && urlMatches.length > 0) {
                    // Try to scrape the first API doc URL
                    const docUrl = urlMatches[0];
                    try {
                        const docContent = await scrapeUrl(docUrl);
                        const parsed = JSON.parse(docContent);
                        const text = (parsed.content || parsed.text || "").slice(0, 3000);
                        if (text.length > 100) {
                            report.api_findings.push(
                                `Found API docs at ${docUrl}:\n${text}`
                            );
                        }
                    } catch {
                        report.api_findings.push(`Found potential docs URL: ${docUrl} (could not scrape)`);
                    }
                }
            } catch (err) {
                report.api_findings.push(`Search failed for "${query}": ${(err as Error).message}`);
            }
        }

        // Step 2: Generate a suggested plan
        if (report.api_findings.length > 0) {
            report.suggested_plan = [
                `Based on the API documentation found for ${serviceName}:`,
                ``,
                `1. **Get API credentials** — Ask the user for their ${serviceName} API key or OAuth token`,
                `2. **Test the connection** — Make a simple GET request to verify authentication works`,
                `3. **Implement the use case** — Use http_request to call the specific endpoints for: ${useCase}`,
                `4. **Store the config** — Save the working API details in memory for future use`,
                ``,
                `The user should provide their API key/token to proceed.`,
            ].join("\n");
        } else {
            report.suggested_plan = [
                `Could not find REST API documentation for ${serviceName}.`,
                ``,
                `Alternative approaches:`,
                `1. Ask the user if ${serviceName} has a developer portal or API docs`,
                `2. Check if there's a Zapier or webhook integration available`,
                `3. Try web scraping the ${serviceName} interface as a last resort`,
            ].join("\n");
        }

        return JSON.stringify(report, null, 2);
    },
});

// ── Think — Devin-inspired reasoning scratchpad ─────────────────────────────

registerSkill({
    name: "think",
    description:
        "A private reasoning scratchpad. Use this to plan your approach, reflect on results, verify your work, or reason through complex decisions. Your thoughts are NOT shown to the user — they are purely for your own reasoning. This is a zero-cost tool: it executes instantly and returns your thoughts back to you.",
    category: "reasoning",
    toolDefinition: {
        type: "function",
        name: "think",
        description:
            "Private reasoning scratchpad. Use BEFORE starting work (to plan), DURING work (to evaluate results and decide next steps), and BEFORE completing (to self-verify). Think before you act.",
        parameters: {
            type: "object",
            properties: {
                thought: {
                    type: "string",
                    description:
                        "Your private reasoning. Plan steps, evaluate results, consider alternatives, verify work quality. Be thorough — this is your internal monologue.",
                },
            },
            required: ["thought"],
        },
    },
    // Zero-cost executor: returns the thought back as confirmation
    async executor(args) {
        const thought = asNonEmptyString(args.thought);
        if (!thought) return "No thought provided.";
        // The think tool doesn't DO anything — it just gives the model
        // a place to reason. Return a brief acknowledgment.
        return `[Thought recorded] Continue with your next action based on this reasoning.`;
    },
});

// ── Task Plan — structured planning tool ────────────────────────────────────

registerSkill({
    name: "task_plan",
    description:
        "Create a structured numbered plan before executing a multi-step task. This helps you stay organized and ensures you don't miss steps. Call this ONCE at the start of a complex task.",
    category: "reasoning",
    toolDefinition: {
        type: "function",
        name: "task_plan",
        description:
            "Create a numbered execution plan for a multi-step task. Call this before you start using other tools. The plan helps you stay organized.",
        parameters: {
            type: "object",
            properties: {
                goal: {
                    type: "string",
                    description: "The overall goal you are trying to accomplish",
                },
                steps: {
                    type: "string",
                    description:
                        "A numbered list of steps you will take to accomplish the goal (e.g., '1. Search for X\\n2. Scrape top results\\n3. Analyze findings\\n4. Compile report')",
                },
                estimated_rounds: {
                    type: "number",
                    description:
                        "Estimated number of tool rounds this will take (1-15)",
                },
            },
            required: ["goal", "steps"],
        },
    },
    async executor(args) {
        const goal = asNonEmptyString(args.goal);
        const steps = asNonEmptyString(args.steps);
        if (!goal || !steps)
            return "Plan must include a goal and numbered steps.";
        return `[Plan created] Goal: ${goal}\n\nSteps:\n${steps}\n\nProceed with step 1.`;
    },
});

// ── Knowledge Base Search — Gemini Embedding 2 + Convex RAG ─────────────

registerSkill({
    name: "search_knowledge",
    description:
        "Search the user's uploaded knowledge base for relevant content. This searches across ALL uploaded files — images, PDFs, videos, audio files, and text documents — using semantic similarity powered by Gemini Embedding 2. Use this to find information from previously uploaded files.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "search_knowledge",
        description:
            "Search the user's knowledge base (uploaded images, PDFs, videos, audio, text files) using semantic search. Returns relevant content with scores and metadata. Use when the user asks about content from their uploaded files.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description:
                        "The search query — describe what you're looking for semantically. Can be a question, a topic, or a description of the content you need.",
                },
                namespace: {
                    type: "string",
                    description:
                        "The namespace to search in (required — typically the user's ID or a project-scoped key).",
                },
                limit: {
                    type: "number",
                    description:
                        "Maximum number of results to return (default: 10, max: 50)",
                },
                file_type: {
                    type: "string",
                    description:
                        "Optional filter by file type: 'image', 'document', 'video', 'audio', or 'text'",
                    enum: ["image", "document", "video", "audio", "text"],
                },
            },
            required: ["query", "namespace"],
        },
    },
    executor: async (args) => {
        const query = asNonEmptyString(args.query);
        if (!query) return JSON.stringify({ error: "query must be a non-empty string" });

        const namespace = typeof args.namespace === "string" && args.namespace.trim()
            ? args.namespace
            : undefined;
        if (!namespace) {
            return JSON.stringify({
                error: "namespace is required — provide the user's ID or a project-scoped namespace",
            });
        }
        const limit = typeof args.limit === "number" ? Math.min(args.limit, 50) : 10;
        const fileType = typeof args.file_type === "string" ? args.file_type : undefined;

        return searchKnowledge({ query, namespace, limit, fileType });
    },
});

// Pull Image — fetch external images and return as base64
registerSkill({
    name: "pull_image",
    description:
        "Fetches an image from a URL and returns it as base64 data. Use this when you want to display an image to the user. Do not use markdown ![alt](url), use this tool instead.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "pull_image",
        description:
            "Fetches an image from a URL and returns it as base64. Use this when you want to display an image to the user instead of markdown.",
        parameters: {
            type: "object",
            properties: {
                url: {
                    type: "string",
                    description: "The URL of the image to fetch",
                },
                alt: {
                    type: "string",
                    description: "A short description of the image for accessibility",
                },
            },
            required: ["url"],
        },
    },
    executor: async (args) => {
        const url = asNonEmptyString(args.url);
        if (!url) return JSON.stringify({ error: "url is required" });

        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    Referer: new URL(url).origin + "/",
                },
                redirect: "follow",
                signal: AbortSignal.timeout(15_000),
            });

            if (!response.ok) {
                return JSON.stringify({
                    error: `Failed to fetch image: ${response.status} ${response.statusText}`,
                });
            }

            const contentType =
                response.headers.get("content-type")?.split(";")[0].trim() || "image/png";
            if (!contentType.startsWith("image/")) {
                return JSON.stringify({ error: "URL did not return an image" });
            }

            const buffer = await response.arrayBuffer();
            const base64 = Buffer.from(buffer).toString("base64");

            return JSON.stringify({
                base64,
                mediaType: contentType,
                alt: typeof args.alt === "string" ? args.alt : undefined,
            });
        } catch (error) {
            return JSON.stringify({ error: (error as Error).message });
        }
    },
});

// ── Multi-Agent Handoff ───────────────────────────────────────────────────

registerSkill({
    name: "delegate_to",
    description:
        "DELEGATE a specialized task to a sub-agent. The sub-agent runs autonomously with its own model and tools, " +
        "then returns results back to you. Available sub-agents:\n" +
        "  • frontend-design — Creates stunning, production-grade web interfaces (websites, dashboards, landing pages, " +
        "React components) using Gemini 3 Flash. Has full sandbox access to write code, install packages, and run dev servers.\n\n" +
        "USE THIS when the user asks to build any visual web UI, page, component, poster, or application. " +
        "The design agent produces much higher quality frontend code than you can alone.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "delegate_to",
        description:
            "Delegate a task to a specialized sub-agent. Returns the sub-agent's response and any artifacts created.",
        parameters: {
            type: "object",
            properties: {
                agent: {
                    type: "string",
                    description:
                        "ID of the sub-agent to delegate to. Available: 'frontend-design'",
                },
                task: {
                    type: "string",
                    description:
                        "Detailed task description for the sub-agent. Be specific about requirements, style preferences, " +
                        "frameworks to use, and expected deliverables. The more detail you provide, the better the result.",
                },
            },
            required: ["agent", "task"],
        },
    },
    executor: async (args) => {
        const agentId = asNonEmptyString(args.agent);
        const task = asNonEmptyString(args.task);

        if (!agentId) return JSON.stringify({ error: "agent ID is required" });
        if (!task) return JSON.stringify({ error: "task description is required" });

        // Validate the sub-agent exists
        const availableAgents = listSubAgents();
        const agentIds = availableAgents.map((a) => a.id);
        if (!agentIds.includes(agentId)) {
            return JSON.stringify({
                error: `Unknown sub-agent "${agentId}". Available: ${agentIds.join(", ")}`,
                available: availableAgents.map((a) => ({
                    id: a.id,
                    name: a.name,
                    description: a.description,
                })),
            });
        }

        console.log(`[AGENT] 🤝 Delegating to sub-agent: ${agentId}`);
        console.log(`[AGENT]    Task: ${task.slice(0, 150)}...`);

        const result = await executeSubAgent(agentId, task);

        return JSON.stringify({
            success: result.success,
            agentName: result.agentName,
            response: result.response,
            toolRounds: result.toolRounds,
            toolCallsExecuted: result.toolCallsExecuted,
            artifacts: result.artifacts,
            ...(result.error && { error: result.error }),
        });
    },
});

// ── Trigger Management Skills ──────────────────────────────────────────────

registerSkill({
    name: "list_trigger_types",
    description:
        "Discover available trigger types for a connected app/toolkit. Returns trigger slugs, descriptions, and required config. Use this to find out what triggers are available before creating one.",
    category: "triggers",
    toolDefinition: {
        type: "function",
        name: "list_trigger_types",
        description:
            "List available trigger types for a toolkit (e.g., 'github', 'gmail', 'slack'). Returns trigger slugs and descriptions.",
        parameters: {
            type: "object",
            properties: {
                toolkit: {
                    type: "string",
                    description:
                        "The toolkit/app slug to list triggers for (e.g., 'github', 'gmail', 'slack', 'google_calendar'). Leave empty to list all.",
                },
            },
            required: [],
        },
    },
    executor: async (args) => {
        const toolkit = args.toolkit as string | undefined;
        const types = await listTriggerTypes(toolkit);

        if (types.length === 0) {
            return JSON.stringify({
                result: toolkit
                    ? `No trigger types found for toolkit "${toolkit}". Make sure the toolkit slug is correct (e.g., 'github', 'gmail', 'slack').`
                    : "No trigger types found. Ensure COMPOSIO_API_KEY is configured.",
                suggestion:
                    "Try list_trigger_types with a specific toolkit slug like 'github' or 'gmail'.",
            });
        }

        return JSON.stringify({
            count: types.length,
            toolkit: toolkit || "all",
            triggers: types.map((t) => ({
                slug: t.slug,
                name: t.name,
                description: t.description,
                toolkit: t.toolkit.name,
            })),
        });
    },
});

registerSkill({
    name: "create_trigger",
    description:
        "Create a new event-driven trigger for the user. The user must have a connected account for the relevant app. Triggers fire events when specific things happen (e.g., new email, GitHub commit, Slack message).",
    category: "triggers",
    toolDefinition: {
        type: "function",
        name: "create_trigger",
        description:
            "Create a new trigger that fires when an event occurs in a connected app. Requires the trigger slug (from list_trigger_types) and optional config.",
        parameters: {
            type: "object",
            properties: {
                slug: {
                    type: "string",
                    description:
                        "The trigger type slug (e.g., 'GITHUB_COMMIT_EVENT', 'GMAIL_NEW_EMAIL'). Use list_trigger_types to discover available slugs.",
                },
                config: {
                    type: "object",
                    description:
                        "Optional trigger configuration. Each trigger type may have different config fields (e.g., repo name for GitHub, label for Gmail).",
                },
                user_id: {
                    type: "string",
                    description:
                        "The user ID for the trigger. Defaults to 'default_user' if not specified.",
                },
            },
            required: ["slug"],
        },
    },
    executor: async (args) => {
        const slug = args.slug as string;
        const config = args.config as Record<string, unknown> | undefined;
        const userId = (args.user_id as string) || "default_user";

        const result = await createTrigger(userId, slug, config);
        return JSON.stringify(result);
    },
});

registerSkill({
    name: "list_active_triggers",
    description:
        "List all currently active triggers. Shows trigger IDs, names, states, and configurations.",
    category: "triggers",
    toolDefinition: {
        type: "function",
        name: "list_active_triggers",
        description:
            "List all active trigger instances. Returns trigger IDs, names, and current status.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    executor: async () => {
        const triggers = await listActiveTriggers();

        if (triggers.length === 0) {
            return JSON.stringify({
                result: "No active triggers found.",
                suggestion:
                    "Use create_trigger to set up a new trigger, or list_trigger_types to discover what's available.",
            });
        }

        return JSON.stringify({
            count: triggers.length,
            triggers: triggers.map((t) => ({
                id: t.id,
                name: t.triggerName,
                state: t.state,
                config: t.triggerConfig,
                updatedAt: t.updatedAt,
            })),
        });
    },
});

registerSkill({
    name: "manage_trigger",
    description:
        "Enable, disable, or delete an existing trigger by its ID. Use list_active_triggers first to find trigger IDs.",
    category: "triggers",
    toolDefinition: {
        type: "function",
        name: "manage_trigger",
        description:
            "Manage an existing trigger: enable, disable, or delete it.",
        parameters: {
            type: "object",
            properties: {
                trigger_id: {
                    type: "string",
                    description: "The trigger instance ID to manage.",
                },
                action: {
                    type: "string",
                    enum: ["enable", "disable", "delete"],
                    description:
                        "The action to perform: 'enable' to activate, 'disable' to pause, 'delete' to remove permanently.",
                },
            },
            required: ["trigger_id", "action"],
        },
    },
    executor: async (args) => {
        const triggerId = args.trigger_id as string;
        const action = args.action as "enable" | "disable" | "delete";

        let result;
        switch (action) {
            case "enable":
                result = await enableTrigger(triggerId);
                break;
            case "disable":
                result = await disableTrigger(triggerId);
                break;
            case "delete":
                result = await deleteTrigger(triggerId);
                break;
            default:
                return JSON.stringify({
                    error: `Invalid action "${action}". Use 'enable', 'disable', or 'delete'.`,
                });
        }

        return JSON.stringify({
            action,
            triggerId,
            ...result,
        });
    },
});

registerSkill({
    name: "get_trigger_events",
    description:
        "Get recent events received from triggers. Shows the latest events with their payloads. Useful for checking if triggers are working.",
    category: "triggers",
    toolDefinition: {
        type: "function",
        name: "get_trigger_events",
        description:
            "Get recent trigger events. Optionally filter by trigger ID or slug.",
        parameters: {
            type: "object",
            properties: {
                trigger_id: {
                    type: "string",
                    description:
                        "Optional trigger ID or slug to filter events by.",
                },
                limit: {
                    type: "number",
                    description:
                        "Maximum number of events to return. Defaults to 10.",
                },
            },
            required: [],
        },
    },
    executor: async (args) => {
        const triggerId = args.trigger_id as string | undefined;
        const limit = (args.limit as number) || 10;

        const events = getRecentEvents(triggerId, limit);

        if (events.length === 0) {
            return JSON.stringify({
                result: "No trigger events found.",
                suggestion: triggerId
                    ? `No events for trigger "${triggerId}". The trigger may not have fired yet, or the ID may be incorrect.`
                    : "No events received yet. Create a trigger and wait for it to fire, or check that your webhook endpoint is configured.",
            });
        }

        return JSON.stringify({
            count: events.length,
            events: events.map((e) => ({
                triggerSlug: e.triggerSlug,
                toolkitSlug: e.toolkitSlug,
                receivedAt: e.receivedAt,
                payload: e.payload,
            })),
        });
    },
});
