// convex/users.ts
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Store or update a user from Clerk identity.
 * Called when user first authenticates.
 */
export const store = mutation({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) {
            throw new Error("Not authenticated");
        }

        // Check if user already exists
        const existing = await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();

        if (existing) {
            // Update existing user
            await ctx.db.patch(existing._id, {
                name: identity.name ?? existing.name,
                email: identity.email ?? existing.email,
                imageUrl: identity.pictureUrl ?? existing.imageUrl,
            });
            return existing._id;
        }

        // Create new user
        return await ctx.db.insert("users", {
            clerkId: identity.subject,
            name: identity.name,
            email: identity.email,
            imageUrl: identity.pictureUrl,
            createdAt: Date.now(),
        });
    },
});

/**
 * Get the current authenticated user
 */
export const me = query({
    args: {},
    handler: async (ctx) => {
        const identity = await ctx.auth.getUserIdentity();
        if (!identity) return null;

        return await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
            .unique();
    },
});
