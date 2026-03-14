/**
 * Agent Tool Configuration
 *
 * Powered by the Skills Registry (mirrors Lindy AI's skill system)
 * plus Browser (Kernel) and Sandbox (E2B) tool systems.
 *
 * Web search uses Perplexity Sonar via OpenRouter (custom skill).
 * Custom function-calling tools are driven by the skills registry
 * and executed server-side by skill executors.
 * Browser tools are routed to the Kernel browser executor.
 * Sandbox tools are routed to the E2B sandbox executor.
 */

import { getToolDefinitions, executeSkill } from "./skills";
import { BROWSER_TOOLS, isBrowserTool } from "../browser";
import { SANDBOX_TOOLS, isSandboxTool } from "../sandbox";
import { executeBrowserTool } from "./executors/browser-executor";
import { executeSandboxTool } from "./executors/sandbox-executor";
import { zodToJsonSchema } from "./utils/zod-to-json-schema";

// ── Built-in tools (handled entirely by OpenAI) ───────────────────────────

export interface BuiltInTool {
  type: string;
  [key: string]: unknown;
}

export const builtInTools: BuiltInTool[] = [];

// ── Custom function-calling tools (from Skills Registry) ──────────────────

export interface FunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Get all custom tools from the skills registry.
 * Called at request time to get the latest registered skills.
 */
export function getCustomTools(): FunctionToolDefinition[] {
  return getToolDefinitions();
}

// ── Browser & Sandbox tools (Kernel + E2B) ────────────────────────────────

/**
 * Get browser tool definitions formatted for OpenAI function calling.
 */
export function getBrowserTools(): FunctionToolDefinition[] {
  return BROWSER_TOOLS.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.schema),
  }));
}

/**
 * Get sandbox tool definitions formatted for OpenAI function calling.
 */
export function getSandboxTools(): FunctionToolDefinition[] {
  return SANDBOX_TOOLS.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.schema),
  }));
}

/**
 * Get all tools (built-in + custom + browser + sandbox) for sending to OpenAI.
 * Returns the complete unfiltered tool set (fallback / backward-compat).
 */
export function getAgentTools(): (BuiltInTool | FunctionToolDefinition)[] {
  return [
    ...builtInTools,
    ...getCustomTools(),
    ...getBrowserTools(),
    ...getSandboxTools(),
  ];
}

// ── Context-Aware Skill Filtering (Lindy Pattern #9) ─────────────────────
// Instead of exposing all ~51 tools on every request, classify the user's
// intent and return only the relevant tool groups. Core tools (think,
// task_plan, memory) are always available.

type ToolMode =
  | "research"
  | "browser"
  | "build"
  | "design"
  | "desktop"
  | "integrations"
  | "general";

/** Core skills that are ALWAYS available regardless of intent. */
const CORE_SKILL_NAMES = new Set([
  "think",
  "task_plan",
  "run_code",
  "read_memories",
  "create_memory",
  "save_learning",
  "update_memory",
  "delete_memory",
  "search_knowledge",
]);

/** Research-oriented skills. */
const RESEARCH_SKILL_NAMES = new Set([
  "web_search",
  "ask_perplexity",
  "extract_url",
  "scrape_website",
  "http_request",
]);

/** Build/code-oriented skills. */
const BUILD_SKILL_NAMES = new Set([
  "pull_image",
]);

/** Design/delegation skills. */
const DESIGN_SKILL_NAMES = new Set([
  "delegate_to",
]);

/** Integration-discovery skills. */
const INTEGRATION_SKILL_NAMES = new Set([
  "discover_integration",
]);

/** Sandbox tools to include for coding (excludes desktop tools). */
const SANDBOX_CODE_TOOL_NAMES = new Set([
  "sandbox_execute_code",
  "sandbox_read_file",
  "sandbox_write_file",
  "sandbox_list_files",
  "sandbox_search_files",
  "sandbox_delete_file",
  "sandbox_create_archive",
  "sandbox_run_command",
  "sandbox_install_package",
  "sandbox_download_url",
  "sandbox_expose_port",
]);

/** Sandbox desktop automation tools. */
const SANDBOX_DESKTOP_TOOL_NAMES = new Set([
  "sandbox_screenshot",
  "sandbox_click",
  "sandbox_type_text",
  "sandbox_press_key",
  "sandbox_scroll_desktop",
  "sandbox_drag",
]);

/**
 * Lightweight keyword-based intent classifier.
 * Analyzes the user message and returns which tool modes are relevant.
 * Multiple modes can be returned for multi-faceted requests.
 */
