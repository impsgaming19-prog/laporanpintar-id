import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Upsert user (sync from localStorage)
export const upsertUser = mutation({
  args: {
    userId: v.string(),
    username: v.string(),
    fullName: v.string(),
    profilePhoto: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("chatUsers")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        username: args.username,
        fullName: args.fullName,
        profilePhoto: args.profilePhoto,
        lastSeen: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("chatUsers", {
      ...args,
      lastSeen: Date.now(),
    });
  },
});

// Heartbeat - update lastSeen for online status
export const heartbeat = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("chatUsers")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (user) {
      await ctx.db.patch(user._id, { lastSeen: Date.now() });
    }
  },
});

// Get user online status
export const getUserStatus = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("chatUsers")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();

    if (!user) return { isOnline: false, lastSeen: 0, profilePhoto: undefined as string | undefined, username: "" };

    const now = Date.now();
    const isOnline = now - user.lastSeen < 30000;

    return { isOnline, lastSeen: user.lastSeen, profilePhoto: user.profilePhoto, username: user.username };
  },
});

// Search users by username
export const searchUsers = query({
  args: { query: v.string(), currentUserId: v.string() },
  handler: async (ctx, args) => {
    const q = args.query.toLowerCase().trim();
    if (!q) return [];

    const allUsers = await ctx.db.query("chatUsers").collect();
    return allUsers
      .filter(
        (u) =>
          u.userId !== args.currentUserId &&
          (u.username.toLowerCase().includes(q) ||
            u.fullName.toLowerCase().includes(q))
      )
      .slice(0, 20);
  },
});

// Send message
export const sendMessage = mutation({
  args: {
    senderId: v.string(),
    senderName: v.string(),
    receiverId: v.string(),
    text: v.string(),
    image: v.optional(v.string()),
    audio: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
    timer: v.optional(v.number()), // seconds
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();

    // Insert message
    const msgId = await ctx.db.insert("messages", {
      senderId: args.senderId,
      senderName: args.senderName,
      receiverId: args.receiverId,
      text: args.text,
      image: args.image,
      audio: args.audio,
      audioDuration: args.audioDuration,
      timer: args.timer,
      deleteAt: args.timer ? timestamp + args.timer * 1000 : undefined,
      timestamp,
      read: false,
    });

    // Update or create conversation
    const pair1 = await ctx.db
      .query("conversations")
      .withIndex("by_pair", (q) =>
        q.eq("user1Id", args.senderId).eq("user2Id", args.receiverId)
      )
      .unique();

    const pair2 = await ctx.db
      .query("conversations")
      .withIndex("by_pair", (q) =>
        q.eq("user1Id", args.receiverId).eq("user2Id", args.senderId)
      )
      .unique();

    const conv = pair1 || pair2;

    if (conv) {
      await ctx.db.patch(conv._id, {
        lastMessage: args.text,
        lastMessageTime: timestamp,
        lastSenderId: args.senderId,
      });
    } else {
      await ctx.db.insert("conversations", {
        user1Id: args.senderId,
        user2Id: args.receiverId,
        lastMessage: args.text,
        lastMessageTime: timestamp,
        lastSenderId: args.senderId,
      });
    }

    return { success: true, msgId };
  },
});

// Get messages between two users
export const getMessages = query({
  args: {
    user1Id: v.string(),
    user2Id: v.string(),
  },
  handler: async (ctx, args) => {
    const sent = await ctx.db
      .query("messages")
      .withIndex("by_sender_receiver", (q) =>
        q.eq("senderId", args.user1Id).eq("receiverId", args.user2Id)
      )
      .collect();

    const received = await ctx.db
      .query("messages")
      .withIndex("by_sender_receiver", (q) =>
        q.eq("senderId", args.user2Id).eq("receiverId", args.user1Id)
      )
      .collect();

    const now = Date.now();
    const all = [...sent, ...received]
      .filter((m) => !m.deleteAt || m.deleteAt > now)
      .sort((a, b) => a.timestamp - b.timestamp);
    return all;
  },
});

// Get conversations list for a user (optimized - no N+1)
export const getConversations = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const sent = await ctx.db
      .query("conversations")
      .withIndex("by_user1", (q) => q.eq("user1Id", args.userId))
      .collect();

    const received = await ctx.db
      .query("conversations")
      .withIndex("by_user2", (q) => q.eq("user2Id", args.userId))
      .collect();

    const allConvs = [...sent, ...received];

    // Deduplicate by partner ID
    const convByPartner = new Map<string, typeof allConvs[0]>();
    for (const conv of allConvs) {
      const partnerId = conv.user1Id === args.userId ? conv.user2Id : conv.user1Id;
      const existing = convByPartner.get(partnerId);
      if (!existing || conv.lastMessageTime > existing.lastMessageTime) {
        convByPartner.set(partnerId, conv);
      }
    }

    // Batch fetch all partner info
    const partnerIds = [...convByPartner.keys()];
    const partners = await Promise.all(
      partnerIds.map((pid) =>
        ctx.db
          .query("chatUsers")
          .withIndex("by_userId", (q) => q.eq("userId", pid))
          .unique()
      )
    );

    // Batch fetch unread counts for all partners
    const allUnread = await ctx.db
      .query("messages")
      .withIndex("by_receiver_sender", (q) => q.eq("receiverId", args.userId))
      .collect();

    const unreadBySender = new Map<string, number>();
    for (const msg of allUnread) {
      if (!msg.read) {
        unreadBySender.set(msg.senderId, (unreadBySender.get(msg.senderId) || 0) + 1);
      }
    }

    // Build result
    const result = [];
    for (let i = 0; i < partnerIds.length; i++) {
      const partnerId = partnerIds[i];
      const partner = partners[i];
      const conv = convByPartner.get(partnerId)!;

      if (partner) {
        result.push({
          partner,
          lastMessage: conv.lastMessage,
          lastMessageTime: conv.lastMessageTime,
          lastSenderId: conv.lastSenderId,
          unreadCount: unreadBySender.get(partnerId) || 0,
          isOnline: Date.now() - partner.lastSeen < 30000,
        });
      }
    }

    return result.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
  },
});

