// convex/crons.ts
// Convex cron job definitions — Lindy-style automatic scheduled workflows.
//
// These cron jobs replicate Lindy AI's automatic behaviors:
// 1. Process trigger events — real-time event → agent pipeline
// 2. Email triage — auto-label and organize inbox
// 3. Follow-up check — draft follow-ups for unanswered emails
// 4. Daily digest — morning briefing (calendar + inbox summary)
// 5. Cleanup stale tasks — timeout old running tasks

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// ⚡ Process pending trigger events — every 1 minute
// Picks up events from the triggerEvents table (ingested by webhook)
// and enqueues agent tasks to handle them.
crons.interval(
    "process trigger events",
    { minutes: 1 },
    internal.automations.processPendingTriggerEvents,
);

// 📧 Email triage — every 15 minutes
// For each user with Gmail connected: fetch unread emails,
// classify into categories, apply labels, archive spam/promotions.
crons.interval(
    "email triage",
    { minutes: 15 },
    internal.automations.emailTriageCheck,
);

// 📬 Email follow-up check — daily at 10:00 AM UTC (5:00 AM EST)
// Scans sent emails for unanswered threads (2+ days old)
// and drafts follow-up emails for the user to review.
crons.daily(
    "email follow-up check",
    { hourUTC: 10, minuteUTC: 0 },
    internal.automations.emailFollowUpCheck,
);

// 📋 Daily digest — daily at 11:00 AM UTC (6:00 AM EST)
// Compiles a morning briefing with: today's calendar,
// unread email summary, and pending action items.
crons.daily(
    "daily digest",
    { hourUTC: 11, minuteUTC: 0 },
    internal.automations.dailyDigest,
);

// 🧹 Cleanup stale tasks — every 30 minutes
// Marks tasks stuck in "running" for >30 min as "failed"
// to prevent queue blockage.
crons.interval(
    "cleanup stale tasks",
    { minutes: 30 },
    internal.automations.cleanupStaleTasks,
);

// 🤖 Execute pending tasks — every 2 minutes
// Claims the next pending task from the queue and calls
// the headless agent endpoint to auto-run it.
crons.interval(
    "execute pending tasks",
    { minutes: 2 },
    internal.automations.executeNextTask,
);

export default crons;
