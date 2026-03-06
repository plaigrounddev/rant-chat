/**
 * Task History API
 *
 * Mirrors Lindy AI's Tasks view.
 * Provides endpoints for viewing task execution history.
 *
 * GET /api/agent/tasks → list recent task runs with stats
 */

import { NextRequest, NextResponse } from "next/server";
import { taskStore } from "@/lib/agent/task-store";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const rawLimit = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : 20;
    const taskId = searchParams.get("id");

    // If a specific task ID is requested, return that task
    if (taskId) {
        const run = taskStore.getRun(taskId);
        if (!run) {
            return NextResponse.json(
                { error: "Task not found" },
                { status: 404 }
            );
        }
        return NextResponse.json({ task: run });
    }

    // Otherwise return task history with stats
    const history = taskStore.getHistory(limit);
    const stats = taskStore.getStats();

    return NextResponse.json({ tasks: history, stats });
}
