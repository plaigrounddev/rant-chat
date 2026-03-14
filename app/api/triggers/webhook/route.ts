/**
 * Composio Webhook Endpoint
 *
 * POST /api/triggers/webhook
 *
 * Receives event payloads from Composio when triggers fire.
 * Verifies HMAC-SHA256 signatures and stores events.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook, storeEvent, type TriggerEvent } from "@/lib/agent/triggers";

export async function POST(request: NextRequest) {
    try {
        // Read raw body for signature verification
        const rawBody = await request.text();

        // Extract Composio webhook headers
        const webhookId = request.headers.get("webhook-id") || "";
        const webhookTimestamp = request.headers.get("webhook-timestamp") || "";
        const webhookSignature = request.headers.get("webhook-signature") || "";

        // If we have a webhook secret, verify the signature
        const hasSecret = !!process.env.COMPOSIO_WEBHOOK_SECRET;

        if (hasSecret && webhookSignature) {
            const verification = await verifyWebhook({
                payload: rawBody,
                signature: webhookSignature,
                webhookId,
                webhookTimestamp,
            });

            if (!verification.valid) {
                console.error(
                    "[Webhook] Signature verification failed:",
                    verification.error
                );
                return NextResponse.json(
                    { error: "Invalid webhook signature" },
                    { status: 401 }
                );
            }

            // Store the verified event
            if (verification.data?.payload) {
                const payload = verification.data.payload;
                const event: TriggerEvent = {
                    id: payload.id || "unknown",
                    triggerSlug: payload.triggerSlug || "unknown",
                    toolkitSlug: payload.toolkitSlug || "unknown",
                    userId: payload.userId,
                    payload: payload.payload || payload,
                    receivedAt: new Date().toISOString(),
                };
                storeEvent(event);
                console.log(
                    `[Webhook] ✅ Verified event: ${event.triggerSlug} from ${event.toolkitSlug}`
                );
            }
        } else {
            // No secret configured — accept unverified (development mode)
            try {
                const data = JSON.parse(rawBody);
                const event: TriggerEvent = {
                    id: data.id || data.trigger_id || "unknown",
                    triggerSlug:
                        data.triggerSlug ||
                        data.metadata?.trigger_slug ||
                        data.metadata?.triggerName ||
                        "unknown",
                    toolkitSlug:
                        data.toolkitSlug ||
                        data.metadata?.toolkit_slug ||
                        data.appName ||
                        "unknown",
                    userId:
                        data.userId ||
                        data.metadata?.user_id ||
                        data.metadata?.connection?.clientUniqueUserId ||
                        undefined,
                    payload: data.payload || data.data || data,
                    receivedAt: new Date().toISOString(),
                };
                storeEvent(event);
                console.log(
                    `[Webhook] ⚠️ Unverified event (no secret): ${event.triggerSlug} from ${event.toolkitSlug}`
                );
            } catch {
                console.error("[Webhook] Failed to parse payload:", rawBody.slice(0, 200));
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
        description: "Composio trigger webhook endpoint",
    });
}
