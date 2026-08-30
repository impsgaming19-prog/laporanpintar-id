// Firebase Cloud Messaging Service Worker
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAALUbktKkL1PxmqLUdR7czX_-kCukW_94",
  authDomain: "laporankuyoks.firebaseapp.com",
  projectId: "laporankuyoks",
  storageBucket: "laporankuyoks.firebasestorage.app",
  messagingSenderId: "276969227812",
  appId: "1:276969227812:web:91173b1df476a96eb27ab1",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("[SW] Background message:", payload);
  const title = payload.notification?.title || payload.data?.title || "Pesan Baru";
  const body = payload.notification?.body || payload.data?.body || "";
  const senderId = payload.data?.senderId || "";
  const url = senderId ? "/chat" : "/";
  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [200, 100, 200, 100, 200],
    tag: payload.data?.tag || "chat-notification",
    requireInteraction: true,
    silent: false,
    data: { url, ...(payload.data || {}) },
    actions: [
      { action: "reply", title: "Balas" },
      { action: "open", title: "Buka" },
    ],
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.navigate(url); return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// Handle notification action buttons
self.addEventListener("notificationaction", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = data.url || "/";

  if (event.action === "accept" && data.type === "call") {
    // Accept call - open app and dispatch accept event
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        for (const c of list) {
          if ("focus" in c) { c.focus(); c.postMessage({ type: "call-accept", data }); return; }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
    );
  } else if (event.action === "reject" && data.type === "call") {
    // Reject call - just close notification
    return;
  } else {
    // Default: open/focus app
    event.waitUntil(
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        for (const c of list) {
          if ("focus" in c) { c.navigate(url); return c.focus(); }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      })
    );
  }
});
