// convex/workflows.ts
import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Create a new workflow run — authenticated, idempotent.
 * Derives userId from auth context. Checks for duplicate runId.
 */
export const create = mutation({
    args: {
        runId: v.string(),
        threadId: v.optional(v.id("threads")),
        workflowType: v.string(),
        instructions: v.string(),
        steps: v.array(v.object({ id: v.string(), name: v.string() })),
        modelPreference: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Require authentication
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) throw new Error("User not found");

        // Verify thread ownership if provided
        if (args.threadId) {
            const thread = await ctx.db.get(args.threadId);
            if (!thread || thread.userId !== user._id) {
                throw new Error("Thread not found");
            }
        }

        // Idempotency: check for existing runId
        const existing = await ctx.db
            .query("workflows")
            .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
            .unique();
        if (existing) return existing._id;

        return await ctx.db.insert("workflows", {
            runId: args.runId,
            userId: user._id,
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
 * Update a workflow step's status — INTERNAL ONLY.
 * Called by Inngest via the convex bridge.
 */
export const updateStep = internalMutation({
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
 * Mark workflow as completed and announce result to thread — INTERNAL ONLY.
 * Guarded against duplicate delivery: only runs if status is still "running".
 */
export const complete = internalMutation({
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

        // Guard: only complete if still running (prevents duplicate delivery)
        if (workflow.status !== "running") return;

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
 * Mark workflow as failed — INTERNAL ONLY.
 * Guarded against duplicate delivery.
 */
export const fail = internalMutation({
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

        // Guard: only fail if still running
        if (workflow.status !== "running") return;

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

            // Update thread lastMessageAt (was missing — CodeRabbit catch)
            await ctx.db.patch(workflow.threadId, {
                lastMessageAt: Date.now(),
            });
        }
    },
});

/**
 * Get workflow by run ID — authenticated with ownership check
 */
export const getByRunId = query({
    args: { runId: v.string() },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return null;

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) return null;

        const workflow = await ctx.db
            .query("workflows")
            .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
            .unique();
        if (!workflow || workflow.userId !== user._id) return null;

        return workflow;
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
 * Cancel a running workflow — authenticated with ownership check
 */
export const cancel = mutation({
    args: { runId: v.string() },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) throw new Error("Not authenticated");

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) return false;

        const workflow = await ctx.db
            .query("workflows")
            .withIndex("by_run_id", (q) => q.eq("runId", args.runId))
            .unique();
        if (!workflow || workflow.userId !== user._id || workflow.status !== "running") return false;

        await ctx.db.patch(workflow._id, {
            status: "cancelled",
            completedAt: Date.now(),
        });
        return true;
    },
});
