import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Save FCM token for a user
export const saveToken = mutation({
  args: {
    userId: v.string(),
    token: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("fcmTokens")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { createdAt: Date.now() });
      return existing._id;
    }

    const oldTokens = await ctx.db
      .query("fcmTokens")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    for (const old of oldTokens) {
      await ctx.db.delete(old._id);
    }

    return await ctx.db.insert("fcmTokens", {
      userId: args.userId,
      token: args.token,
      createdAt: Date.now(),
    });
  },
});

// Get FCM tokens for a user
export const getTokens = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("fcmTokens")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
  },
});
