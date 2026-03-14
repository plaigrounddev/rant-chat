/**
 * SandboxManager — Manages E2B sandbox lifecycle.
 *
 * E2B sandboxes are Firecracker microVMs that spin up in ~150ms, providing
 * isolated Linux environments for code execution, file management, and
 * terminal operations. Inspired by how Manus uses E2B for full virtual
 * computers and how Perplexity uses it for code interpretation at scale.
 *
 * Key features:
 * - Create/pause/resume/kill sandboxes
 * - Stateful sessions (like Perplexity) — code state persists across calls
 * - Long-running sessions (like Manus) — can run for hours
 * - Connection pooling and reuse
 */

import { Sandbox } from "@e2b/code-interpreter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SandboxCreateOptions {
    /** Custom template ID (default: base template) */
    template?: string;
    /** Session/run ID for isolation (sandboxes are reused within the same session only) */
    sessionId?: string;
    /** Sandbox timeout in milliseconds (default: 5 minutes) */
    timeoutMs?: number;
    /** User-defined metadata for tracking */
    metadata?: Record<string, string>;
}

export interface SandboxInstance {
    /** E2B sandbox ID */
    id: string;
    /** The underlying E2B sandbox object */
    sandbox: Sandbox;
    /** Template used */
    template: string;
    /** Session/run ID this sandbox belongs to */
    sessionId?: string;
    /** When this sandbox was created */
    createdAt: Date;
    /** Current status */
    status: "running" | "paused" | "terminated";
    /** User-defined metadata */
    metadata: Record<string, string>;
}

export interface SandboxInfo {
    id: string;
    template: string;
    status: string;
    createdAt: string;
    metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class SandboxManager {
    private activeSandboxes: Map<string, SandboxInstance> = new Map();

    /**
     * Create a new E2B sandbox.
     * The sandbox is a fully isolated Linux VM with Python, Node.js, and Bash.
     */
    async createSandbox(
        options: SandboxCreateOptions = {}
    ): Promise<SandboxInstance> {
        const timeoutMs = Math.min(
            options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            MAX_TIMEOUT_MS
        );

        try {
            const sandbox = await Sandbox.create({
                timeoutMs,
                ...(options.template && { template: options.template }),
                ...(options.metadata && { metadata: options.metadata }),
            });

            const info = await sandbox.getInfo();

            const instance: SandboxInstance = {
                id: info.sandboxId,
                sandbox,
                template: info.templateId ?? options.template ?? "base",
                sessionId: options.sessionId,
                createdAt: new Date(),
                status: "running",
                metadata: options.metadata ?? {},
            };

            this.activeSandboxes.set(instance.id, instance);

            console.log(
                `[SandboxManager] Sandbox created: ${instance.id} (template: ${instance.template})`
            );

            return instance;
        } catch (error) {
            console.error("[SandboxManager] Failed to create sandbox:", error);
            throw new Error(
                `Failed to create sandbox: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Reconnect to an existing sandbox by ID.
     * Useful for long-running tasks or resuming after a pause.
     */
    async reconnectSandbox(sandboxId: string): Promise<SandboxInstance> {
        try {
            const sandbox = await Sandbox.connect(sandboxId);
            const info = await sandbox.getInfo();

            const instance: SandboxInstance = {
                id: sandboxId,
                sandbox,
                template: info.templateId ?? "base",
                sessionId: (info.metadata as Record<string, string>)?._sessionId ?? undefined,
                createdAt: new Date(info.startedAt),
                status: "running",
                metadata: (info.metadata as Record<string, string>) ?? {},
            };

            this.activeSandboxes.set(sandboxId, instance);

            console.log(`[SandboxManager] Reconnected to sandbox: ${sandboxId}`);
            return instance;
        } catch (error) {
            throw new Error(
                `Failed to reconnect to sandbox ${sandboxId}: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Get an existing sandbox instance.
     */
    getSandbox(id: string): SandboxInstance | undefined {
        return this.activeSandboxes.get(id);
    }

    /**
     * Kill (terminate) a sandbox.
     */
    async killSandbox(id: string): Promise<void> {
        const instance = this.activeSandboxes.get(id);
        if (!instance) {
            console.warn(`[SandboxManager] Sandbox ${id} not found`);
            return;
        }

        try {
            await instance.sandbox.kill();
            instance.status = "terminated";
            this.activeSandboxes.delete(id);
            console.log(`[SandboxManager] Sandbox ${id} terminated`);
        } catch (error) {
            // Don't remove from tracking on failure so callers can retry
            console.error(`[SandboxManager] Failed to kill sandbox ${id}:`, error);
            throw error instanceof Error
                ? error
                : new Error(`Failed to kill sandbox ${id}: ${String(error)}`);
        }
    }

    /**
     * Extend the timeout of an existing sandbox.
     */
    async extendTimeout(id: string, additionalMs: number): Promise<void> {
        const instance = this.activeSandboxes.get(id);
        if (!instance) {
            throw new Error(`Sandbox ${id} not found`);
        }

        await instance.sandbox.setTimeout(additionalMs);
        console.log(
            `[SandboxManager] Sandbox ${id} timeout extended by ${additionalMs}ms`
        );
    }

    /**
     * List all active sandboxes.
     */
    listSandboxes(): SandboxInfo[] {
        return Array.from(this.activeSandboxes.values()).map((s) => ({
            id: s.id,
            template: s.template,
            status: s.status,
            createdAt: s.createdAt.toISOString(),
            metadata: s.metadata,
        }));
    }

    /**
     * Get or create a sandbox. Reuses an existing running sandbox if available.
     * This is the primary method the agent executor should use.
     */
    async getOrCreateSandbox(
        options: SandboxCreateOptions = {}
    ): Promise<SandboxInstance> {
        const requestedTemplate = options.template ?? "base";

        // Only reuse sandboxes from the same session AND template
        // to prevent cross-run pollution (files, packages, env, processes)
        const existing = Array.from(this.activeSandboxes.values()).find(
            (s) =>
                s.status === "running" &&
                s.template === requestedTemplate &&
                s.sessionId === options.sessionId
        );

        if (existing) {
            console.log(`[SandboxManager] Reusing existing sandbox: ${existing.id} (template: ${existing.template}, session: ${existing.sessionId ?? "none"})`);
            return existing;
        }

        return this.createSandbox(options);
    }

    /**
     * Kill all active sandboxes. Call this during cleanup.
     */
    async killAll(): Promise<void> {
        const ids = Array.from(this.activeSandboxes.keys());
        const results = await Promise.allSettled(
            ids.map((id) => this.killSandbox(id))
        );

        const failures = results
            .map((r, i) => (r.status === "rejected" ? { id: ids[i], reason: r.reason } : null))
            .filter(Boolean);

        if (failures.length > 0) {
            console.error(
                `[SandboxManager] ${failures.length}/${ids.length} sandboxes failed to terminate:`,
                failures
            );
        }

        console.log(
            `[SandboxManager] Sandbox cleanup: ${ids.length - failures.length}/${ids.length} terminated`
        );
    }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: SandboxManager | null = null;

export function getSandboxManager(): SandboxManager {
    if (!_instance) {
        _instance = new SandboxManager();
    }
    return _instance;
}
