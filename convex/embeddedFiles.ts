// convex/embeddedFiles.ts
// Queries and mutations for the embeddedFiles table
// (Cannot be in "use node" file — only actions can use Node.js runtime)

import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";

// ── Internal: Look up user by Clerk ID ──────────────────────────────────
export const getUserByClerkId = internalQuery({
    args: { clerkId: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
            .unique();
    },
});

// ── Internal: Update embedded file status ───────────────────────────────
export const updateFileStatus = internalMutation({
    args: {
        fileId: v.id("embeddedFiles"),
        status: v.union(
            v.literal("pending"),
            v.literal("embedding"),
            v.literal("ready"),
            v.literal("failed"),
        ),
        entryId: v.optional(v.string()),
        dimensions: v.optional(v.number()),
        errorMessage: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const updates: Record<string, unknown> = { status: args.status };
        if (args.entryId !== undefined) updates.entryId = args.entryId;
        if (args.dimensions !== undefined) updates.dimensions = args.dimensions;
        if (args.errorMessage !== undefined) updates.errorMessage = args.errorMessage;
        await ctx.db.patch(args.fileId, updates);
    },
});

// ── List embedded files for a user ──────────────────────────────────────
export const listUserFiles = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return [];

        const user = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
        if (!user) return [];

        return await ctx.db
            .query("embeddedFiles")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .order("desc")
            .take(50);
    },
});

// ── Register file upload (mutation, creates pending record) ─────────────
export const registerFileUpload = internalMutation({
    args: {
        userId: v.id("users"),
        fileName: v.string(),
        mimeType: v.string(),
        storageId: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("embeddedFiles", {
            userId: args.userId,
            fileName: args.fileName,
            mimeType: args.mimeType,
            storageId: args.storageId,
            status: "pending",
            createdAt: Date.now(),
        });
    },
});
