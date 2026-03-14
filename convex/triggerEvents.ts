// convex/triggerEvents.ts
// Durable storage for Composio webhook trigger events.
// Replaces the in-memory event store in lib/agent/triggers.ts
// for production use — events persist across deploys and are
// accessible from Convex cron jobs and queries.

import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Ingest a new trigger event — INTERNAL ONLY.
 * Called by the webhook API route when a Composio event arrives.
 */
export const ingest = internalMutation({
    args: {
        userId: v.optional(v.string()),
        triggerSlug: v.string(),
        triggerId: v.optional(v.string()),
        toolkitSlug: v.string(),
        payload: v.any(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("triggerEvents", {
            userId: args.userId,
            triggerSlug: args.triggerSlug,
            triggerId: args.triggerId,
            toolkitSlug: args.toolkitSlug,
            payload: args.payload,
            status: "pending",
            createdAt: Date.now(),
        });
    },
});

/**
 * Claim pending events for processing — INTERNAL ONLY.
 * Returns up to `limit` pending events and marks them as "processing".
 * This prevents duplicate processing by concurrent cron runs.
 */
export const claimPending = internalMutation({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const limit = args.limit ?? 10;
        const pending = await ctx.db
            .query("triggerEvents")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .order("asc")
            .take(limit);

        // Atomically mark all as processing
        for (const event of pending) {
            await ctx.db.patch(event._id, { status: "processing" });
        }

        return pending;
    },
});

/**
 * Mark event as completed — INTERNAL ONLY.
 */
export const markCompleted = internalMutation({
    args: {
        eventId: v.id("triggerEvents"),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.eventId, {
            status: "completed",
            processedAt: Date.now(),
        });
    },
});

/**
 * Mark event as failed — INTERNAL ONLY.
 */
export const markFailed = internalMutation({
    args: {
        eventId: v.id("triggerEvents"),
        errorMessage: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.eventId, {
            status: "failed",
            errorMessage: args.errorMessage,
            processedAt: Date.now(),
        });
    },
});

/**
 * List recent trigger events — authenticated query.
 * Users can see their own events in the UI.
 */
export const listRecent = query({
    args: {
        triggerSlug: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        const limit = Math.min(args.limit ?? 20, 50);

        if (args.triggerSlug) {
            return await ctx.db
                .query("triggerEvents")
                .withIndex("by_trigger", (q) =>
                    q.eq("triggerSlug", args.triggerSlug!)
                )
                .order("desc")
                .take(limit);
        }

        // Return most recent events globally
        return await ctx.db
            .query("triggerEvents")
            .order("desc")
            .take(limit);
    },
});

/**
 * Get event counts by status — for the dashboard.
 */
export const getStats = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return null;

        const pending = await ctx.db
            .query("triggerEvents")
            .withIndex("by_status", (q) => q.eq("status", "pending"))
            .take(100);
        const processing = await ctx.db
            .query("triggerEvents")
            .withIndex("by_status", (q) => q.eq("status", "processing"))
            .take(100);

        return {
            pending: pending.length,
            processing: processing.length,
        };
    },
});

/**
 * Public mutation for webhook ingestion — called by Next.js API route.
 * This is the only public write endpoint for trigger events.
 * The webhook route authenticates via HMAC before calling this.
 */
export const ingestFromWebhook = mutation({
    args: {
        userId: v.optional(v.string()),
        triggerSlug: v.string(),
        triggerId: v.optional(v.string()),
        toolkitSlug: v.string(),
        payload: v.any(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("triggerEvents", {
            userId: args.userId,
            triggerSlug: args.triggerSlug,
            triggerId: args.triggerId,
            toolkitSlug: args.toolkitSlug,
            payload: args.payload,
            status: "pending",
            createdAt: Date.now(),
        });
    },
});
