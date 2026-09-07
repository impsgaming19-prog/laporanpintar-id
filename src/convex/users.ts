import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Owner creates a new user account
export const createUser = mutation({
  args: {
    username: v.string(),
    password: v.string(),
    fullName: v.string(),
    createdBy: v.string(),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if username already exists
    const existing = await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique();

    if (existing) {
      return { success: false, error: "Username sudah digunakan" };
    }

    const id = await ctx.db.insert("appUsers", {
      username: args.username,
      password: args.password,
      fullName: args.fullName,
      role: args.role || "customer",
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });

    return { success: true, id };
  },
});

// Delete a user account
export const deleteUser = mutation({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.userId);
    return { success: true };
  },
});

// List all user accounts
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appUsers").collect();
  },
});

// Verify login (check both owner & customer accounts)
export const verifyLogin = query({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .unique();

    if (!user) return null;
    if (user.password !== args.password) return null;

    return {
      id: user._id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    };
  },
});

// Update username
export const updateUsername = mutation({
  args: {
    userId: v.id("appUsers"),
    newUsername: v.string(),
  },
  handler: async (ctx, args) => {
    // Check if new username already exists
    const existing = await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", args.newUsername))
      .unique();
    if (existing && existing._id !== args.userId) {
      return { success: false, error: "Username sudah digunakan" };
    }
    await ctx.db.patch(args.userId, { username: args.newUsername });
    return { success: true };
  },
});

// Change password
export const changePassword = mutation({
  args: {
    userId: v.id("appUsers"),
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { success: false, error: "Akun tidak ditemukan" };
    if (user.password !== args.currentPassword) return { success: false, error: "Password lama salah" };
    if (args.newPassword.length < 4) return { success: false, error: "Password baru minimal 4 karakter" };
    await ctx.db.patch(args.userId, { password: args.newPassword });
    return { success: true };
  },
});

// Update profile photo in Convex (for chat display)
export const updateProfilePhoto = mutation({
  args: {
    userId: v.string(),
    profilePhoto: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("chatUsers")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (user) {
      await ctx.db.patch(user._id, { profilePhoto: args.profilePhoto });
    }
  },
});
