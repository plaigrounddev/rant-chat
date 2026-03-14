// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
    // ── Users (synced from Clerk) ───────────────────────────────────────
    users: defineTable({
        clerkId: v.string(),
        name: v.optional(v.string()),
        email: v.optional(v.string()),
        imageUrl: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index("by_clerk_id", ["clerkId"]),

    // ── Threads (agent conversations) ──────────────────────────────────
    threads: defineTable({
        userId: v.id("users"),
        title: v.optional(v.string()),
        lastMessageAt: v.optional(v.number()),
        metadata: v.optional(v.any()),
    })
        .index("by_user", ["userId"])
        .index("by_user_recent", ["userId", "lastMessageAt"]),

    // ── Messages ───────────────────────────────────────────────────────
    messages: defineTable({
        threadId: v.id("threads"),
        role: v.union(
            v.literal("user"),
            v.literal("assistant"),
            v.literal("system"),
            v.literal("tool"),
        ),
        content: v.string(),
        toolCalls: v.optional(v.array(v.object({
            id: v.string(),
            type: v.literal("function"),
            function: v.object({
                name: v.string(),
                arguments: v.string(),
            }),
            status: v.optional(v.string()),
            result: v.optional(v.string()),
        }))),
        toolResults: v.optional(v.array(v.object({
            call_id: v.string(),
            output: v.string(),
        }))),
        responseId: v.optional(v.string()),
        createdAt: v.number(),
    })
        .index("by_thread", ["threadId", "createdAt"]),

    // ── Workflows (replaces file-based state) ──────────────────────────
    workflows: defineTable({
        runId: v.string(),
        userId: v.id("users"),
        threadId: v.optional(v.id("threads")),
        workflowType: v.string(),
        instructions: v.string(),
        status: v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("failed"),
            v.literal("cancelled"),
        ),
        steps: v.array(v.object({
            id: v.string(),
            name: v.string(),
            status: v.union(
                v.literal("pending"),
                v.literal("running"),
                v.literal("completed"),
                v.literal("failed"),
            ),
            startedAt: v.optional(v.number()),
            completedAt: v.optional(v.number()),
            result: v.optional(v.string()),
        })),
        result: v.optional(v.string()),
        error: v.optional(v.string()),
        modelPreference: v.optional(v.string()),
        startedAt: v.number(),
        completedAt: v.optional(v.number()),
    })
        .index("by_run_id", ["runId"])
        .index("by_user", ["userId", "startedAt"])
        .index("by_status", ["status"]),

    // ── Task Queue (autonomous agent tasks) ────────────────────────────
    taskQueue: defineTable({
        userId: v.id("users"),
        threadId: v.optional(v.id("threads")),
        instructions: v.string(),
        workflowType: v.optional(v.string()),
        priority: v.number(), // 1 = highest
        status: v.union(
            v.literal("pending"),
            v.literal("running"),
            v.literal("completed"),
            v.literal("failed"),
        ),
        workflowRunId: v.optional(v.string()),
        startedAt: v.optional(v.number()),
        createdAt: v.number(),
        completedAt: v.optional(v.number()),
    })
        .index("by_user_pending", ["userId", "status", "priority"])
        .index("by_status", ["status", "priority"]),

    // ── Embedded Files (multimodal RAG) ─────────────────────────────
    embeddedFiles: defineTable({
        userId: v.id("users"),
        fileName: v.string(),
        mimeType: v.string(),
        storageId: v.string(),
        entryId: v.optional(v.string()),   // RAG entry ID after embedding
        status: v.union(
            v.literal("pending"),
            v.literal("embedding"),
            v.literal("ready"),
            v.literal("failed"),
        ),
        errorMessage: v.optional(v.string()),
        dimensions: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index("by_user", ["userId", "createdAt"])
        .index("by_status", ["status"]),

    // ── Trigger Events (Composio webhook events, durable) ──────────────
    triggerEvents: defineTable({
        userId: v.optional(v.string()),    // Composio user ID (string, not Convex ID)
        triggerSlug: v.string(),           // e.g., "GMAIL_NEW_GMAIL_MESSAGE"
        triggerId: v.optional(v.string()), // Composio trigger instance ID
        toolkitSlug: v.string(),           // e.g., "gmail"
        payload: v.any(),                  // Raw event data from Composio
        status: v.union(
            v.literal("pending"),          // Received, not yet processed
            v.literal("processing"),       // Agent is handling it
            v.literal("completed"),        // Done
            v.literal("failed"),           // Processing failed
        ),
        errorMessage: v.optional(v.string()),
        processedAt: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index("by_status", ["status", "createdAt"])
        .index("by_trigger", ["triggerSlug", "createdAt"])
        .index("by_user", ["userId", "createdAt"]),

    // ── Automation Logs (cron job execution history) ────────────────────
    automationLogs: defineTable({
        automationType: v.string(),        // "email_triage", "follow_up_check", etc.
        status: v.union(
            v.literal("started"),
            v.literal("completed"),
            v.literal("failed"),
        ),
        details: v.optional(v.string()),
        itemsProcessed: v.optional(v.number()),
        durationMs: v.optional(v.number()),
        createdAt: v.number(),
    })
        .index("by_type", ["automationType", "createdAt"]),
});
