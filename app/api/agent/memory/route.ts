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
    const memories = memoryStore.readAll();
    return NextResponse.json({ memories, count: memories.length });
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    const { content } = body as { content?: string };

    if (!content?.trim()) {
        return NextResponse.json(
            { error: "Content is required" },
            { status: 400 }
        );
    }

    const memory = memoryStore.create(content.trim());
    return NextResponse.json({ memory }, { status: 201 });
}

export async function PUT(req: NextRequest) {
    const body = await req.json();
    const { id, content } = body as { id?: string; content?: string };

    if (!id || !content?.trim()) {
        return NextResponse.json(
            { error: "id and content are required" },
            { status: 400 }
        );
    }

    const memory = memoryStore.update(id, content.trim());
    if (!memory) {
        return NextResponse.json(
            { error: "Memory not found" },
            { status: 404 }
        );
    }

    return NextResponse.json({ memory });
}

export async function DELETE(req: NextRequest) {
    const body = await req.json();
    const { id } = body as { id?: string };

    if (!id) {
        return NextResponse.json(
            { error: "id is required" },
            { status: 400 }
        );
    }

    const deleted = memoryStore.delete(id);
    if (!deleted) {
        return NextResponse.json(
            { error: "Memory not found" },
            { status: 404 }
        );
    }

    return NextResponse.json({ success: true });
}
