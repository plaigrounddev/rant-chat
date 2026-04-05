/**
 * Embedding Search Executor
 * 
 * Calls the Convex RAG search action to perform semantic search
 * across all user-embedded content (text, images, PDFs, video, audio).
 */

const CONVEX_SITE_URL = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;

interface SearchResult {
    results: Array<{
        entryId: string;
        content: Array<{ text: string }>;
        score: number;
        startOrder: number;
    }>;
    text: string;
    entries: Array<{
        entryId: string;
        title?: string;
        text: string;
        filterValues?: Array<{ name: string; value: string }>;
    }>;
    usage: { tokens: number };
}

import { auth } from "@clerk/nextjs/server";

/**
 * Search embedded knowledge base via Convex RAG
 */
export async function searchKnowledge(args: {
    query: string;
    limit?: number;
    fileType?: string;
}): Promise<string> {
    try {
        const { userId } = await auth();
        const namespace = userId;

        if (!namespace) {
            return JSON.stringify({ error: "Unauthorized: No user session found" });
        }

        if (!CONVEX_URL) {
            return JSON.stringify({ error: "Convex URL not configured" });
        }

        // Call the Convex action via the client
        // Since we're in a Next.js API route context, we use the HTTP API
        const url = `${CONVEX_URL}/api/action`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                path: "embeddings:search",
                args: {
                    query: args.query,
                    namespace: namespace,
                    limit: args.limit ?? 10,
                    ...(args.fileType ? { fileType: args.fileType } : {}),
                },
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return JSON.stringify({
                error: `Search failed: ${response.status}`,
                details: errorText,
            });
        }

        const result: SearchResult = await response.json();

        // Format results for the agent
        const formattedEntries = result.entries.map((entry, i) => {
            const fileType = entry.filterValues?.find(f => f.name === "fileType")?.value ?? "unknown";
            const mediaType = entry.filterValues?.find(f => f.name === "mediaType")?.value ?? "unknown";
            return {
                rank: i + 1,
                title: entry.title ?? "Untitled",
                type: fileType,
                mediaType,
                content: entry.text,
            };
        });

        return JSON.stringify({
            query: args.query,
            resultCount: result.entries.length,
            results: formattedEntries,
            combinedContext: result.text,
            tokensUsed: result.usage.tokens,
        }, null, 2);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Search failed";
        console.error("[embedding-search] Error:", message);
        return JSON.stringify({ error: message });
    }
}
