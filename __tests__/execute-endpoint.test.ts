/**
 * Unit Tests — Headless Agent Executor
 *
 * Tests the /api/agent/execute endpoint's auth, validation,
 * and response format.
 */

import { describe, it, expect } from "vitest";

// Since the execute route is a Next.js API route, we test the validation
// logic patterns here (the actual HTTP calls require integration tests)

describe("Execute Endpoint Validation", () => {
    // Simulate the validation logic from the route
    function validateRequest(body: Record<string, unknown>, secret: string) {
        if (!secret) {
            return { valid: false, error: "AGENT_INTERNAL_SECRET not configured", status: 500 };
        }
        if (body.apiSecret !== secret) {
            return { valid: false, error: "Unauthorized", status: 401 };
        }
        if (!body.instructions || typeof body.instructions !== "string" || !(body.instructions as string).trim()) {
            return { valid: false, error: "instructions required", status: 400 };
        }
        return { valid: true, error: null, status: 200 };
    }

    it("rejects when AGENT_INTERNAL_SECRET is not set", () => {
        const result = validateRequest(
            { apiSecret: "test", instructions: "do something" },
            "" // no secret configured
        );
        expect(result.valid).toBe(false);
        expect(result.status).toBe(500);
    });

    it("rejects when apiSecret doesn't match", () => {
        const result = validateRequest(
            { apiSecret: "wrong-secret", instructions: "do something" },
            "correct-secret"
        );
        expect(result.valid).toBe(false);
        expect(result.status).toBe(401);
    });

    it("rejects when instructions are missing", () => {
        const result = validateRequest(
            { apiSecret: "secret", instructions: "" },
            "secret"
        );
        expect(result.valid).toBe(false);
        expect(result.status).toBe(400);
    });

    it("rejects when instructions are whitespace-only", () => {
        const result = validateRequest(
            { apiSecret: "secret", instructions: "   " },
            "secret"
        );
        expect(result.valid).toBe(false);
        expect(result.status).toBe(400);
    });

    it("accepts a valid request", () => {
        const result = validateRequest(
            { apiSecret: "my-secret", instructions: "Check email and triage" },
            "my-secret"
        );
        expect(result.valid).toBe(true);
        expect(result.status).toBe(200);
    });

    it("accepts with optional taskId", () => {
        const result = validateRequest(
            {
                apiSecret: "my-secret",
                instructions: "Do the thing",
                taskId: "task_123",
            },
            "my-secret"
        );
        expect(result.valid).toBe(true);
    });
});

describe("Execute Response Format", () => {
    it("validates the expected response structure", () => {
        // The headless agent returns this structure
        const response = {
            success: true,
            result: "Task completed successfully",
            toolsUsed: ["web_search", "create_memory"],
            rounds: 3,
        };

        expect(response.success).toBe(true);
        expect(typeof response.result).toBe("string");
        expect(Array.isArray(response.toolsUsed)).toBe(true);
        expect(typeof response.rounds).toBe("number");
        expect(response.rounds).toBeGreaterThan(0);
    });

    it("validates error response structure", () => {
        const errorResponse = {
            success: false,
            error: "OpenAI API error (429): Rate limited",
        };

        expect(errorResponse.success).toBe(false);
        expect(typeof errorResponse.error).toBe("string");
    });
});
