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
 */
export function getAgentTools(): (BuiltInTool | FunctionToolDefinition)[] {
  return [
    ...builtInTools,
    ...getCustomTools(),
    ...getBrowserTools(),
    ...getSandboxTools(),
  ];
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
