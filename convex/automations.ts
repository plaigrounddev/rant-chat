// convex/automations.ts
// Internal functions invoked by cron jobs.
// These implement Lindy-style automatic scheduled workflows:
// - Process trigger events (every 1 min)
// - Email triage (every 15 min)
// - Follow-up check (daily 5 AM EST)
// - Daily digest (daily 6 AM EST)
// - Cleanup stale tasks (every 30 min)

import { internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

// ── Helper: Log automation run ─────────────────────────────────────────

export const logAutomation = internalMutation({
    args: {
        automationType: v.string(),
        status: v.union(
            v.literal("started"),
            v.literal("completed"),
            v.literal("failed"),
        ),
        details: v.optional(v.string()),
        itemsProcessed: v.optional(v.number()),
        durationMs: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("automationLogs", {
            automationType: args.automationType,
            status: args.status,
            details: args.details,
            itemsProcessed: args.itemsProcessed,
            durationMs: args.durationMs,
            createdAt: Date.now(),
        });
    },
});

// ── 1. Process Pending Trigger Events ──────────────────────────────────
// Every 1 minute: picks up pending events from triggerEvents table
// and enqueues agent tasks to handle them.

export const processPendingTriggerEvents = internalAction({
    args: {},
    handler: async (ctx) => {
        const startTime = Date.now();

        // Claim up to 10 pending events atomically
        const events = await ctx.runMutation(
            internal.triggerEvents.claimPending,
            { limit: 10 }
        );

        if (events.length === 0) return;

        console.log(
            `[Automations] Processing ${events.length} trigger events`
        );

        await ctx.runMutation(internal.automations.logAutomation, {
            automationType: "process_trigger_events",
            status: "started",
            details: `Processing ${events.length} events`,
        });

        let processed = 0;
        let failed = 0;

        for (const event of events) {
            try {
                // Find a user to associate this event with
                // The Composio user ID may map to a Clerk user
                const users = await ctx.runMutation(
                    internal.automations.findUsersForAutomation,
                    {}
                );

                if (users.length > 0) {
                    // Enqueue an agent task to handle this trigger event
                    await ctx.runMutation(internal.taskQueue.enqueue, {
                        userId: users[0]._id,
                        instructions: `Handle trigger event: ${event.triggerSlug} from ${event.toolkitSlug}. Event payload: ${JSON.stringify(event.payload).slice(0, 500)}`,
                        workflowType: "trigger_event",
                        priority: 2, // High priority
                    });
                }

                await ctx.runMutation(
                    internal.triggerEvents.markCompleted,
                    { eventId: event._id }
                );
                processed++;
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : "Unknown error";
                await ctx.runMutation(internal.triggerEvents.markFailed, {
                    eventId: event._id,
                    errorMessage: message,
                });
                failed++;
            }
        }

        await ctx.runMutation(internal.automations.logAutomation, {
            automationType: "process_trigger_events",
            status: failed > 0 ? "failed" : "completed",
            details: `Processed: ${processed}, Failed: ${failed}`,
            itemsProcessed: processed,
            durationMs: Date.now() - startTime,
        });
    },
});

// ── 2. Email Triage ────────────────────────────────────────────────────
// Every 15 minutes: For users with Gmail connected, fetch unread
// emails and enqueue triage tasks for the agent.

export const emailTriageCheck = internalAction({
    args: {},
    handler: async (ctx) => {
        const startTime = Date.now();

        await ctx.runMutation(internal.automations.logAutomation, {
            automationType: "email_triage",
            status: "started",
        });

        try {
            // Get all users who might have Gmail connected
            const users = await ctx.runMutation(
                internal.automations.findUsersForAutomation,
                {}
            );

            let tasksEnqueued = 0;

            for (const user of users) {
                // Enqueue an email triage task for the agent
                await ctx.runMutation(internal.taskQueue.enqueue, {
                    userId: user._id,
                    instructions:
                        "AUTOMATED EMAIL TRIAGE: Check for new unread emails using GMAIL_FETCH_EMAILS(query: 'is:unread', max_results: 20). " +
                        "For each email, classify into: To Respond, FYI, Newsletters, Notifications, Invoices, Promotions (archive), Calendar (archive). " +
                        "Apply labels using GMAIL_ADD_LABEL_TO_EMAIL. Archive promotions by removing INBOX label. " +
                        "Report what was triaged. If no unread emails, skip.",
                    workflowType: "email_triage",
                    priority: 5, // Medium priority
                });
                tasksEnqueued++;
            }

            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "email_triage",
                status: "completed",
                details: `Enqueued triage for ${tasksEnqueued} users`,
                itemsProcessed: tasksEnqueued,
                durationMs: Date.now() - startTime,
            });
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Unknown error";
            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "email_triage",
                status: "failed",
                details: message,
                durationMs: Date.now() - startTime,
            });
        }
    },
});

