/**
 * Zod to JSON Schema converter
 *
 * Converts Zod schemas to JSON Schema format compatible with OpenAI's
 * function calling parameter specification.
 */

import { type ZodType } from "zod";

interface JsonSchemaProperty {
    type: string;
    description?: string;
    enum?: string[];
    default?: unknown;
    items?: JsonSchemaProperty;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
}

interface JsonSchema {
    type: "object";
    properties: Record<string, JsonSchemaProperty>;
    required: string[];
}

/**
 * Convert a Zod schema into a JSON Schema object suitable for
 * OpenAI function calling parameters.
 *
 * Handles: z.object, z.string, z.number, z.boolean, z.enum, z.array,
 *          z.optional, z.default
 */
export function zodToJsonSchema(schema: ZodType): JsonSchema {
    const def = (schema as unknown as { _def: Record<string, unknown> })._def;

    // Handle ZodObject
    if (def.typeName === "ZodObject") {
        const shape = (def.shape as () => Record<string, ZodType>)();
        const properties: Record<string, JsonSchemaProperty> = {};
        const required: string[] = [];

        for (const [key, fieldSchema] of Object.entries(shape)) {
            properties[key] = zodTypeToJsonSchema(fieldSchema);

            // Check if the field is required (not optional, not default)
            const fieldDef = (fieldSchema as unknown as { _def: Record<string, unknown> })._def;
            if (fieldDef.typeName !== "ZodOptional" && fieldDef.typeName !== "ZodDefault") {
                required.push(key);
            }
        }

        return { type: "object", properties, required };
    }

    // Fallback for non-object schemas (wrap in empty object)
    return { type: "object", properties: {}, required: [] };
}

function zodTypeToJsonSchema(schema: ZodType): JsonSchemaProperty {
    const def = (schema as unknown as { _def: Record<string, unknown> })._def;
    const description = (def.description as string) ?? (schema as unknown as { description?: string }).description;

    switch (def.typeName) {
        case "ZodString":
            return { type: "string", ...(description && { description }) };

        case "ZodNumber":
            return { type: "number", ...(description && { description }) };

        case "ZodBoolean":
            return { type: "boolean", ...(description && { description }) };

        case "ZodEnum": {
            const values = def.values as string[];
            return { type: "string", enum: values, ...(description && { description }) };
        }

        case "ZodArray": {
            const itemSchema = def.type as ZodType;
            return {
                type: "array",
                items: zodTypeToJsonSchema(itemSchema),
                ...(description && { description }),
            };
        }

        case "ZodOptional": {
            const innerSchema = def.innerType as ZodType;
            return zodTypeToJsonSchema(innerSchema);
        }

        case "ZodDefault": {
            const innerSchema = def.innerType as ZodType;
            const result = zodTypeToJsonSchema(innerSchema);
            result.default = def.defaultValue;
            return result;
        }

        case "ZodObject": {
            const shape = (def.shape as () => Record<string, ZodType>)();
            const properties: Record<string, JsonSchemaProperty> = {};
            const required: string[] = [];

            for (const [key, fieldSchema] of Object.entries(shape)) {
                properties[key] = zodTypeToJsonSchema(fieldSchema);
                const fieldDef = (fieldSchema as unknown as { _def: Record<string, unknown> })._def;
                if (fieldDef.typeName !== "ZodOptional" && fieldDef.typeName !== "ZodDefault") {
                    required.push(key);
                }
            }

            return {
                type: "object",
                properties,
                required,
                ...(description && { description }),
            };
        }

        case "ZodRecord": {
            return {
                type: "object",
                ...(description && { description }),
            };
        }

        case "ZodUnknown":
        case "ZodAny":
            return { type: "string", ...(description && { description }) };

        default:
            return { type: "string", ...(description && { description }) };
    }
}