// Mark messages as read
export const markAsRead = mutation({
  args: { senderId: v.string(), receiverId: v.string() },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("messages")
      .withIndex("by_sender_receiver", (q) =>
        q.eq("senderId", args.senderId).eq("receiverId", args.receiverId)
      )
      .collect();

    for (const msg of unread) {
      if (!msg.read) {
        await ctx.db.patch(msg._id, { read: true });
      }
    }
  },
});

// Cleanup expired timer messages
export const cleanupExpiredMessages = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("messages")
      .withIndex("by_timestamp")
      .collect();
    let deleted = 0;
    for (const msg of expired) {
      if (msg.deleteAt && msg.deleteAt <= now) {
        await ctx.db.delete(msg._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

// Delete a single message
export const deleteMessage = mutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.messageId);
    return { success: true };
  },
});

// Clear all messages between two users
export const clearChat = mutation({
  args: {
    user1Id: v.string(),
    user2Id: v.string(),
  },
  handler: async (ctx, args) => {
    // Delete all messages from user1 to user2
    const sent = await ctx.db
      .query("messages")
      .withIndex("by_sender_receiver", (q) =>
        q.eq("senderId", args.user1Id).eq("receiverId", args.user2Id)
      )
      .collect();

    // Delete all messages from user2 to user1
    const received = await ctx.db
      .query("messages")
      .withIndex("by_sender_receiver", (q) =>
        q.eq("senderId", args.user2Id).eq("receiverId", args.user1Id)
      )
      .collect();

    for (const msg of [...sent, ...received]) {
      await ctx.db.delete(msg._id);
    }

    // Delete conversation entry
    const pair1 = await ctx.db
      .query("conversations")
      .withIndex("by_pair", (q) =>
        q.eq("user1Id", args.user1Id).eq("user2Id", args.user2Id)
      )
      .unique();

    const pair2 = await ctx.db
      .query("conversations")
      .withIndex("by_pair", (q) =>
        q.eq("user1Id", args.user2Id).eq("user2Id", args.user1Id)
      )
      .unique();

    if (pair1) await ctx.db.delete(pair1._id);
    if (pair2) await ctx.db.delete(pair2._id);

    return { success: true, deleted: sent.length + received.length };
  },
});

// Get total unread count for badge
export const getUnreadCount = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const allMessages = await ctx.db
      .query("messages")
      .withIndex("by_timestamp")
      .collect();

    return allMessages.filter(
      (m) => m.receiverId === args.userId && !m.read
    ).length;
  },
});

// Get NEW unread messages for global notification listener
export const getNewMessages = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_receiver_sender", (q) => q.eq("receiverId", args.userId))
      .collect();

    return msgs
      .filter((m) => !m.read)
      .sort((a, b) => b.timestamp - a.timestamp);
  },
});

// Send call event as chat message (like WhatsApp inline call history)
export const sendCallEvent = mutation({
  args: {
    senderId: v.string(),
    senderName: v.string(),
    receiverId: v.string(),
    callType: v.string(), // "voice" | "video"
    status: v.string(), // "missed" | "answered" | "rejected"
    duration: v.number(), // seconds
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();

    const text = args.callType === "video"
      ? (args.status === "missed" ? "Telepon video tidak dijawab"
        : args.status === "rejected" ? "Telepon video ditolak"
        : `Telepon video - ${Math.floor(args.duration / 60)}:${(args.duration % 60).toString().padStart(2, "0")}`)
      : (args.status === "missed" ? "Telepon suara tidak dijawab"
        : args.status === "rejected" ? "Telepon suara ditolak"
        : `Telepon suara - ${Math.floor(args.duration / 60)}:${(args.duration % 60).toString().padStart(2, "0")}`);

    const msgId = await ctx.db.insert("messages", {
      senderId: args.senderId,
      senderName: args.senderName,
      receiverId: args.receiverId,
      text,
      callEvent: {
        type: args.callType,
        status: args.status,
        duration: args.duration,
      },
      timestamp,
      read: false,
    });

    // Update conversation
    const pair1 = await ctx.db
      .query("conversations")
      .withIndex("by_pair", (q) =>
        q.eq("user1Id", args.senderId).eq("user2Id", args.receiverId)
      )
      .unique();

    const pair2 = await ctx.db
      .query("conversations")
      .withIndex("by_pair", (q) =>
        q.eq("user1Id", args.receiverId).eq("user2Id", args.senderId)
      )
      .unique();

    const conv = pair1 || pair2;
    if (conv) {
      await ctx.db.patch(conv._id, {
        lastMessage: text,
        lastMessageTime: timestamp,
        lastSenderId: args.senderId,
      });
    } else {
      await ctx.db.insert("conversations", {
        user1Id: args.senderId,
        user2Id: args.receiverId,
        lastMessage: text,
        lastMessageTime: timestamp,
        lastSenderId: args.senderId,
      });
    }

    return { success: true, msgId };
  },
});