export function classifyIntent(message: string): ToolMode[] {
  const lower = message.toLowerCase();
  const modes: ToolMode[] = [];

  // Research signals
  if (
    /\b(search|find|look\s*up|research|what\s+is|who\s+is|how\s+to|compare|analyz|explain|summarize|latest|news|tell\s+me\s+about)\b/.test(
      lower
    )
  ) {
    modes.push("research");
  }

  // Browser signals
  if (
    /\b(browse|navigat|website|log\s*in|fill.*form|click|go\s+to\s+(https?|www)|open.*page|scrape.*live|monitor.*site|pull.*from.*site)\b/.test(
      lower
    )
  ) {
    modes.push("browser");
  }

  // Build/code signals
  if (
    /\b(build|create|code|write.*script|python|javascript|typescript|app\b|dashboard|game|chart|calculat|generat.*pdf|csv|data\s*analy|machine\s*learn|install|pip|npm)\b/.test(
      lower
    )
  ) {
    modes.push("build");
  }

  // Design signals (UI-specific — triggers delegation)
  if (
    /\b(design|landing\s*page|ui\b|ux\b|beautiful|stunning|frontend|react|html|css|page.*look|poster|portfolio|hero\s*section|modal|card.*layout)\b/.test(
      lower
    )
  ) {
    modes.push("design");
  }

  // Desktop automation signals
  if (
    /\b(desktop|gui|automate.*app|screen.*capture|vnc|click.*button.*on|type.*into.*field)\b/.test(
      lower
    )
  ) {
    modes.push("desktop");
  }

  // Integration signals
  if (
    /\b(integrat|connect.*to|gmail|slack|notion|calendar|github|salesforce|hubspot|trello|jira|composio)\b/.test(
      lower
    )
  ) {
    modes.push("integrations");
  }

  // If no specific signals detected, return general (all tools)
  if (modes.length === 0) {
    modes.push("general");
  }

  return modes;
}

/**
 * Get agent tools filtered by the user's intent.
 * Reduces the total tool count from ~51 to ~10-25 for most requests.
 *
 * Core tools (think, task_plan, memory) are ALWAYS included.
 * Task-specific tools are only included when the message matches their patterns.
 * Falls back to the complete tool set for "general" (unclassified) messages.
 */
export function getFilteredAgentTools(
  userMessage: string
): (BuiltInTool | FunctionToolDefinition)[] {
  const modes = classifyIntent(userMessage);

  // Fallback: if "general" mode, return everything
  if (modes.includes("general")) {
    return getAgentTools();
  }

  // Start with built-in tools
  const tools: (BuiltInTool | FunctionToolDefinition)[] = [...builtInTools];

  // Determine which custom skill names to include
  const includedSkillNames = new Set(CORE_SKILL_NAMES);

  // Add research skills
  if (modes.includes("research")) {
    for (const name of RESEARCH_SKILL_NAMES) includedSkillNames.add(name);
  }

  // Add build skills + research (often needed for looking up how-to)
  if (modes.includes("build")) {
    for (const name of BUILD_SKILL_NAMES) includedSkillNames.add(name);
    for (const name of RESEARCH_SKILL_NAMES) includedSkillNames.add(name);
  }

  // Add design/delegation skills
  if (modes.includes("design")) {
    for (const name of DESIGN_SKILL_NAMES) includedSkillNames.add(name);
    for (const name of BUILD_SKILL_NAMES) includedSkillNames.add(name);
  }

  // Add integration skills
  if (modes.includes("integrations")) {
    for (const name of INTEGRATION_SKILL_NAMES) includedSkillNames.add(name);
    // Also include research for discovering APIs
    for (const name of RESEARCH_SKILL_NAMES) includedSkillNames.add(name);
  }

  // Filter custom tools to only included names
  const filteredCustomTools = getCustomTools().filter((t) =>
    includedSkillNames.has(t.name)
  );
  tools.push(...filteredCustomTools);

  // Add browser tools only if browser mode detected
  if (modes.includes("browser")) {
    tools.push(...getBrowserTools());
  }

  // Add sandbox tools based on mode
  if (modes.includes("build") || modes.includes("design")) {
    // For build/design: include code tools, not desktop
    const sandboxTools = getSandboxTools().filter((t) =>
      SANDBOX_CODE_TOOL_NAMES.has(t.name)
    );
    tools.push(...sandboxTools);
  }

  if (modes.includes("desktop")) {
    // For desktop: include all sandbox tools
    tools.push(...getSandboxTools());
  }

  // Log for observability
  console.log(
    `[TOOLS] Intent: [${modes.join(", ")}] → ${tools.length} tools (of ~51 total)`
  );

  return tools;
}

// ── Tool executor (dispatches to the correct executor) ────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  sessionId?: string
): Promise<string> {
  // Route browser_* tools to the browser executor (session-scoped)
  if (isBrowserTool(name)) {
    return executeBrowserTool(name, args, sessionId);
  }

  // Route sandbox_* tools to the sandbox executor (session-scoped)
  if (isSandboxTool(name)) {
    return executeSandboxTool(name, args, sessionId);
  }

  // Everything else goes to the skills registry
  return executeSkill(name, args);
}
