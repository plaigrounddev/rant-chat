/**
 * Composio Trigger Manager
 *
 * Provides CRUD operations for event-driven triggers via Composio's SDK.
 * Supports: webhook triggers (GitHub, Slack), polling triggers (Gmail),
 * real-time subscriptions via Pusher, and trigger lifecycle management.
 *
 * Usage pattern:
 *   1. listTriggerTypes("github") → discover GITHUB_COMMIT_EVENT etc.
 *   2. createTrigger(userId, "GITHUB_COMMIT_EVENT", { repo: "..." })
 *   3. Events delivered via webhook POST or Pusher subscription
 *   4. manageTrigger(triggerId, "disable") → pause a trigger
 */

import { Composio } from "@composio/core";

// ── Types ──────────────────────────────────────────────────────────────────

export interface TriggerType {
    slug: string;
    name: string;
    description: string;
    toolkit: { slug: string; name: string; logo?: string };
    config?: Record<string, unknown>;
}

export interface ActiveTrigger {
    id: string;
    triggerName: string;
    connectedAccountId: string;
    state: string;
    triggerConfig: Record<string, unknown>;
    updatedAt?: string;
    disabledAt?: string;
}

export interface TriggerEvent {
    id: string;
    triggerSlug: string;
    toolkitSlug: string;
    userId?: string;
    payload: Record<string, unknown>;
    receivedAt: string;
}

// ── Composio Instance Access ───────────────────────────────────────────────

/**
 * Get the Composio client instance.
 * We import this lazily to avoid circular dependencies with composio.ts.
 */
let composioRef: Composio | null = null;

function getComposioClient(): Composio | null {
    if (composioRef) return composioRef;

    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
        console.warn("[Triggers] COMPOSIO_API_KEY not set — triggers disabled");
        return null;
    }

    try {
        composioRef = new Composio({ apiKey });
        return composioRef;
    } catch (err) {
        console.error("[Triggers] Failed to create Composio client:", err);
        return null;
    }
}

// ── In-Memory Event Store ──────────────────────────────────────────────────

const MAX_STORED_EVENTS = 100;
const recentEvents: TriggerEvent[] = [];

export function storeEvent(event: TriggerEvent): void {
    recentEvents.unshift(event);
    if (recentEvents.length > MAX_STORED_EVENTS) {
        recentEvents.length = MAX_STORED_EVENTS;
    }
}

export function getRecentEvents(
    triggerId?: string,
    limit = 10
): TriggerEvent[] {
    let events = recentEvents;
    if (triggerId) {
        events = events.filter(
            (e) => e.id === triggerId || e.triggerSlug === triggerId
        );
    }
    return events.slice(0, limit);
}

// ── Trigger Type Discovery ─────────────────────────────────────────────────

/**
 * List available trigger types, optionally filtered by toolkit.
 * Example: listTriggerTypes("github") → GITHUB_COMMIT_EVENT, GITHUB_PULL_REQUEST_EVENT, etc.
 */
