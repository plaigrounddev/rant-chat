// convex/auraSchema.ts
// Schema definitions for AuraOS cloud tables.
// These tables store synced data from the iOS app's local MemPalace.
//
// Note: Add these table definitions to your main schema.ts or
// ensure your Convex deployment includes them.

import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * AuraOS table definitions for Convex schema.
 *
 * Usage: Import and spread into your main defineSchema() call:
 *
 * ```ts
 * import { auraMemories, auraNotes, auraActions } from "./auraSchema";
 *
 * export default defineSchema({
 *   ...existingTables,
 *   aura_memories: auraMemories,
 *   aura_notes: auraNotes,
 *   aura_actions: auraActions,
 * });
 * ```
 */

/** Synced memories from the iOS app's MemPalace */
export const auraMemories = defineTable({
    deviceId: v.string(),      // Original UUID from iOS device
    type: v.string(),          // "episodic" | "semantic" | "procedural"
    content: v.string(),       // Memory content text
    tags: v.array(v.string()), // Searchable tags
    timestamp: v.number(),     // Original creation time (ms since epoch)
    createdAt: v.number(),     // Cloud sync time
    updatedAt: v.number(),     // Last update time
}).index("by_device_id", ["deviceId"])
  .index("by_type", ["type"])
  .index("by_timestamp", ["timestamp"]);

/** Synced voice notes from the iOS app */
export const auraNotes = defineTable({
    deviceId: v.string(),          // Original UUID from iOS device
    category: v.string(),          // "note" | "task" | "reminder" | "action" | "contact" | "idea" | "query"
    rawTranscription: v.string(),  // Original voice transcription
    content: v.string(),           // AI-parsed/cleaned content
    tags: v.array(v.string()),     // Auto-generated tags
    timestamp: v.number(),         // Original creation time
    contextLocation: v.string(),   // GPS or place name context
    createdAt: v.number(),
    updatedAt: v.number(),
}).index("by_device_id", ["deviceId"])
  .index("by_category", ["category"])
  .index("by_timestamp", ["timestamp"]);

/** Action execution audit log */
export const auraActions = defineTable({
    deviceActionId: v.string(),  // Original action UUID from iOS device
    type: v.string(),            // "sendEmail" | "createCalendarEvent" | "postSlack" | etc.
    title: v.string(),           // Human-readable action description
    payload: v.string(),         // JSON-encoded action parameters
    status: v.string(),          // "completed" | "failed"
    executedAt: v.number(),      // Execution timestamp
}).index("by_device_action_id", ["deviceActionId"])
  .index("by_type", ["type"])
  .index("by_status", ["status"]);
