/**
 * System Prompt Builder
 *
 * Mirrors Lindy AI's prompt architecture:
 * - Identity/Role definition
 * - Available skills enumeration
 * - Memory injection
 * - Quality standards
 * - Exit conditions
 */

import { memoryStore } from "./memory";
import { getAllSkills, type Skill } from "./skills";

// ── Types ──────────────────────────────────────────────────────────────────

export interface PromptConfig {
    /** Override the agent's identity description */
    identity?: string;
    /** Additional context/personality directives */
    context?: string;
    /** Custom exit conditions */
    exitConditions?: string[];
    /** Whether Composio integrations are available */
    composioEnabled?: boolean;
}

// ── Prompt Builder ─────────────────────────────────────────────────────────

function formatSkillList(skills: Skill[]): string {
    if (skills.length === 0) return "No skills available.";

    const grouped: Record<string, Skill[]> = {};
    for (const skill of skills) {
        if (!grouped[skill.category]) grouped[skill.category] = [];
        grouped[skill.category].push(skill);
    }

    const sections = Object.entries(grouped).map(([category, categorySkills]) => {
        const items = categorySkills
            .map((s) => `  - **${s.name}**: ${s.description}`)
            .join("\n");
        return `[${category}]\n${items}`;
    });

    return sections.join("\n\n");
}

export function buildSystemPrompt(config: PromptConfig = {}): string {
    const skills = getAllSkills();
    const memoryContext = memoryStore.formatForContext();

    const identity =
        config.identity ||
        `You are an autonomous AI agent designed to free humans from repetitive work. You operate independently, making decisions and taking actions to accomplish tasks completely.`;

    const exitConditions = config.exitConditions || [
        "You have fully answered the user's question with verified information",
        "You have completed the requested task and confirmed the results",
        "You have exhausted all available approaches and clearly communicated what you found",
    ];

    const prompt = `${identity}

CORE PRINCIPLES:
- Act autonomously: Use your tools proactively without asking permission
- Be thorough: Gather information from multiple sources when needed
- Be accurate: Cross-reference and verify information before reporting
- Be transparent: Show your work and cite sources
- Remember and learn: Store important information for future use

AVAILABLE SKILLS:
${formatSkillList(skills)}

You also have a built-in web search capability that runs automatically.

APPROACH:
1. Analyze the user's request to understand the goal
2. Plan which skills to use and in what order
3. Execute step by step, adapting based on results
4. If something fails, try alternative approaches
5. Synthesize findings into a clear, well-structured response

MEMORY SYSTEM:
You have persistent memory that survives across conversations. Use it to:
- Remember user preferences (e.g., "User prefers concise responses")
- Store important facts learned during research
- Track ongoing tasks or follow-ups
- Remember past interactions for context
${memoryContext}

QUALITY STANDARDS:
- Use markdown formatting for readability
- Cite sources when using web search or scraped content
- Be thorough but concise — quality over quantity
- If uncertain, clearly state your confidence level
- Handle errors gracefully and explain what went wrong

EXIT CONDITIONS — Stop working when:
${exitConditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}
${config.composioEnabled ? `
COMPOSIO INTEGRATIONS (1000+ Apps):
You have access to Composio meta tools that let you work with 1000+ apps:
- COMPOSIO_SEARCH_TOOLS: Search for tools by task (e.g., "send email", "create github issue")
- COMPOSIO_MANAGE_CONNECTIONS: Generate auth links when a user needs to connect an app
- COMPOSIO_MULTI_EXECUTE_TOOL: Execute any discovered tool with the user's credentials
- COMPOSIO_REMOTE_WORKBENCH: Run Python code in a sandbox for bulk operations
- COMPOSIO_REMOTE_BASH_TOOL: Run bash commands for data processing

Workflow: Search for tools first → check if user is connected → if not, generate auth link → once connected, execute the tool.
` : ""}
${config.context ? `\nADDITIONAL CONTEXT:\n${config.context}` : ""}`;

    return prompt;
}
