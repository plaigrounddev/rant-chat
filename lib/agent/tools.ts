/**
 * Agent Tool Configuration
 *
 * Powered by the Skills Registry (mirrors Lindy AI's skill system).
 *
 * Built-in tools (web_search_preview) are handled by OpenAI.
 * Custom function-calling tools are driven by the skills registry
 * and executed server-side by skill executors.
 */

import { getToolDefinitions, executeSkill } from "./skills";

// ── Built-in tools (handled entirely by OpenAI) ───────────────────────────

export interface BuiltInTool {
  type: string;
  [key: string]: unknown;
}

export const builtInTools: BuiltInTool[] = [
  {
    type: "web_search_preview",
  },
];

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

/**
 * Get all tools (built-in + custom) for sending to OpenAI.
 */
export function getAgentTools(): (BuiltInTool | FunctionToolDefinition)[] {
  return [...builtInTools, ...getCustomTools()];
}

// ── Custom tool executor (dispatches to skill executors) ──────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  return executeSkill(name, args);
}
