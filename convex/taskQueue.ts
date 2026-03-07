// convex/taskQueue.ts
import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Enqueue a task — INTERNAL ONLY.
 * Only callable server-side. Prevents arbitrary users from
 * enqueuing tasks for other users.
 */
export const enqueue = internalMutation({
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
 * Atomically claim the next pending task — INTERNAL ONLY.
 * Finds the next pending task and marks it as running in one operation,
 * preventing race conditions where two workers claim the same task.
 */
export const claimNext = internalMutation({
    args: {
        userId: v.optional(v.id("users")),
        workflowRunId: v.string(),
    },
    handler: async (ctx, args) => {
        let task;
        if (args.userId) {
            task = await ctx.db
                .query("taskQueue")
                .withIndex("by_user_pending", (q) =>
                    q.eq("userId", args.userId!).eq("status", "pending")
                )
                .order("asc")
                .first();
        } else {
            task = await ctx.db
                .query("taskQueue")
                .withIndex("by_status", (q) => q.eq("status", "pending"))
                .order("asc")
                .first();
        }

        if (!task) return null;

        // Atomically mark as running
        await ctx.db.patch(task._id, {
            status: "running",
            workflowRunId: args.workflowRunId,
        });

        return task;
    },
});

/**
 * Mark task as completed — INTERNAL ONLY.
 */
export const markComplete = internalMutation({
    args: { taskId: v.id("taskQueue") },
    handler: async (ctx, args) => {
        const task = await ctx.db.get(args.taskId);
        if (!task || task.status !== "running") return false;

        await ctx.db.patch(args.taskId, {
            status: "completed",
            completedAt: Date.now(),
        });
        return true;
    },
});

/**
 * List pending tasks for the current authenticated user.
 * This is the only public query — safe because it's filtered by auth.
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
