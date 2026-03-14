/**
 * Generate App Executor
 *
 * Calls the v0 SDK (via the existing /api/rant-coder route) to generate
 * a web application from a text prompt. Returns the live demo URL,
 * chat ID (for iterations), and structured message content.
 */

import { v0 } from "v0-sdk";

interface GenerateAppResult {
    success: boolean;
    chatId: string;
    demoUrl?: string;
    code?: string;
    messages?: Array<{
        role: "user" | "assistant";
        content: string;
    }>;
    error?: string;
}

/**
 * Generate (or iterate on) a web app using the v0 SDK.
 *
 * @param prompt The user's build request
 * @param chatId Optional existing chat ID for follow-up iterations
 */
export async function generateApp(
    prompt: string,
    chatId?: string
): Promise<string> {
    if (!prompt || !prompt.trim()) {
        return JSON.stringify({ success: false, error: "prompt is required" });
    }

    try {
        let chat: {
            id: string;
            demo?: string;
            messages?: Array<{
                id: string;
                role: "user" | "assistant";
                content: string;
                experimental_content?: unknown;
            }>;
        };

        if (chatId) {
            // Continue an existing chat (iterate on the app)
            chat = (await v0.chats.sendMessage({
                chatId,
                message: prompt,
            })) as unknown as typeof chat;
        } else {
            // Create a new app from scratch
            chat = (await v0.chats.create({
                message: prompt,
            })) as unknown as typeof chat;
        }

        // Extract the last assistant message content as the "code" summary
        const assistantMessages = chat.messages?.filter(
            (m) => m.role === "assistant"
        );
        const lastAssistant =
            assistantMessages?.[assistantMessages.length - 1];

        const result: GenerateAppResult = {
            success: true,
            chatId: chat.id,
            demoUrl: chat.demo,
            messages: chat.messages?.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        };

        // If we can get plaintext content, include it as "code"
        if (lastAssistant?.content) {
            result.code = lastAssistant.content;
        }

        return JSON.stringify(result);
    } catch (err) {
        const message = (err as Error).message || "App generation failed";
        console.error("[generate-app] Error:", message);
        return JSON.stringify({
            success: false,
            error: message,
        });
    }
}
