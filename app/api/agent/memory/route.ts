/**
 * Memory CRUD API
 *
 * Mirrors Lindy AI's memory management capabilities.
 * Provides REST endpoints for managing persistent memories.
 *
 * GET    /api/agent/memory → list all memories
 * POST   /api/agent/memory → create a new memory
 * PUT    /api/agent/memory → update a memory
 * DELETE /api/agent/memory → delete a memory
 */

import { NextRequest, NextResponse } from "next/server";
import { memoryStore } from "@/lib/agent/memory";

export async function GET() {
    const memories = await memoryStore.readAll();
    return NextResponse.json({ memories, count: memories.length });
}

export async function POST(req: NextRequest) {
    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 }
        );
    }
    const { content } = body as { content?: string };

    if (!content?.trim()) {
        return NextResponse.json(
            { error: "Content is required" },
            { status: 400 }
        );
    }

    const memory = await memoryStore.create(content.trim());
    return NextResponse.json({ memory }, { status: 201 });
}

export async function PUT(req: NextRequest) {
    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 }
        );
    }
    const { id, content } = body as { id?: string; content?: string };

    if (!id || !content?.trim()) {
        return NextResponse.json(
            { error: "id and content are required" },
            { status: 400 }
        );
    }

    const memory = await memoryStore.update(id, content.trim());
    if (!memory) {
        return NextResponse.json(
            { error: "Memory not found" },
            { status: 404 }
        );
    }

    return NextResponse.json({ memory });
}

export async function DELETE(req: NextRequest) {
    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 }
        );
    }
    const { id } = body as { id?: string };

    if (!id) {
        return NextResponse.json(
            { error: "id is required" },
            { status: 400 }
        );
    }

    const deleted = await memoryStore.delete(id);
    if (!deleted) {
        return NextResponse.json(
            { error: "Memory not found" },
            { status: 404 }
        );
    }

    return NextResponse.json({ success: true });
}
