// convex/workflows.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";


/**
 * Create a new workflow run
 */
export const create = mutation({
    args: {
        runId: v.string(),
        userId: v.id("users"),
        threadId: v.optional(v.id("threads")),
        workflowType: v.string(),
        instructions: v.string(),
        steps: v.array(v.object({ id: v.string(), name: v.string() })),
        modelPreference: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("workflows", {
            runId: args.runId,
            userId: args.userId,
            threadId: args.threadId,
            workflowType: args.workflowType,
            instructions: args.instructions,
            status: "running",
            steps: args.steps.map((s) => ({
                ...s,
                status: "pending" as const,
            })),
            modelPreference: args.modelPreference,
            startedAt: Date.now(),
        });
    },
});

/**
 * Update a workflow step's status.
 * Clients subscribed to this workflow will see real-time progress.
 */
export const updateStep = mutation({
    args: {
        runId: v.string(),
        stepId: v.string(),
        status: v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("failed"),
        ),
        result: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const workflow = await ctx.db
            .query("workflows")
            .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
            .unique();
        if (!workflow) return;

        const steps = workflow.steps.map((s) =>
            s.id === args.stepId
                ? {
                    ...s,
                    status: args.status,
                    startedAt: args.status === "running" ? Date.now() : s.startedAt,
                    completedAt: args.status === "completed" || args.status === "failed" ? Date.now() : s.completedAt,
                    result: args.result ?? s.result,
                }
                : s
        );

        await ctx.db.patch(workflow._id, { steps });
    },
});

/**
 * Mark workflow as completed and announce result to thread.
 * THIS IS THE KEY — writes the result as a message to the thread,
 * and Convex reactivity auto-pushes it to the client.
 */
export const complete = mutation({
    args: {
        runId: v.string(),
        result: v.string(),
    },
    handler: async (ctx, args) => {
        const workflow = await ctx.db
            .query("workflows")
            .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
            .unique();
        if (!workflow) return;

        // Update workflow status
        await ctx.db.patch(workflow._id, {
            status: "completed",
            result: args.result,
            completedAt: Date.now(),
        });

        // ANNOUNCE: Write the result as a message to the thread
        if (workflow.threadId) {
            await ctx.db.insert("messages", {
                threadId: workflow.threadId,
                role: "assistant",
                content: `✅ **Workflow Complete** (${workflow.workflowType})\n\n${args.result}`,
                createdAt: Date.now(),
            });

            await ctx.db.patch(workflow.threadId, {
                lastMessageAt: Date.now(),
            });
        }
    },
});

/**
 * Mark workflow as failed
 */
export const fail = mutation({
    args: {
        runId: v.string(),
        error: v.string(),
    },
    handler: async (ctx, args) => {
        const workflow = await ctx.db
            .query("workflows")
            .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
            .unique();
        if (!workflow) return;

        await ctx.db.patch(workflow._id, {
            status: "failed",
            error: args.error,
            completedAt: Date.now(),
        });

        if (workflow.threadId) {
            await ctx.db.insert("messages", {
                threadId: workflow.threadId,
                role: "assistant",
                content: `❌ **Workflow Failed** (${workflow.workflowType})\n\nError: ${args.error}`,
                createdAt: Date.now(),
            });
        }
    },
});

/**
 * Get workflow by run ID (reactive — client sees live step updates)
 */
export const getByRunId = query({
    args: { runId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("workflows")
            .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
            .unique();
    },
});

/**
 * List workflows for the current user
 */
export const listForUser = query({
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
            .query("workflows")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .order("desc")
            .take(20);
    },
});

/**
 * Cancel a running workflow
 */
export const cancel = mutation({
    args: { runId: v.string() },
    handler: async (ctx, args) => {
        const workflow = await ctx.db
            .query("workflows")
            .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
            .unique();
        if (!workflow || workflow.status !== "running") return false;

        await ctx.db.patch(workflow._id, {
            status: "cancelled",
            completedAt: Date.now(),
        });
        return true;
    },
});
