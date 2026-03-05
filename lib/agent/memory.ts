/**
 * Memory System — Persistent Memory Store
 *
 * Mirrors Lindy AI's memory system: small snippets of information that
 * persist across all task runs and are auto-injected into every AI call.
 *
 * Uses file-based JSON storage (swappable for DB later).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
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

function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadMemories(): Memory[] {
    ensureDataDir();
    if (!existsSync(MEMORY_FILE)) {
        return [];
    }
    try {
        const raw = readFileSync(MEMORY_FILE, "utf-8");
        return JSON.parse(raw) as Memory[];
    } catch {
        return [];
    }
}

function saveMemories(memories: Memory[]) {
    ensureDataDir();
    writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf-8");
}

function generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Memory Store Class ─────────────────────────────────────────────────────

class MemoryStore {
    readAll(): Memory[] {
        return loadMemories();
    }

    search(query: string): Memory[] {
        const memories = loadMemories();
        const q = query.toLowerCase();
        return memories.filter((m) => m.content.toLowerCase().includes(q));
    }

    create(content: string): Memory {
        const memories = loadMemories();
        const now = new Date().toISOString();
        const memory: Memory = {
            id: generateId(),
            content,
            createdAt: now,
            updatedAt: now,
        };
        memories.push(memory);
        saveMemories(memories);
        return memory;
    }

    update(id: string, content: string): Memory | null {
        const memories = loadMemories();
        const idx = memories.findIndex((m) => m.id === id);
        if (idx === -1) return null;
        memories[idx] = {
            ...memories[idx],
            content,
            updatedAt: new Date().toISOString(),
        };
        saveMemories(memories);
        return memories[idx];
    }

    delete(id: string): boolean {
        const memories = loadMemories();
        const filtered = memories.filter((m) => m.id !== id);
        if (filtered.length === memories.length) return false;
        saveMemories(filtered);
        return true;
    }

    /** Format all memories for injection into the system prompt */
    formatForContext(): string {
        const memories = loadMemories();
        if (memories.length === 0) return "";
        const items = memories
            .map((m, i) => `${i + 1}. [${m.id}] ${m.content}`)
            .join("\n");
        return `\n\nMEMORIES (persistent knowledge from past interactions):\n${items}\n`;
    }
}

export const memoryStore = new MemoryStore();
