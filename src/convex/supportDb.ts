/**
 * Bagian database layanan bantuan (CS).
 *
 * Dipisah dari `support.ts` karena file tersebut memakai "use node" (untuk
 * memanggil OpenAI), dan Convex hanya mengizinkan ACTION di file Node.js.
 */

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const MAX_BODY = 1000;

/** Percakapan bantuan milik satu customer (satu thread per akun). */
export const threadOfUser = internalQuery({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("supportThreads")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
  },
});

export const createThread = internalMutation({
  args: {
    userId: v.id("appUsers"),
    userEmail: v.string(),
    userName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("supportThreads", {
      userId: args.userId,
      userEmail: args.userEmail,
      userName: args.userName,
      mode: "ai",
      lastMessage: "",
      lastMessageAt: now,
      lastRole: "user",
      unreadForStaff: 0,
      unreadForUser: 0,
      createdAt: now,
    });
  },
});

export const addMessage = internalMutation({
  args: {
    threadId: v.id("supportThreads"),
    role: v.string(),
    body: v.string(),
    authorName: v.optional(v.string()),
    /** Pesan dari customer -> tambah penghitung belum dibaca untuk staff. */
    countForStaff: v.optional(v.boolean()),
    /** Pesan dari AI/staff -> tambah penghitung belum dibaca untuk customer. */
    countForUser: v.optional(v.boolean()),
    /** Ubah mode percakapan sekaligus (mis. dialihkan ke admin). */
    mode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const body = args.body.slice(0, MAX_BODY);
    const id = await ctx.db.insert("supportMessages", {
      threadId: args.threadId,
      role: args.role,
      body,
      authorName: args.authorName ?? undefined,
      createdAt: now,
    });
    const thread = await ctx.db.get(args.threadId);
    if (thread) {
      await ctx.db.patch(args.threadId, {
        lastMessage: body.slice(0, 160),
        lastMessageAt: now,
        lastRole: args.role,
        unreadForStaff: args.countForStaff ? (thread.unreadForStaff || 0) + 1 : thread.unreadForStaff,
        // Customer sedang membuka halaman ini -> hitungan "belum dibaca" dia direset.
        unreadForUser: args.countForUser ? (thread.unreadForUser || 0) + 1 : 0,
        ...(args.mode ? { mode: args.mode } : {}),
      });
    }
    return id;
  },
});

export const messagesOf = internalQuery({
  args: { threadId: v.id("supportThreads"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("supportMessages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .order("desc")
      .take(Math.min(200, Math.max(1, args.limit ?? 60)));
    rows.reverse();
    return rows.map((r) => ({
      id: r._id,
      role: r.role,
      body: r.body,
      authorName: r.authorName ?? null,
      createdAt: r.createdAt,
    }));
  },
});

export const allThreads = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("supportThreads")
      .withIndex("by_lastMessageAt")
      .order("desc")
      .take(100);
    return rows.map((r) => ({
      id: r._id,
      userId: r.userId,
      userEmail: r.userEmail,
      userName: r.userName,
      mode: r.mode,
      lastMessage: r.lastMessage,
      lastMessageAt: r.lastMessageAt,
      lastRole: r.lastRole,
      unreadForStaff: r.unreadForStaff || 0,
    }));
  },
});

export const markThreadRead = internalMutation({
  args: { threadId: v.id("supportThreads"), forStaff: v.boolean() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, args.forStaff ? { unreadForStaff: 0 } : { unreadForUser: 0 });
    return { ok: true };
  },
});

export const setThreadMode = internalMutation({
  args: { threadId: v.id("supportThreads"), mode: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.threadId, { mode: args.mode });
    return { ok: true };
  },
});
