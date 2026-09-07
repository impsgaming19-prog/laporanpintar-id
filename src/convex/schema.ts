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
    balance: v.optional(v.number()), // saldo customer (Rupiah)
  })
    .index("by_username", ["username"]),

  // Pengaturan toko yang bisa diubah Owner dari Panel Admin (mis. visibilitas server)
  nokosSettings: defineTable({
    key: v.string(),
    value: v.any(),
  })
    .index("by_key", ["key"]),

  // Deposit (isi saldo) customer — dicatat biar kredit saldo hanya sekali
  nokosDeposits: defineTable({
    userId: v.id("appUsers"),
    referenceId: v.string(),
    amount: v.number(),
    status: v.string(), // "pending" | "paid" | "expired"
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index("by_reference", ["referenceId"])
    .index("by_user", ["userId", "createdAt"]),

  // Riwayat order nomor per customer
  nokosOrders: defineTable({
    userId: v.id("appUsers"),
    provider: v.string(),
    providerLabel: v.string(),
    country: v.string(),
    countryName: v.optional(v.string()),
    service: v.string(),
    serviceName: v.optional(v.string()),
    orderId: v.string(), // id order dari provider
    sellPrice: v.number(),
    providerPrice: v.number(),
    status: v.string(), // "ordered" | "otp" | "done" | "refunded" | "failed"
    otp: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_orderId", ["orderId"])
    .index("by_user", ["userId", "createdAt"]),

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