// ── 3. Email Follow-Up Check ───────────────────────────────────────────
// Daily at 10:00 UTC (5 AM EST): Check for sent emails that haven't
// received a reply in 2+ days and draft follow-ups.

export const emailFollowUpCheck = internalAction({
    args: {},
    handler: async (ctx) => {
        const startTime = Date.now();

        await ctx.runMutation(internal.automations.logAutomation, {
            automationType: "email_follow_up",
            status: "started",
        });

        try {
            const users = await ctx.runMutation(
                internal.automations.findUsersForAutomation,
                {}
            );

            let tasksEnqueued = 0;

            // Calculate the date 2 days ago for the query
            const twoDaysAgo = new Date();
            twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
            const dateStr = `${twoDaysAgo.getFullYear()}/${String(twoDaysAgo.getMonth() + 1).padStart(2, "0")}/${String(twoDaysAgo.getDate()).padStart(2, "0")}`;

            for (const user of users) {
                await ctx.runMutation(internal.taskQueue.enqueue, {
                    userId: user._id,
                    instructions:
                        `AUTOMATED FOLLOW-UP CHECK: Search for sent emails that haven't received replies. ` +
                        `Use GMAIL_FETCH_EMAILS(query: 'in:sent before:${dateStr}', max_results: 10). ` +
                        `For each sent email, check the thread for replies using GMAIL_FETCH_MESSAGE_BY_THREAD_ID. ` +
                        `If no reply after 2+ days, draft a follow-up using GMAIL_CREATE_EMAIL_DRAFT with the original thread_id. ` +
                        `Report: which contacts haven't replied and which follow-ups were drafted. If all caught up, skip.`,
                    workflowType: "email_follow_up",
                    priority: 5,
                });
                tasksEnqueued++;
            }

            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "email_follow_up",
                status: "completed",
                details: `Enqueued follow-up check for ${tasksEnqueued} users`,
                itemsProcessed: tasksEnqueued,
                durationMs: Date.now() - startTime,
            });
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Unknown error";
            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "email_follow_up",
                status: "failed",
                details: message,
                durationMs: Date.now() - startTime,
            });
        }
    },
});

// ── 4. Daily Digest ────────────────────────────────────────────────────
// Daily at 11:00 UTC (6 AM EST): Compile morning briefing
// with calendar events and inbox summary.

export const dailyDigest = internalAction({
    args: {},
    handler: async (ctx) => {
        const startTime = Date.now();

        await ctx.runMutation(internal.automations.logAutomation, {
            automationType: "daily_digest",
            status: "started",
        });

        try {
            const users = await ctx.runMutation(
                internal.automations.findUsersForAutomation,
                {}
            );

            let tasksEnqueued = 0;

            for (const user of users) {
                await ctx.runMutation(internal.taskQueue.enqueue, {
                    userId: user._id,
                    instructions:
                        "AUTOMATED DAILY DIGEST: Create a morning briefing for the user. " +
                        "1. Check calendar for today's meetings using Google Calendar tools (if connected). " +
                        "2. Summarize unread emails using GMAIL_FETCH_EMAILS(query: 'is:unread', max_results: 10). " +
                        "3. Check for any pending tasks or follow-ups. " +
                        "4. Compile a brief, scannable summary with sections: " +
                        "📅 Today's Schedule, 📧 Inbox Summary (X unread, key senders), 📋 Action Items. " +
                        "Post this as a message in the user's most recent thread. Keep it concise.",
                    workflowType: "daily_digest",
                    priority: 4,
                });
                tasksEnqueued++;
            }

            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "daily_digest",
                status: "completed",
                details: `Enqueued digest for ${tasksEnqueued} users`,
                itemsProcessed: tasksEnqueued,
                durationMs: Date.now() - startTime,
            });
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Unknown error";
            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "daily_digest",
                status: "failed",
                details: message,
                durationMs: Date.now() - startTime,
            });
        }
    },
});

