import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Send a call signal (offer, answer, candidate, hangup, reject)
export const sendSignal = mutation({
  args: {
    callerId: v.string(),
    calleeId: v.string(),
    type: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Delete old signals between these two users (cleanup)
    const old = await ctx.db
      .query("callSignals")
      .withIndex("by_caller", (q) => q.eq("callerId", args.callerId))
      .collect();
    for (const sig of old) {
      if (sig.calleeId === args.calleeId || sig.callerId === args.calleeId) {
        await ctx.db.delete(sig._id);
      }
    }

    return await ctx.db.insert("callSignals", {
      callerId: args.callerId,
      calleeId: args.calleeId,
      type: args.type,
      data: args.data,
      timestamp: Date.now(),
    });
  },
});

// Get pending signals for a user (polling)
export const getSignals = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("callSignals")
      .withIndex("by_callee", (q) => q.eq("calleeId", args.userId))
      .collect();
  },
});

// Delete a signal after processing
export const deleteSignal = mutation({
  args: { signalId: v.id("callSignals") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.signalId);
  },
});

// Hang up - send hangup signal + log call
export const hangUp = mutation({
  args: {
    callerId: v.string(),
    callerName: v.optional(v.string()),
    calleeId: v.string(),
    calleeName: v.optional(v.string()),
    duration: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Delete all signals between these users
    const sigs = await ctx.db.query("callSignals").collect();
    for (const sig of sigs) {
      if (
        (sig.callerId === args.callerId && sig.calleeId === args.calleeId) ||
        (sig.callerId === args.calleeId && sig.calleeId === args.callerId)
      ) {
        await ctx.db.delete(sig._id);
      }
    }

    // Log call history
    if (args.callerName && args.calleeName) {
      await ctx.db.insert("callHistory", {
        callerId: args.callerId,
        callerName: args.callerName,
        calleeId: args.calleeId,
        calleeName: args.calleeName,
        timestamp: Date.now(),
        duration: args.duration || 0,
        status: args.status || "answered",
      });
    }
  },
});

// Reject call - send reject signal + log missed call
export const rejectCall = mutation({
  args: {
    callerId: v.string(),
    callerName: v.optional(v.string()),
    calleeId: v.string(),
    calleeName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Send reject signal
    await ctx.db.insert("callSignals", {
      callerId: args.calleeId,
      calleeId: args.callerId,
      type: "reject",
      timestamp: Date.now(),
    });

    // Delete all signals between these users
    const sigs = await ctx.db.query("callSignals").collect();
    for (const sig of sigs) {
      if (
        (sig.callerId === args.callerId && sig.calleeId === args.calleeId) ||
        (sig.callerId === args.calleeId && sig.calleeId === args.callerId)
      ) {
        await ctx.db.delete(sig._id);
      }
    }

    // Log as missed/rejected call
    if (args.callerName && args.calleeName) {
      await ctx.db.insert("callHistory", {
        callerId: args.callerId,
        callerName: args.callerName,
        calleeId: args.calleeId,
        calleeName: args.calleeName,
        timestamp: Date.now(),
        duration: 0,
        status: "rejected",
      });
    }
  },
});

// Clear all call history for a user
export const clearCallHistory = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    // Delete as caller
    const asCaller = await ctx.db
      .query("callHistory")
      .withIndex("by_caller", (q) => q.eq("callerId", args.userId))
      .collect();
    for (const call of asCaller) {
      await ctx.db.delete(call._id);
    }
    // Delete as callee
    const asCallee = await ctx.db
      .query("callHistory")
      .withIndex("by_callee", (q) => q.eq("calleeId", args.userId))
      .collect();
    for (const call of asCallee) {
      await ctx.db.delete(call._id);
    }
    return { success: true, deleted: asCaller.length + asCallee.length };
  },
});

// Delete a single call history entry
export const deleteCallEntry = mutation({
  args: { callId: v.id("callHistory") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.callId);
    return { success: true };
  },
});

// Get call history for a user
export const getCallHistory = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const asCaller = await ctx.db
      .query("callHistory")
      .withIndex("by_caller", (q) => q.eq("callerId", args.userId))
      .order("desc")
      .take(50);

    const asCallee = await ctx.db
      .query("callHistory")
      .withIndex("by_callee", (q) => q.eq("calleeId", args.userId))
      .order("desc")
      .take(50);

    // Merge + sort by time
    const all = [...asCaller, ...asCallee].sort((a, b) => b.timestamp - a.timestamp);
    return all.slice(0, 30);
  },
});
