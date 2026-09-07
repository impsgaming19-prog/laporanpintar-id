"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";

let cachedApp: App | null = null;
let cachedMessaging: Messaging | null = null;

function getMessagingService(): Messaging {
  if (cachedMessaging) return cachedMessaging;

  const existing = getApps().find((app) => app?.name === "fcm-sender");
  let app: App;
  if (existing) {
    app = existing;
  } else {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT env var not set");
    }
    const serviceAccount = JSON.parse(serviceAccountJson);
    app = initializeApp({ credential: cert(serviceAccount) }, "fcm-sender");
  }

  cachedApp = app;
  cachedMessaging = getMessaging(app);
  return cachedMessaging;
}

// Send push notification to user via Firebase Admin SDK (V1 API)
export const sendPushNotification = action({
  args: {
    recipientId: v.string(),
    title: v.string(),
    body: v.string(),
    senderId: v.string(),
    senderName: v.string(),
  },
  handler: async (ctx, args) => {
    const tokensDoc: { userId: string; token: string; createdAt: number }[] =
      await ctx.runQuery(api.fcm.getTokens, {
        userId: args.recipientId,
      });

    if (!tokensDoc || tokensDoc.length === 0) {
      return { success: false, reason: "No FCM tokens" };
    }

    const messaging = getMessagingService();

    const results: { token: string; successId?: string; error?: string }[] = [];
    for (const tokenDoc of tokensDoc) {
      try {
        const messageId = await messaging.send({
          token: tokenDoc.token,
          notification: {
            title: args.title,
            body: args.body,
          },
          android: {
            priority: "high" as const,
            notification: {
              title: args.title,
              body: args.body,
              icon: "/icon-192.png",
              channelId: "chat-messages",
            },
          },
          webpush: {
            headers: {
              TTL: "0",
              Urgency: "high",
            },
            notification: {
              title: args.title,
              body: args.body,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              requireInteraction: true,
              actions: [
                { action: "open", title: "Buka Chat" },
              ],
            },
            fcmOptions: {
              link: "/",
            },
          },
          data: {
            senderId: args.senderId,
            senderName: args.senderName,
            type: "message",
          },
        });
        results.push({ token: tokenDoc.token.substring(0, 20), successId: messageId });
      } catch (error: any) {
        results.push({ token: tokenDoc.token.substring(0, 20), error: String(error.message || error) });
      }
    }

    return { success: true, results };
  },
});

// Send call notification
export const sendCallNotification = action({
  args: {
    recipientId: v.string(),
    callerId: v.string(),
    callerName: v.string(),
    callType: v.string(),
  },
  handler: async (ctx, args) => {
    const tokensDoc: { userId: string; token: string; createdAt: number }[] =
      await ctx.runQuery(api.fcm.getTokens, {
        userId: args.recipientId,
      });

    if (!tokensDoc || tokensDoc.length === 0) {
      return { success: false, reason: "No FCM tokens" };
    }

    const messaging = getMessagingService();
    const callTypeLabel = args.callType === "video" ? "Video Call" : "Panggilan";

    const results: { token: string; successId?: string; error?: string }[] = [];
    for (const tokenDoc of tokensDoc) {
      try {
        const messageId = await messaging.send({
          token: tokenDoc.token,
          notification: {
            title: `${callTypeLabel} Masuk`,
            body: `${args.callerName} memanggil kamu`,
          },
          android: {
            priority: "high" as const,
            notification: {
              title: `${callTypeLabel} Masuk`,
              body: `${args.callerName} memanggil kamu`,
              icon: "/icon-192.png",
              channelId: "incoming-calls",
            },
          },
          webpush: {
            headers: {
              TTL: "0",
              Urgency: "high",
            },
            notification: {
              title: `${callTypeLabel} Masuk`,
              body: `${args.callerName} memanggil kamu`,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
              requireInteraction: true,
              actions: [
                { action: "accept", title: "Angkat" },
                { action: "reject", title: "Tolak" },
              ],
            },
            fcmOptions: {
              link: "/",
            },
          },
          data: {
            callerId: args.callerId,
            callerName: args.callerName,
            callType: args.callType,
            type: "call",
          },
        });
        results.push({ token: tokenDoc.token.substring(0, 20), successId: messageId });
      } catch (error: any) {
        results.push({ token: tokenDoc.token.substring(0, 20), error: String(error.message || error) });
      }
    }

    return { success: true, results };
  },
});
