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
    return skill.executor(args);
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
    executor: async (args) => scrapeUrl(args.url as string),
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
    executor: async (args) =>
        makeHttpRequest({
            url: args.url as string,
            method: args.method as string | undefined,
            headers: args.headers as Record<string, string> | undefined,
            body: args.body as string | undefined,
        }),
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
    executor: async (args) => runCode(args.code as string),
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
        const query = args.query as string | undefined;
        const memories = query
            ? memoryStore.search(query)
            : memoryStore.readAll();
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
        const memory = memoryStore.create(args.content as string);
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
        const memory = memoryStore.update(
            args.id as string,
            args.content as string
        );
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
        const deleted = memoryStore.delete(args.id as string);
        if (!deleted) {
            return JSON.stringify({ error: "Memory not found", id: args.id });
        }
        return JSON.stringify({
            success: true,
            message: "Memory deleted successfully",
        });
    },
});
