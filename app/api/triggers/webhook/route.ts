/**
 * Composio Webhook Endpoint
 *
 * POST /api/triggers/webhook
 *
 * Receives event payloads from Composio when triggers fire.
 * Verifies HMAC-SHA256 signatures and stores events durably in Convex.
 *
 * Event flow: Composio → this webhook → Convex triggerEvents table
 *           → cron job picks up pending → enqueues agent task
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/agent/triggers";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../convex/_generated/api";

// Lazy-init Convex HTTP client (server-side, no auth needed for public mutations)
let _convex: ConvexHttpClient | null = null;
function getConvex(): ConvexHttpClient | null {
    if (_convex) return _convex;
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    _convex = new ConvexHttpClient(url);
    return _convex;
}

/**
 * Store a trigger event in Convex.
 */
async function storeEvent(event: {
    triggerSlug: string;
    toolkitSlug: string;
    userId?: string;
    triggerId?: string;
    payload: unknown;
}) {
    const convex = getConvex();
    if (!convex) {
        console.warn("[Webhook] Convex not configured, event not persisted:", event.triggerSlug);
        return;
    }

    await convex.mutation(api.triggerEvents.ingestFromWebhook, {
        triggerSlug: event.triggerSlug,
        toolkitSlug: event.toolkitSlug,
        userId: event.userId,
        triggerId: event.triggerId,
        payload: event.payload,
    });
}

export async function POST(request: NextRequest) {
    try {
        const rawBody = await request.text();

        // Extract Composio webhook headers
        const webhookId = request.headers.get("webhook-id") || "";
        const webhookTimestamp = request.headers.get("webhook-timestamp") || "";
        const webhookSignature = request.headers.get("webhook-signature") || "";

        const hasSecret = !!process.env.COMPOSIO_WEBHOOK_SECRET;

        if (hasSecret && webhookSignature) {
            // ── Verified mode (production) ─────────────────────────────
            const verification = await verifyWebhook({
                payload: rawBody,
                signature: webhookSignature,
                webhookId,
                webhookTimestamp,
            });

            if (!verification.valid) {
                console.error("[Webhook] Signature verification failed:", verification.error);
                return NextResponse.json(
                    { error: "Invalid webhook signature" },
                    { status: 401 }
                );
            }

            if (verification.data?.payload) {
                const payload = verification.data.payload;
                await storeEvent({
                    triggerSlug: payload.triggerSlug || "unknown",
                    toolkitSlug: payload.toolkitSlug || "unknown",
                    userId: payload.userId,
                    triggerId: payload.triggerId,
                    payload: payload.payload || payload,
                });
                console.log(
                    `[Webhook] ✅ Verified event → Convex: ${payload.triggerSlug || "unknown"}`
                );
            }
        } else {
            // ── Unverified mode (development) ──────────────────────────
            try {
                const data = JSON.parse(rawBody);

                // Parse V1, V2, V3 Composio payload formats
                const triggerSlug =
                    data.triggerSlug ||
                    data.metadata?.trigger_slug ||
                    data.metadata?.triggerName ||
                    "unknown";
                const toolkitSlug =
                    data.toolkitSlug ||
                    data.metadata?.toolkit_slug ||
                    data.appName ||
                    "unknown";
                const userId =
                    data.userId ||
                    data.metadata?.user_id ||
                    data.metadata?.connection?.clientUniqueUserId ||
                    undefined;
                const triggerId =
                    data.triggerId ||
                    data.metadata?.trigger_id ||
                    undefined;

                await storeEvent({
                    triggerSlug,
                    toolkitSlug,
                    userId,
                    triggerId,
                    payload: data.payload || data.data || data,
                });

                console.log(
                    `[Webhook] ⚠️ Unverified event → Convex: ${triggerSlug}`
                );
            } catch {
                console.error("[Webhook] Invalid payload:", rawBody.slice(0, 200));
                return NextResponse.json(
                    { error: "Invalid payload" },
                    { status: 400 }
                );
            }
        }

        return NextResponse.json({ status: "ok" }, { status: 200 });
    } catch (err) {
        console.error("[Webhook] Unexpected error:", err);
        return NextResponse.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

// GET - health check
export async function GET() {
    return NextResponse.json({
        status: "ok",
        endpoint: "/api/triggers/webhook",
        storage: "convex",
        description: "Composio trigger webhook endpoint → Convex triggerEvents table",
    });
}
