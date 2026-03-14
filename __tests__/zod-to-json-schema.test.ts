/**
 * Unit Tests — Zod-to-JSON-Schema Converter
 *
 * Tests the utility that converts Zod schemas to OpenAI-compatible
 * JSON Schema for function calling tool definitions.
 *
 * zodTypeToJsonSchema is internal — we test indirectly through zodToJsonSchema
 * which wraps it for top-level object schemas. Individual type conversion is
 * verified by examining nested properties within object schemas.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "@/lib/agent/utils/zod-to-json-schema";

describe("zodToJsonSchema — type conversion", () => {
    it("converts string fields to { type: 'string' }", () => {
        const result = zodToJsonSchema(z.object({ name: z.string() }));
        expect(result.properties.name).toEqual({ type: "string" });
    });

    it("converts number fields to { type: 'number' }", () => {
        const result = zodToJsonSchema(z.object({ age: z.number() }));
        expect(result.properties.age).toEqual({ type: "number" });
    });

    it("converts boolean fields to { type: 'boolean' }", () => {
        const result = zodToJsonSchema(z.object({ active: z.boolean() }));
        expect(result.properties.active).toEqual({ type: "boolean" });
    });

    it("converts enum fields to { type: 'string', enum: [...] }", () => {
        const result = zodToJsonSchema(z.object({
            status: z.enum(["active", "inactive", "pending"]),
        }));
        expect(result.properties.status).toEqual({
            type: "string",
            enum: ["active", "inactive", "pending"],
        });
    });

    it("converts array fields to { type: 'array', items: {...} }", () => {
        const result = zodToJsonSchema(z.object({
            tags: z.array(z.string()),
        }));
        expect(result.properties.tags).toEqual({
            type: "array",
            items: { type: "string" },
        });
    });

    it("unwraps optional fields and excludes them from required", () => {
        const result = zodToJsonSchema(z.object({
            name: z.string(),
            nickname: z.string().optional(),
        }));
        expect(result.required).toEqual(["name"]);
        expect(result.properties.nickname).toEqual({ type: "string" });
    });

    it("unwraps default fields and includes default value", () => {
        const result = zodToJsonSchema(z.object({
            count: z.number().default(42),
        }));
        expect(result.properties.count).toEqual({ type: "number", default: 42 });
    });

    it("handles string defaults (Zod v3 getter function call)", () => {
        const result = zodToJsonSchema(z.object({
            lang: z.string().default("en"),
        }));
        // Validates the CodeRabbit fix: def.defaultValue is called as function
        expect(result.properties.lang).toEqual({ type: "string", default: "en" });
    });

    it("converts nested objects", () => {
        const result = zodToJsonSchema(z.object({
            user: z.object({
                name: z.string(),
                email: z.string(),
            }),
        }));
        expect(result.properties.user).toEqual({
            type: "object",
            properties: {
                name: { type: "string" },
                email: { type: "string" },
            },
            required: ["name", "email"],
        });
    });
});

describe("zodToJsonSchema — top-level structure", () => {
    it("returns type: 'object' at the top level", () => {
        const result = zodToJsonSchema(z.object({ q: z.string() }));
        expect(result.type).toBe("object");
    });

    it("includes all required fields", () => {
        const result = zodToJsonSchema(z.object({
            query: z.string(),
            limit: z.number(),
        }));
        expect(result.required).toEqual(["query", "limit"]);
    });

    it("excludes optional fields from required", () => {
        const result = zodToJsonSchema(z.object({
            query: z.string(),
            max_results: z.number().optional(),
        }));
        expect(result.required).toEqual(["query"]);
    });

    it("handles schemas with no required fields", () => {
        const result = zodToJsonSchema(z.object({
            a: z.string().optional(),
            b: z.number().optional(),
        }));
        expect(result.required).toEqual([]);
    });
});
