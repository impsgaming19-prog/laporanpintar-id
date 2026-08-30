import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Owner-managed user accounts
  appUsers: defineTable({
    username: v.string(),
    password: v.string(),
    fullName: v.string(),
    role: v.string(), // "owner" | "customer"
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_username", ["username"]),

  // Registered users (synced from localStorage)
  chatUsers: defineTable({
    userId: v.string(),
    username: v.string(),
    fullName: v.string(),
    profilePhoto: v.optional(v.string()),
    lastSeen: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_username", ["username"]),

  // Messages between two users
  messages: defineTable({
    senderId: v.string(),
    senderName: v.string(),
    receiverId: v.string(),
    text: v.string(),
    image: v.optional(v.string()),
    audio: v.optional(v.string()),
    audioDuration: v.optional(v.number()),
    timer: v.optional(v.number()), // seconds, self-destruct timer
    deleteAt: v.optional(v.number()), // timestamp when message should be deleted
    callEvent: v.optional(v.object({
      type: v.string(), // "voice" | "video"
      status: v.string(), // "missed" | "answered" | "rejected"
      duration: v.number(), // seconds
    })),
    timestamp: v.number(),
    read: v.boolean(),
  })
    .index("by_sender_receiver", ["senderId", "receiverId", "timestamp"])
    .index("by_receiver_sender", ["receiverId", "senderId", "timestamp"])
    .index("by_timestamp", ["timestamp"]),

  // Conversations list (last message per pair)
  conversations: defineTable({
    user1Id: v.string(),
    user2Id: v.string(),
    lastMessage: v.string(),
    lastMessageTime: v.number(),
    lastSenderId: v.string(),
  })
    .index("by_user1", ["user1Id", "lastMessageTime"])
    .index("by_user2", ["user2Id", "lastMessageTime"])
    .index("by_pair", ["user1Id", "user2Id"]),

  // WebRTC call signaling (offer/answer/ICE candidates)
  callSignals: defineTable({
    callerId: v.string(),
    calleeId: v.string(),
    type: v.string(), // "offer" | "answer" | "candidate" | "hangup" | "reject"
    data: v.optional(v.any()),
    timestamp: v.number(),
  })
    .index("by_callee", ["calleeId", "timestamp"])
    .index("by_caller", ["callerId", "timestamp"]),

  // FCM tokens for push notifications
  fcmTokens: defineTable({
    userId: v.string(),
    token: v.string(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_token", ["token"]),

  // Call history log
  callHistory: defineTable({
    callerId: v.string(),
    callerName: v.string(),
    calleeId: v.string(),
    calleeName: v.string(),
    timestamp: v.number(),
    duration: v.number(), // seconds
    status: v.string(), // "answered" | "missed" | "rejected"
  })
    .index("by_caller", ["callerId", "timestamp"])
    .index("by_callee", ["calleeId", "timestamp"]),

});
