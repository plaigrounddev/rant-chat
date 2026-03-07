// convex/threads.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Create a new thread for the authenticated user
 */
export const create = mutation({
    args: {
        title: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) throw new Error("User not found — call users.store first");

        return await ctx.db.insert("threads", {
            userId: user._id,
            title: args.title ?? "New conversation",
            lastMessageAt: Date.now(),
        });
    },
});

/**
 * List threads for the current user (most recent first)
 */
export const list = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) return [];

        return await ctx.db
            .query("threads")
            .withIndex("by_user_recent", (q) => q.eq("userId", user._id))
            .order("desc")
            .take(50);
    },
});

/**
 * Get a single thread (with ownership check)
 */
export const get = query({
    args: { threadId: v.id("threads") },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return null;

        const thread = await ctx.db.get(args.threadId);
        if (!thread) return null;

        // Verify ownership
        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user || thread.userId !== user._id) return null;

        return thread;
    },
});

/**
 * Update thread title (auto-titles from first message)
 */
export const updateTitle = mutation({
    args: {
        threadId: v.id("threads"),
        title: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.threadId, { title: args.title });
    },
});
