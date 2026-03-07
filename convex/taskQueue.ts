// convex/taskQueue.ts
import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";

/**
 * Add a task to the autonomous queue.
 * The heartbeat system will pick up pending tasks and dispatch them.
 */
export const enqueue = mutation({
    args: {
        userId: v.id("users"),
        threadId: v.optional(v.id("threads")),
        instructions: v.string(),
        workflowType: v.optional(v.string()),
        priority: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("taskQueue", {
            userId: args.userId,
            threadId: args.threadId,
            instructions: args.instructions,
            workflowType: args.workflowType,
            priority: args.priority ?? 5,
            status: "pending",
            createdAt: Date.now(),
        });
    },
});

/**
 * Get the next pending task — INTERNAL ONLY.
 * Only callable server-side (heartbeat system).
 * Prevents cross-tenant task leakage in multi-user scenarios.
 */
export const next = internalQuery({
    args: {
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        if (args.userId) {
            return await ctx.db
                .query("taskQueue")
                .withIndex("by_user_pending", (q) =>
                    q.eq("userId", args.userId!).eq("status", "pending")
                )
                .order("asc")
                .first();
        }
        return await ctx.db
            .query("taskQueue")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .order("asc")
            .first();
    },
});

/**
 * Mark a task as running
 */
export const markRunning = mutation({
    args: {
        taskId: v.id("taskQueue"),
        workflowRunId: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.taskId, {
            status: "running",
            workflowRunId: args.workflowRunId,
        });
    },
});

/**
 * Mark task as completed
 */
export const markComplete = mutation({
    args: { taskId: v.id("taskQueue") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.taskId, {
            status: "completed",
            completedAt: Date.now(),
        });
    },
});

/**
 * List pending tasks for a user
 */
export const listPending = query({
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
            .query("taskQueue")
            .withIndex("by_user_pending", (q) =>
                q.eq("userId", user._id).eq("status", "pending")
            )
            .order("asc")
            .collect();
    },
});
