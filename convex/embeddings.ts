// convex/embeddings.ts
// RAG actions using Gemini Embedding 2 (Node.js runtime)
"use node";

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { RAG } from "@convex-dev/rag";
import { google } from "@ai-sdk/google";

// ── Supported MIME types by modality ────────────────────────────────────
const SUPPORTED_MIME_TYPES = {
    image: ["image/png", "image/jpeg"] as const,
    document: ["application/pdf"] as const,
    video: ["video/mpeg", "video/mp4"] as const,
    audio: ["audio/mp3", "audio/wav", "audio/mpeg"] as const,
};

type FilterTypes = {
    fileType: string;
    mediaType: string;
};

// ── RAG Instance ────────────────────────────────────────────────────────
export const rag = new RAG<FilterTypes>(components.rag, {
    textEmbeddingModel: google.textEmbeddingModel("gemini-embedding-2-preview"),
    embeddingDimension: 3072,
    filterNames: ["fileType", "mediaType"],
});

// ── Helpers ─────────────────────────────────────────────────────────────

function getFileType(mimeType: string): string {
    if ((SUPPORTED_MIME_TYPES.image as readonly string[]).includes(mimeType)) return "image";
    if ((SUPPORTED_MIME_TYPES.document as readonly string[]).includes(mimeType)) return "document";
    if ((SUPPORTED_MIME_TYPES.video as readonly string[]).includes(mimeType)) return "video";
    if ((SUPPORTED_MIME_TYPES.audio as readonly string[]).includes(mimeType)) return "audio";
    return "text";
}

// ── Get multimodal embedding via Gemini API REST call ───────────────────
async function getMultimodalEmbedding(
    fileBuffer: ArrayBuffer,
    mimeType: string,
): Promise<number[]> {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set");

    const base64Data = Buffer.from(fileBuffer).toString("base64");

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:embedContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content: {
                    parts: [{
                        inline_data: {
                            mime_type: mimeType,
                            data: base64Data,
                        },
                    }],
                },
                taskType: "RETRIEVAL_DOCUMENT",
            }),
        },
    );

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Gemini Embedding API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();
    return result.embedding.values;
}

// ── Embed text content ──────────────────────────────────────────────────
export const embedText = action({
    args: {
        text: v.string(),
        title: v.optional(v.string()),
        namespace: v.string(),
        key: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { entryId, status } = await rag.add(ctx, {
            namespace: args.namespace,
            text: args.text,
            title: args.title,
            key: args.key,
            filterValues: [
                { name: "fileType" as const, value: "text" },
                { name: "mediaType" as const, value: "text/plain" },
            ],
        });
        return { entryId, status };
    },
});

// ── Embed multimodal file (image/PDF/video/audio) ───────────────────────
export const embedMultimodalFile = internalAction({
    args: {
        fileId: v.id("embeddedFiles"),
        storageId: v.string(),
        fileName: v.string(),
        mimeType: v.string(),
        namespace: v.string(),
    },
    handler: async (ctx, args) => {
        try {
            // Update status to embedding
            await ctx.runMutation(internal.embeddedFiles.updateFileStatus, {
                fileId: args.fileId,
                status: "embedding",
            });

            // Get the file from Convex storage
            const fileUrl = await ctx.storage.getUrl(args.storageId);
            if (!fileUrl) throw new Error("File not found in storage");

            const response = await fetch(fileUrl);
            const fileBuffer = await response.arrayBuffer();
            const fileType = getFileType(args.mimeType);

            // Get embedding from Gemini Embedding 2
            const embedding = await getMultimodalEmbedding(fileBuffer, args.mimeType);

            // Create description text for the chunk (searchable fallback)
            const descriptionText = `[${fileType.toUpperCase()}] ${args.fileName} (${args.mimeType})`;

            // Add to RAG with pre-computed embedding
            const { entryId, status } = await rag.add(ctx, {
                namespace: args.namespace,
                title: args.fileName,
                key: `file:${args.storageId}`,
                chunks: [{
                    text: descriptionText,
                    embedding,
                }],
                filterValues: [
                    { name: "fileType" as const, value: fileType },
                    { name: "mediaType" as const, value: args.mimeType },
                ],
            });

            // Update file record with success
            await ctx.runMutation(internal.embeddedFiles.updateFileStatus, {
                fileId: args.fileId,
                status: "ready",
                entryId: entryId as string,
                dimensions: embedding.length,
            });

            return { entryId, status };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(`[embeddings] Failed to embed file ${args.fileName}:`, message);

            await ctx.runMutation(internal.embeddedFiles.updateFileStatus, {
                fileId: args.fileId,
                status: "failed",
                errorMessage: message,
            });

            throw error;
        }
    },
});

// ── Semantic search across all embedded content ─────────────────────────
export const search = action({
    args: {
        query: v.string(),
        namespace: v.string(),
        limit: v.optional(v.number()),
        fileType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const filters: Array<{ name: "fileType"; value: string } | { name: "mediaType"; value: string }> = [];
        if (args.fileType) {
            filters.push({ name: "fileType" as const, value: args.fileType });
        }

        const { results, text, entries, usage } = await rag.search(ctx, {
            namespace: args.namespace,
            query: args.query,
            limit: args.limit ?? 10,
            vectorScoreThreshold: 0.3,
            chunkContext: { before: 2, after: 1 },
            ...(filters.length > 0 ? { filters } : {}),
        });

        return { results, text, entries, usage };
    },
});

// ── Search with pre-computed embedding (multimodal query) ───────────────
export const searchByEmbedding = action({
    args: {
        embedding: v.array(v.number()),
        namespace: v.string(),
        limit: v.optional(v.number()),
        fileType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const filters: Array<{ name: "fileType"; value: string } | { name: "mediaType"; value: string }> = [];
        if (args.fileType) {
            filters.push({ name: "fileType" as const, value: args.fileType });
        }

        const { results, text, entries, usage } = await rag.search(ctx, {
            namespace: args.namespace,
            query: args.embedding,
            limit: args.limit ?? 10,
            vectorScoreThreshold: 0.3,
            ...(filters.length > 0 ? { filters } : {}),
        });

        return { results, text, entries, usage };
    },
});

// ── Delete an embedded entry ────────────────────────────────────────────
export const deleteEntry = action({
    args: {
        entryId: v.string(),
    },
    handler: async (ctx, args) => {
        await rag.delete(ctx, { entryId: args.entryId as any });
    },
});
