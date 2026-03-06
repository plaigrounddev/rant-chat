/**
 * Memory System — Persistent Memory Store
 *
 * Mirrors Lindy AI's memory system: small snippets of information that
 * persist across all task runs and are auto-injected into every AI call.
 *
 * Uses file-based JSON storage with async I/O (swappable for DB later).
 */

import { readFile, writeFile, mkdir, access } from "fs/promises";
import { join } from "path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface Memory {
    id: string;
    content: string;
    createdAt: string;
    updatedAt: string;
}

// ── Store ──────────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data");
const MEMORY_FILE = join(DATA_DIR, "memories.json");

/** Serialise concurrent writes into a sequential queue. */
let writeQueue: Promise<void> = Promise.resolve();

async function ensureDataDir() {
    try {
        await access(DATA_DIR);
    } catch {
        await mkdir(DATA_DIR, { recursive: true });
    }
}

async function loadMemories(): Promise<Memory[]> {
    await ensureDataDir();
    try {
        await access(MEMORY_FILE);
    } catch {
        return [];
    }
    try {
        const raw = await readFile(MEMORY_FILE, "utf-8");
        return JSON.parse(raw) as Memory[];
    } catch (err) {
        console.warn(
            `[memory] Failed to parse ${MEMORY_FILE}:`,
            (err as Error).message
        );
        return [];
    }
}

async function saveMemories(memories: Memory[]): Promise<void> {
    await ensureDataDir();
    await writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf-8");
}

/**
 * Serialise a read-modify-write operation so concurrent calls
 * don't lose each other's changes.
 */
function serialisedWrite<T>(fn: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(fn);
    writeQueue = result.then(() => { }, () => { });
    return result;
}

function generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Memory Store Class ─────────────────────────────────────────────────────

class MemoryStore {
    async readAll(): Promise<Memory[]> {
        return loadMemories();
    }

    async search(query: string): Promise<Memory[]> {
        const memories = await loadMemories();
        const q = query.toLowerCase();
        return memories.filter((m) => m.content.toLowerCase().includes(q));
    }

    async create(content: string): Promise<Memory> {
        return serialisedWrite(async () => {
            const memories = await loadMemories();
            const now = new Date().toISOString();
            const memory: Memory = {
                id: generateId(),
                content,
                createdAt: now,
                updatedAt: now,
            };
            memories.push(memory);
            await saveMemories(memories);
            return memory;
        });
    }

    async update(id: string, content: string): Promise<Memory | null> {
        return serialisedWrite(async () => {
            const memories = await loadMemories();
            const idx = memories.findIndex((m) => m.id === id);
            if (idx === -1) return null;
            memories[idx] = {
                ...memories[idx],
                content,
                updatedAt: new Date().toISOString(),
            };
            await saveMemories(memories);
            return memories[idx];
        });
    }

    async delete(id: string): Promise<boolean> {
        return serialisedWrite(async () => {
            const memories = await loadMemories();
            const filtered = memories.filter((m) => m.id !== id);
            if (filtered.length === memories.length) return false;
            await saveMemories(filtered);
            return true;
        });
    }

    /** Format all memories for injection into the system prompt */
    async formatForContext(): Promise<string> {
        const memories = await loadMemories();
        if (memories.length === 0) return "";
        const items = memories
            .map((m, i) => `${i + 1}. [${m.id}] ${m.content}`)
            .join("\n");
        return `\n\nMEMORIES (persistent knowledge from past interactions):\n${items}\n`;
    }
}

export const memoryStore = new MemoryStore();
