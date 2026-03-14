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
import { memoryStore } from "./memory";
import { scrapeUrl } from "./executors/web-scraper";
import { makeHttpRequest } from "./executors/http-request";
import { runCode } from "./executors/code-runner";
import { perplexitySearch } from "./executors/perplexity-search";
import { parallelWebSearch, parallelExtract } from "./executors/parallel-search";
import { searchKnowledge } from "./executors/embedding-search";
import "./executors/pull-image";

// ── Types ──────────────────────────────────────────────────────────────────

export type SkillCategory =
    | "web-browsing"
    | "utilities"
    | "http"
    | "email"
    | "calendar"
    | "code"
    | "reasoning";

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
            "Fetch and extract text content from a web page URL. Use this to read articles, documentation, or any web page content.",
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
            "Search the web and get ranked results with URLs, titles, and excerpts. Use for finding web pages, articles, news, and sources on any topic.",
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
            "Ask Perplexity AI a question and get a comprehensive answer with citations. Use when you need a synthesized answer rather than raw web results.",
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
            },
            required: ["content"],
        },
    },
    executor: async (args) => {
        if (typeof args.content !== "string" || !args.content.trim()) {
            return JSON.stringify({ error: "content must be a non-empty string" });
        }
        const memory = await memoryStore.create(args.content);
        return JSON.stringify({
            success: true,
            memory: { id: memory.id, content: memory.content },
            message: "Memory stored successfully",
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