export async function listTriggerTypes(
    toolkitSlug?: string
): Promise<TriggerType[]> {
    const composio = getComposioClient();
    if (!composio) {
        return [];
    }

    try {
        const query = toolkitSlug
            ? { toolkits: [toolkitSlug], limit: 50 }
            : { limit: 50 };

        const result = await composio.triggers.listTypes(query);
        const items = result?.items || [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return items.map((item: any) => ({
            slug: item.slug || item.name,
            name: item.name || item.slug,
            description: item.description || "",
            toolkit: {
                slug: item.toolkit?.slug || toolkitSlug || "unknown",
                name: item.toolkit?.name || toolkitSlug || "unknown",
                logo: item.toolkit?.logo,
            },
            config: item.config,
        }));
    } catch (err) {
        console.error("[Triggers] Failed to list trigger types:", err);
        return [];
    }
}

// ── Trigger CRUD ───────────────────────────────────────────────────────────

/**
 * Create a new trigger instance for a user.
 * The user must have a connected account for the relevant toolkit.
 *
 * Example: createTrigger("user_123", "GITHUB_COMMIT_EVENT", { repo: "owner/repo" })
 */
export async function createTrigger(
    userId: string,
    slug: string,
    config?: Record<string, unknown>
): Promise<{ triggerId: string } | { error: string }> {
    const composio = getComposioClient();
    if (!composio) {
        return { error: "Composio not configured. Set COMPOSIO_API_KEY." };
    }

    try {
        const body = config ? { triggerConfig: config } : undefined;
        const result = await composio.triggers.create(userId, slug, body);
        console.log(`[Triggers] Created trigger: ${slug} → ${result.triggerId}`);
        return { triggerId: result.triggerId };
    } catch (err) {
        const message = (err as Error).message || "Failed to create trigger";
        console.error(`[Triggers] Create error (${slug}):`, message);

        // Provide helpful error messages
        if (message.includes("not found")) {
            return {
                error: `Trigger type "${slug}" not found. Use list_trigger_types to discover available triggers.`,
            };
        }
        if (message.includes("No connected account")) {
            return {
                error: `No connected account found. The user needs to connect their account first using Composio's COMPOSIO_MANAGE_CONNECTIONS tool.`,
            };
        }
        return { error: message };
    }
}

/**
 * List all active triggers, optionally filtered.
 */
export async function listActiveTriggers(
    userId?: string
): Promise<ActiveTrigger[]> {
    const composio = getComposioClient();
    if (!composio) {
        return [];
    }

    try {
        const result = await composio.triggers.listActive();
        const items = result?.items || [];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return items.map((item: any) => ({
            id: item.id,
            triggerName: item.triggerName,
            connectedAccountId: item.connectedAccountId,
            state: item.state || "active",
            triggerConfig: item.triggerConfig || {},
            updatedAt: item.updatedAt,
            disabledAt: item.disabledAt,
        }));
    } catch (err) {
        console.error("[Triggers] Failed to list active triggers:", err);
        return [];
    }
}

/**
 * Enable a trigger by ID.
 */
export async function enableTrigger(
    triggerId: string
): Promise<{ success: boolean; error?: string }> {
    const composio = getComposioClient();
    if (!composio) {
        return { success: false, error: "Composio not configured" };
    }

    try {
        await composio.triggers.enable(triggerId);
        console.log(`[Triggers] Enabled trigger: ${triggerId}`);
        return { success: true };
    } catch (err) {
        const message = (err as Error).message || "Failed to enable trigger";
        console.error(`[Triggers] Enable error (${triggerId}):`, message);
        return { success: false, error: message };
    }
}

/**
 * Disable a trigger by ID.
 */
export async function disableTrigger(
    triggerId: string
): Promise<{ success: boolean; error?: string }> {
    const composio = getComposioClient();
    if (!composio) {
        return { success: false, error: "Composio not configured" };
    }

    try {
        await composio.triggers.disable(triggerId);
        console.log(`[Triggers] Disabled trigger: ${triggerId}`);
        return { success: true };
    } catch (err) {
        const message = (err as Error).message || "Failed to disable trigger";
        console.error(`[Triggers] Disable error (${triggerId}):`, message);
        return { success: false, error: message };
    }
}

/**
 * Delete a trigger by ID.
 */
export async function deleteTrigger(
    triggerId: string
): Promise<{ success: boolean; error?: string }> {
    const composio = getComposioClient();
    if (!composio) {
        return { success: false, error: "Composio not configured" };
    }

    try {
        await composio.triggers.delete(triggerId);
        console.log(`[Triggers] Deleted trigger: ${triggerId}`);
        return { success: true };
    } catch (err) {
        const message = (err as Error).message || "Failed to delete trigger";
        console.error(`[Triggers] Delete error (${triggerId}):`, message);
        return { success: false, error: message };
    }
}

// ── Pusher Real-Time Subscription ──────────────────────────────────────────

let isSubscribed = false;

/**
 * Subscribe to real-time trigger events via Pusher.
 * Events are stored in the in-memory event store.
 */
export async function subscribeToPusherTriggers(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callback?: (event: TriggerEvent) => void,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filters?: Record<string, any>
): Promise<{ success: boolean; error?: string }> {
    const composio = getComposioClient();
    if (!composio) {
        return { success: false, error: "Composio not configured" };
    }

    if (isSubscribed) {
        return { success: true }; // Already subscribed
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await composio.triggers.subscribe((data: any) => {
            const event: TriggerEvent = {
                id: data.id || "unknown",
                triggerSlug: data.triggerSlug || "unknown",
                toolkitSlug: data.toolkitSlug || "unknown",
                userId: data.userId,
                payload: data.payload || data,
                receivedAt: new Date().toISOString(),
            };

            storeEvent(event);
            console.log(
                `[Triggers] Received event: ${event.triggerSlug} from ${event.toolkitSlug}`
            );

            if (callback) {
                callback(event);
            }
        }, filters);

        isSubscribed = true;
        console.log("[Triggers] ✅ Subscribed to Pusher trigger events");
        return { success: true };
    } catch (err) {
        const message = (err as Error).message || "Failed to subscribe";
        console.error("[Triggers] Subscribe error:", message);
        return { success: false, error: message };
    }
}

/**
 * Unsubscribe from Pusher trigger events.
 */
export async function unsubscribeFromTriggers(): Promise<{
    success: boolean;
    error?: string;
}> {
    const composio = getComposioClient();
    if (!composio) {
        return { success: false, error: "Composio not configured" };
    }

    try {
        await composio.triggers.unsubscribe();
        isSubscribed = false;
        console.log("[Triggers] ✅ Unsubscribed from trigger events");
        return { success: true };
    } catch (err) {
        const message = (err as Error).message || "Failed to unsubscribe";
        console.error("[Triggers] Unsubscribe error:", message);
        return { success: false, error: message };
    }
}

// ── Webhook Verification ───────────────────────────────────────────────────

/**
 * Verify an incoming webhook payload from Composio.
 * Uses HMAC-SHA256 signature verification.
 */
export async function verifyWebhook(params: {
    payload: string;
    signature: string;
    webhookId: string;
    webhookTimestamp: string;
}): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    valid: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data?: any;
    error?: string;
}> {
    const composio = getComposioClient();
    if (!composio) {
        return { valid: false, error: "Composio not configured" };
    }

    const secret = process.env.COMPOSIO_WEBHOOK_SECRET;
    if (!secret) {
        return { valid: false, error: "COMPOSIO_WEBHOOK_SECRET not set" };
    }

    try {
        const result = await composio.triggers.verifyWebhook({
            payload: params.payload,
            signature: params.signature,
            secret,
            id: params.webhookId,
            timestamp: params.webhookTimestamp,
        });

        return { valid: true, data: result };
    } catch (err) {
        const message = (err as Error).message || "Verification failed";
        console.error("[Triggers] Webhook verification error:", message);
        return { valid: false, error: message };
    }
}
