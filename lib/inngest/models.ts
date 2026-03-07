/**
 * Multi-Model Registry
 *
 * Supports OpenAI, Anthropic (Claude), and Google (Gemini).
 * Falls back to OpenAI if other providers aren't configured.
 * Each workflow step selects the best model for the task.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ModelProvider = "openai" | "anthropic" | "google";

export interface ModelConfig {
    provider: ModelProvider;
    model: string;
    apiKeyEnvVar: string;
    maxTokens: number;
    bestFor: string[];
}

// ── Model Registry ─────────────────────────────────────────────────────────

const models: Record<string, ModelConfig> = {
    // OpenAI
    "gpt-4o": {
        provider: "openai",
        model: "gpt-4o",
        apiKeyEnvVar: "OPENAI_API_KEY",
        maxTokens: 16384,
        bestFor: ["planning", "reasoning", "structured-output", "general"],
    },
    "gpt-4o-mini": {
        provider: "openai",
        model: "gpt-4o-mini",
        apiKeyEnvVar: "OPENAI_API_KEY",
        maxTokens: 16384,
        bestFor: ["classification", "quick-tasks", "cheap"],
    },
    // Anthropic
    "claude-sonnet": {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
        maxTokens: 8192,
        bestFor: ["code-generation", "code-review", "creative-writing", "analysis"],
    },
    // Google
    "gemini-pro": {
        provider: "google",
        model: "gemini-2.0-flash",
        apiKeyEnvVar: "GOOGLE_AI_API_KEY",
        maxTokens: 8192,
        bestFor: ["large-context", "document-review", "summarization"],
    },
};

// ── Model Selection ────────────────────────────────────────────────────────

/**
 * Check if a model provider is configured (API key is set)
 */
export function isProviderAvailable(provider: ModelProvider): boolean {
    const key = provider === "openai" ? "OPENAI_API_KEY"
        : provider === "anthropic" ? "ANTHROPIC_API_KEY"
            : "GOOGLE_AI_API_KEY";
    return !!process.env[key];
}

/**
 * Get the best available model for a task type.
 * Falls back to OpenAI if preferred provider isn't configured.
 */
export function selectModel(
    taskType: string,
    preference?: string
): ModelConfig {
    // If user has a specific preference and it's available, use it
    if (preference && preference !== "auto") {
        const model = Object.values(models).find(
            (m) => m.provider === preference || m.model === preference
        );
        if (model && isProviderAvailable(model.provider)) {
            return model;
        }
    }

    // Auto-select: find the best model for this task type
    const candidates = Object.values(models).filter(
        (m) => m.bestFor.includes(taskType) && isProviderAvailable(m.provider)
    );

    if (candidates.length > 0) {
        return candidates[0];
    }

    // Fallback: always default to GPT-4o
    return models["gpt-4o"];
}

/**
 * Get all available models (those with configured API keys)
 */
export function getAvailableModels(): ModelConfig[] {
    return Object.values(models).filter((m) => isProviderAvailable(m.provider));
}

/**
 * Get a specific model config by name
 */
export function getModel(name: string): ModelConfig | undefined {
    return models[name];
}

/**
 * Call an LLM with the given model config.
 * Unified interface across all providers.
 */
export async function callModel(
    config: ModelConfig,
    systemPrompt: string,
    userMessage: string
): Promise<string> {
    const apiKey = process.env[config.apiKeyEnvVar];
    if (!apiKey) {
        throw new Error(`API key not configured: ${config.apiKeyEnvVar}`);
    }

    if (config.provider === "openai") {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: config.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
                max_tokens: config.maxTokens,
            }),
        });
        const data = await response.json() as { choices: Array<{ message: { content: string } }> };
        return data.choices?.[0]?.message?.content || "";
    }

    if (config.provider === "anthropic") {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
                model: config.model,
                system: systemPrompt,
                messages: [{ role: "user", content: userMessage }],
                max_tokens: config.maxTokens,
            }),
        });
        const data = await response.json() as { content: Array<{ text: string }> };
        return data.content?.[0]?.text || "";
    }

    if (config.provider === "google") {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ parts: [{ text: userMessage }] }],
                generationConfig: { maxOutputTokens: config.maxTokens },
            }),
        });
        const data = await response.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    throw new Error(`Unknown provider: ${config.provider}`);
}
