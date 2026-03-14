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
import { secretsStore } from "./secrets";

// ── Types ──────────────────────────────────────────────────────────────────

export type SkillCategory =
    | "web-browsing"
    | "utilities"
    | "http"
    | "email"
    | "calendar"
    | "code";

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

// ── Secrets Management — Encrypted API Key Storage ───────────────────────


registerSkill({
    name: "store_secret",
    description:
        "Securely store an API key, token, or credential. Encrypted at rest using AES-256-GCM. Use this when a user provides an API key or token for a service integration.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "store_secret",
        description:
            "Securely store an API key, token, or credential for later use. Values are encrypted at rest.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description:
                        "A descriptive name for the secret (e.g. 'folk_crm_api_key', 'notion_token'). Use lowercase with underscores.",
                },
                value: {
                    type: "string",
                    description: "The secret value to store (API key, token, etc.)",
                },
            },
            required: ["name", "value"],
        },
    },
    executor: async (args) => {
        const name = typeof args.name === "string" ? args.name.trim() : "";
        const value = typeof args.value === "string" ? args.value.trim() : "";
        if (!name) return JSON.stringify({ error: "name must be a non-empty string" });
        if (!value) return JSON.stringify({ error: "value must be a non-empty string" });

        // Sanitize name to lowercase with underscores
        const safeName = name.toLowerCase().replace(/[^a-z0-9_]/g, "_");
        secretsStore.store(safeName, value);

        return JSON.stringify({
            success: true,
            message: `Secret "${safeName}" stored securely`,
            name: safeName,
        });
    },
});

registerSkill({
    name: "get_secret",
    description:
        "Retrieve a previously stored API key, token, or credential by name. Returns the decrypted value.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "get_secret",
        description:
            "Retrieve a previously stored secret (API key, token) by name.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "The name of the secret to retrieve",
                },
            },
            required: ["name"],
        },
    },
    executor: async (args) => {
        const name = typeof args.name === "string"
            ? args.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")
            : "";
        if (!name) return JSON.stringify({ error: "name must be a non-empty string" });

        const value = secretsStore.get(name);
        if (value === null) {
            return JSON.stringify({
                error: "Secret not found",
                name,
                available: secretsStore.list(),
            });
        }

        return JSON.stringify({ success: true, name, value });
    },
});

registerSkill({
    name: "list_secrets",
    description:
        "List the names of all stored secrets. Does NOT return the secret values — only the names.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "list_secrets",
        description:
            "List all stored secret names. Returns names only, not values.",
        parameters: {
            type: "object",
            properties: {},
            required: [],
        },
    },
    executor: async () => {
        const names = secretsStore.list();
        return JSON.stringify({
            count: names.length,
            secrets: names,
            message: names.length > 0
                ? `${names.length} secret(s) stored: ${names.join(", ")}`
                : "No secrets stored yet",
        });
    },
});

registerSkill({
    name: "delete_secret",
    description:
        "Delete a stored secret by name. Use when a user wants to remove a credential.",
    category: "utilities",
    toolDefinition: {
        type: "function",
        name: "delete_secret",
        description: "Delete a stored secret by name.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "The name of the secret to delete",
                },
            },
            required: ["name"],
        },
    },
    executor: async (args) => {
        const name = typeof args.name === "string"
            ? args.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")
            : "";
        if (!name) return JSON.stringify({ error: "name must be a non-empty string" });

        const deleted = secretsStore.delete(name);
        if (!deleted) {
            return JSON.stringify({
                error: "Secret not found",
                name,
                available: secretsStore.list(),
            });
        }

        return JSON.stringify({
            success: true,
            message: `Secret "${name}" deleted`,
        });
    },
});
