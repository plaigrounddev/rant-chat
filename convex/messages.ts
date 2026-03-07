// convex/messages.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Add a message to a thread.
 * This is a reactive query — all subscribed clients will
 * automatically receive the new message via WebSocket.
 */
export const send = mutation({
    args: {
        threadId: v.id("threads"),
        role: v.union(
            v.literal("user"),
            v.literal("assistant"),
            v.literal("system"),
            v.literal("tool"),
        ),
        content: v.string(),
        toolCalls: v.optional(v.any()),
        toolResults: v.optional(v.any()),
        responseId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const messageId = await ctx.db.insert("messages", {
            ...args,
            createdAt: Date.now(),
        });

        // Update thread's lastMessageAt for ordering
        await ctx.db.patch(args.threadId, {
            lastMessageAt: Date.now(),
        });

        return messageId;
    },
});

/**
 * List messages for a thread (chronological).
 * This is a REACTIVE query — the client auto-receives new messages
 * without polling. This is how workflow results arrive instantly.
 */
export const list = query({
    args: {
        threadId: v.id("threads"),
    },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("messages")
            .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
            .order("asc")
            .collect();
    },
});

/**
 * Send a system/workflow message (no auth required — for server-side use).
 * Used by Inngest workflows to push results back to threads.
 */
export const sendSystem = mutation({
    args: {
        threadId: v.id("threads"),
        content: v.string(),
        role: v.optional(v.union(
            v.literal("assistant"),
            v.literal("system"),
        )),
    },
    handler: async (ctx, args) => {
        const messageId = await ctx.db.insert("messages", {
            threadId: args.threadId,
            role: args.role ?? "assistant",
            content: args.content,
            createdAt: Date.now(),
        });

        await ctx.db.patch(args.threadId, {
            lastMessageAt: Date.now(),
        });

        return messageId;
    },
});
