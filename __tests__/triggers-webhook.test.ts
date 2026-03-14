/**
 * Unit Tests — Webhook Route & Trigger Event Processing
 *
 * Tests the trigger event parsing logic and webhook payload
 * format handling (V1, V2, V3 Composio formats).
 */

import { describe, it, expect } from "vitest";

// ── V1/V2/V3 Payload Parsing ──────────────────────────────────────────────

describe("Composio Webhook Payload Parsing", () => {
    // Simulate the parsing logic from the webhook route
    function parsePayload(body: Record<string, unknown>) {
        // V3 format: { id, type, metadata: { trigger_slug, ... }, data }
        if (body.metadata && typeof body.metadata === "object") {
            const meta = body.metadata as Record<string, unknown>;
            return {
                format: "v3",
                triggerSlug: meta.trigger_slug || meta.triggerSlug || "unknown",
                toolkitSlug: (meta.appName as string) || "unknown",
                payload: body.data || body,
                connectionId: meta.connection_id || meta.connectionId,
            };
        }

        // V2 format: { trigger_slug, toolkit_slug, payload }
        if (body.trigger_slug || body.triggerSlug) {
            return {
                format: "v2",
                triggerSlug: body.trigger_slug || body.triggerSlug,
                toolkitSlug: body.toolkit_slug || body.toolkitSlug || "unknown",
                payload: body.payload || body,
                connectionId: body.connection_id || body.connectionId,
            };
        }

        // V1 format: flat payload
        return {
            format: "v1",
            triggerSlug: "unknown",
            toolkitSlug: "unknown",
            payload: body,
            connectionId: undefined,
        };
    }

    it("parses V3 format (metadata + data)", () => {
        const v3Payload = {
            id: "evt_123",
            type: "trigger.event",
            metadata: {
                trigger_slug: "GMAIL_NEW_EMAIL",
                appName: "gmail",
                connection_id: "conn_456",
                trigger_id: "trg_789",
            },
            data: {
                from: "sender@example.com",
                subject: "Hello!",
            },
        };

        const parsed = parsePayload(v3Payload);
        expect(parsed.format).toBe("v3");
        expect(parsed.triggerSlug).toBe("GMAIL_NEW_EMAIL");
        expect(parsed.toolkitSlug).toBe("gmail");
        expect(parsed.connectionId).toBe("conn_456");
        expect((parsed.payload as Record<string, unknown>).subject).toBe("Hello!");
    });

    it("parses V2 format (trigger_slug + payload)", () => {
        const v2Payload = {
            trigger_slug: "SLACK_NEW_MESSAGE",
            toolkit_slug: "slack",
            connection_id: "conn_abc",
            payload: {
                channel: "#general",
                text: "Hello team!",
            },
        };

        const parsed = parsePayload(v2Payload);
        expect(parsed.format).toBe("v2");
        expect(parsed.triggerSlug).toBe("SLACK_NEW_MESSAGE");
        expect(parsed.toolkitSlug).toBe("slack");
        expect(parsed.connectionId).toBe("conn_abc");
    });

    it("parses V1 format (flat payload)", () => {
        const v1Payload = {
            event_type: "message",
            data: { text: "hello" },
        };

        const parsed = parsePayload(v1Payload);
        expect(parsed.format).toBe("v1");
        expect(parsed.triggerSlug).toBe("unknown");
        expect(parsed.payload).toEqual(v1Payload);
    });

    it("handles camelCase V2 variants", () => {
        const camelPayload = {
            triggerSlug: "GITHUB_PUSH",
            toolkitSlug: "github",
            connectionId: "conn_xyz",
            payload: { ref: "refs/heads/main" },
        };

        const parsed = parsePayload(camelPayload);
        expect(parsed.format).toBe("v2");
        expect(parsed.triggerSlug).toBe("GITHUB_PUSH");
        expect(parsed.toolkitSlug).toBe("github");
    });

    it("handles empty/minimal payloads gracefully", () => {
        const parsed = parsePayload({});
        expect(parsed.format).toBe("v1");
        expect(parsed.triggerSlug).toBe("unknown");
    });
});

// ── HMAC Verification ─────────────────────────────────────────────────────

describe("HMAC-SHA256 Verification", () => {
    // Simulate the verification logic
    async function verifyHMAC(
        payload: string,
        signature: string,
        secret: string
    ): Promise<boolean> {
        const { createHmac } = await import("crypto");
        const expected = createHmac("sha256", secret)
            .update(payload)
            .digest("hex");
        return expected === signature;
    }

    it("verifies a valid HMAC-SHA256 signature", async () => {
        const { createHmac } = await import("crypto");
        const secret = "test-secret-key";
        const payload = '{"event":"test"}';
        const signature = createHmac("sha256", secret)
            .update(payload)
            .digest("hex");

        const isValid = await verifyHMAC(payload, signature, secret);
        expect(isValid).toBe(true);
    });

    it("rejects an invalid signature", async () => {
        const isValid = await verifyHMAC(
            '{"event":"test"}',
            "invalid-signature",
            "test-secret"
        );
        expect(isValid).toBe(false);
    });

    it("rejects when payload is tampered", async () => {
        const { createHmac } = await import("crypto");
        const secret = "test-secret";
        const signature = createHmac("sha256", secret)
            .update('{"event":"original"}')
            .digest("hex");

        const isValid = await verifyHMAC(
            '{"event":"tampered"}',
            signature,
            secret
        );
        expect(isValid).toBe(false);
    });
});
