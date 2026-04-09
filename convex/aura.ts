// convex/aura.ts
// AuraOS cloud backend — handles memory sync, note sync, and online action execution.
// The iOS app stores everything locally in SQLite (offline-first),
// then syncs to Convex when internet is available.

import { mutation, action, query } from "./_generated/server";
import { v } from "convex/values";

// ── Memory Sync ────────────────────────────────────────────────────────

/**
 * Sync a memory from the iOS app's local MemPalace to the cloud.
 * Called when the device goes online and has unsynced memories.
 */
export const syncMemory = mutation({
    args: {
        id: v.string(),
        type: v.string(), // "episodic" | "semantic" | "procedural"
        content: v.string(),
        tags: v.array(v.string()),
        timestamp: v.number(), // Unix timestamp in ms
    },
    handler: async (ctx, args) => {
        // Check if this memory already exists (idempotent upsert)
        const existing = await ctx.db
            .query("aura_memories")
            .withIndex("by_device_id", (q) => q.eq("deviceId", args.id))
            .first();

        if (existing) {
            // Update existing memory
            await ctx.db.patch(existing._id, {
                type: args.type,
                content: args.content,
                tags: args.tags,
                updatedAt: Date.now(),
            });
            return { status: "updated", id: existing._id };
        }

        // Insert new memory
        const docId = await ctx.db.insert("aura_memories", {
            deviceId: args.id,
            type: args.type,
            content: args.content,
            tags: args.tags,
            timestamp: args.timestamp,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        return { status: "created", id: docId };
    },
});

// ── Note Sync ──────────────────────────────────────────────────────────

/**
 * Sync a voice note from the iOS app to the cloud.
 * Includes raw transcription, AI-parsed content, and category.
 */
export const syncNote = mutation({
    args: {
        id: v.string(),
        category: v.string(), // "note" | "task" | "reminder" | etc.
        rawTranscription: v.string(),
        content: v.string(),
        tags: v.array(v.string()),
        timestamp: v.number(),
        contextLocation: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("aura_notes")
            .withIndex("by_device_id", (q) => q.eq("deviceId", args.id))
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                category: args.category,
                content: args.content,
                tags: args.tags,
                updatedAt: Date.now(),
            });
            return { status: "updated", id: existing._id };
        }

        const docId = await ctx.db.insert("aura_notes", {
            deviceId: args.id,
            category: args.category,
            rawTranscription: args.rawTranscription,
            content: args.content,
            tags: args.tags,
            timestamp: args.timestamp,
            contextLocation: args.contextLocation ?? "",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        return { status: "created", id: docId };
    },
});

// ── Online Action Execution ────────────────────────────────────────────

/**
 * Execute a queued action from the iOS app.
 * This is the cloud-side handler for actions that require internet
 * (e.g., sending emails, posting Slack messages, creating calendar events).
 *
 * For MVP: logs the action and returns success.
 * In production: integrates with Composio or direct API calls.
 */
export const executeAction = action({
    args: {
        id: v.string(),
        type: v.string(), // "sendEmail" | "createCalendarEvent" | "postSlack" | etc.
        title: v.string(),
        payload: v.string(), // JSON-encoded action parameters
    },
    handler: async (ctx, args) => {
        console.log(`[AuraOS] Executing action: ${args.type} — ${args.title}`);

        let parsedPayload: Record<string, string> = {};
        try {
            parsedPayload = JSON.parse(args.payload);
        } catch {
            // Payload might not be valid JSON
        }

        // Log the action execution to the database
        await ctx.runMutation("aura:logActionExecution" as any, {
            actionId: args.id,
            type: args.type,
            title: args.title,
            payload: args.payload,
            status: "completed",
        });

        // Route by action type
        // In production, these would call Composio or direct APIs
        switch (args.type) {
            case "sendEmail":
                console.log(
                    `[AuraOS] Email action: to=${parsedPayload.contact_name}, content=${parsedPayload.content}`
                );
                // TODO: Integrate with Composio GMAIL_SEND_EMAIL
                return {
                    success: true,
                    message: `Email action logged: "${args.title}"`,
                };

            case "createCalendarEvent":
                console.log(
                    `[AuraOS] Calendar action: ${parsedPayload.content} at ${parsedPayload.date_time}`
                );
                // TODO: Integrate with Composio Google Calendar
                return {
                    success: true,
                    message: `Calendar event logged: "${args.title}"`,
                };

            case "postSlack":
                console.log(`[AuraOS] Slack action: ${parsedPayload.content}`);
                // TODO: Integrate with Composio Slack
                return {
                    success: true,
                    message: `Slack message logged: "${args.title}"`,
                };

            case "sendMessage":
                console.log(
                    `[AuraOS] Message action: to=${parsedPayload.contact_name}, content=${parsedPayload.content}`
                );
                return {
                    success: true,
                    message: `Message action logged: "${args.title}"`,
                };

            default:
                console.log(`[AuraOS] Custom action: ${args.title}`);
                return {
                    success: true,
                    message: `Action logged: "${args.title}"`,
                };
        }
    },
});

/**
 * Log an action execution to the database for audit trail.
 */
export const logActionExecution = mutation({
    args: {
        actionId: v.string(),
        type: v.string(),
        title: v.string(),
        payload: v.string(),
        status: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("aura_actions", {
            deviceActionId: args.actionId,
            type: args.type,
            title: args.title,
            payload: args.payload,
            status: args.status,
            executedAt: Date.now(),
        });
    },
});

// ── Queries ────────────────────────────────────────────────────────────

/**
 * Get all synced memories (for cross-device access).
 */
export const getMemories = query({
    args: {
        type: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        let query = ctx.db.query("aura_memories").order("desc");
        const results = await query.collect();

        let filtered = results;
        if (args.type) {
            filtered = results.filter((m) => m.type === args.type);
        }

        return filtered.slice(0, args.limit ?? 100);
    },
});

/**
 * Get all synced notes (for cross-device access).
 */
export const getNotes = query({
    args: {
        category: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        let query = ctx.db.query("aura_notes").order("desc");
        const results = await query.collect();

        let filtered = results;
        if (args.category) {
            filtered = results.filter((n) => n.category === args.category);
        }

        return filtered.slice(0, args.limit ?? 100);
    },
});

/**
 * Get action execution history.
 */
export const getActionHistory = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const results = await ctx.db.query("aura_actions").order("desc").collect();
        return results.slice(0, args.limit ?? 50);
    },
});

/**
 * Get AuraOS stats (memory count, note count, action count).
 */
export const getStats = query({
    handler: async (ctx) => {
        const memories = await ctx.db.query("aura_memories").collect();
        const notes = await ctx.db.query("aura_notes").collect();
        const actions = await ctx.db.query("aura_actions").collect();

        return {
            memoryCount: memories.length,
            noteCount: notes.length,
            actionCount: actions.length,
        };
    },
});
