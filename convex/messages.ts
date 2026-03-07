// convex/messages.ts
import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Send a message from an authenticated user.
 * - Validates authentication
 * - Verifies thread ownership
 * - Forces role to "user" (privileged roles only via sendSystem)
 */
export const send = mutation({
    args: {
        threadId: v.id("threads"),
        content: v.string(),
        toolCalls: v.optional(v.any()),
        toolResults: v.optional(v.any()),
        responseId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Require authentication
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        // Verify thread ownership
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) throw new Error("User not found");

        const thread = await ctx.db.get(args.threadId);
        if (!thread || thread.userId !== user._id) {
            throw new Error("Thread not found");
        }

        // Force role to "user" — privileged roles only via sendSystem
        const messageId = await ctx.db.insert("messages", {
            threadId: args.threadId,
            role: "user",
            content: args.content,
            toolCalls: args.toolCalls,
            toolResults: args.toolResults,
            responseId: args.responseId,
            createdAt: Date.now(),
        });

        await ctx.db.patch(args.threadId, {
            lastMessageAt: Date.now(),
        });

        return messageId;
    },
});

/**
 * List messages for a thread (chronological, paginated).
 * - Validates authentication and thread ownership
 * - Caps at 500 messages, fetches newest then reverses
 */
export const list = query({
    args: {
        threadId: v.id("threads"),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        // Verify thread ownership
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) return [];

        const thread = await ctx.db.get(args.threadId);
        if (!thread || thread.userId !== user._id) return [];

        // Cap limit at 500, fetch newest first then reverse
        const maxLimit = Math.min(args.limit ?? 500, 500);
        const messages = await ctx.db
            .query("messages")
            .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
            .order("desc")
            .take(maxLimit);

        return messages.reverse();
    },
});

/**
 * Send a system/workflow message — INTERNAL ONLY.
 * Only callable server-side (via admin key or other Convex functions).
 * Used by Inngest workflows to push results back to threads.
 */
export const sendSystem = internalMutation({
    args: {
        threadId: v.id("threads"),
        content: v.string(),
        role: v.optional(v.union(
            v.literal("assistant"),
            v.literal("system"),
        )),
    },
    handler: async (ctx, args) => {
        // Verify thread exists (prevent orphan messages)
        const thread = await ctx.db.get(args.threadId);
        if (!thread) throw new Error("Thread not found");

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