// ── 5. Cleanup Stale Tasks ─────────────────────────────────────────────
// Every 30 minutes: Find tasks stuck in "running" for > 30 min
// and mark them as failed to prevent queue blockage.

export const cleanupStaleTasks = internalMutation({
    args: {},
    handler: async (ctx) => {
        const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;

        const staleTasks = await ctx.db
            .query("taskQueue")
            .withIndex("by_status", (q) => q.eq("status", "running"))
            .take(50);

        let cleaned = 0;

        for (const task of staleTasks) {
            if (task.startedAt && task.startedAt < thirtyMinutesAgo) {
                await ctx.db.patch(task._id, {
                    status: "failed",
                    completedAt: Date.now(),
                });
                cleaned++;
            }
        }

        if (cleaned > 0) {
            await ctx.db.insert("automationLogs", {
                automationType: "cleanup_stale_tasks",
                status: "completed",
                details: `Cleaned ${cleaned} stale tasks`,
                itemsProcessed: cleaned,
                createdAt: Date.now(),
            });
            console.log(`[Automations] Cleaned ${cleaned} stale tasks`);
        }
    },
});

// ── 6. Execute Next Pending Task ───────────────────────────────────────
// Every 2 minutes: Claims the next pending task from the queue and
// calls the headless agent endpoint to execute it automatically.
// This is the "last mile" — it makes cron-enqueued tasks actually run.

export const executeNextTask = internalAction({
    args: {},
    handler: async (ctx) => {
        const startTime = Date.now();

        // Claim next pending task atomically
        const task = await ctx.runMutation(internal.taskQueue.claimNext, {
            workflowRunId: `auto_${Date.now()}`,
        });

        if (!task) return; // Nothing to execute

        console.log(
            `[Automations] 🤖 Executing task: ${task.workflowType || "general"} | ${task.instructions.slice(0, 80)}...`
        );

        const appUrl = process.env.NEXT_PUBLIC_APP_URL;
        const apiSecret = process.env.AGENT_INTERNAL_SECRET;

        if (!appUrl || !apiSecret) {
            console.error(
                "[Automations] NEXT_PUBLIC_APP_URL or AGENT_INTERNAL_SECRET not set"
            );
            // Can't execute — leave task in "running" for stale-task cleanup
            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "execute_task",
                status: "failed",
                details:
                    "NEXT_PUBLIC_APP_URL or AGENT_INTERNAL_SECRET not configured",
            });
            return;
        }

        try {
            // Call the headless agent endpoint
            const response = await fetch(`${appUrl}/api/agent/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    instructions: task.instructions,
                    taskId: task._id,
                    apiSecret,
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(
                    `Agent endpoint returned ${response.status}: ${errText.slice(0, 200)}`
                );
            }

            const result = await response.json();

            // Mark task as completed
            await ctx.runMutation(internal.taskQueue.markComplete, {
                taskId: task._id,
            });

            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "execute_task",
                status: "completed",
                details: `${task.workflowType || "general"}: ${result.toolsUsed?.join(", ") || "no tools"} (${result.rounds} rounds)`,
                itemsProcessed: 1,
                durationMs: Date.now() - startTime,
            });

            console.log(
                `[Automations] ✅ Task done | type=${task.workflowType || "general"} | rounds=${result.rounds} | tools=${result.toolsUsed?.join(", ") || "none"}`
            );
        } catch (err) {
            const message =
                err instanceof Error ? err.message : "Unknown error";
            console.error(`[Automations] ❌ Task execution failed:`, message);

            // Mark task as failed so it doesn't block the queue
            // We reuse the by_status index to find it
            // Note: markComplete checks status === "running", so we need a dedicated fail path
            // For now, the stale task cleanup (30 min) will catch this
            await ctx.runMutation(internal.automations.logAutomation, {
                automationType: "execute_task",
                status: "failed",
                details: `${task.workflowType || "general"}: ${message}`,
                durationMs: Date.now() - startTime,
            });
        }
    },
});

// ── Helper: Find Users for Automation ──────────────────────────────────
// Returns all users who should receive automated workflows.
// In the future this can be filtered by user preferences/settings.

export const findUsersForAutomation = internalMutation({
    args: {},
    handler: async (ctx) => {
        // For now, return all users
        // In the future, filter by users who have:
        // 1. Connected Gmail accounts
        // 2. Enabled automations in their settings
        // 3. Not disabled specific automation types
        const users = await ctx.db.query("users").take(100);
        return users;
    },
});

