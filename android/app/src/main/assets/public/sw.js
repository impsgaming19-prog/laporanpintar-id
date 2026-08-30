// Firebase Cloud Messaging Service Worker
// Load Firebase from CDN since public/sw.js doesn't go through Vite bundler

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

// Handle background push notifications
messaging.onBackgroundMessage((payload) => {
  console.log("[SW] Background message:", payload);

  const title = payload.notification?.title || "Pesan Baru";
  const body = payload.notification?.body || "";

  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [100, 50, 100],
    tag: "chat-notification",
    requireInteraction: true,
    data: { url: "/", ...(payload.data || {}) },
  });
});

// Handle notification click - open/focus the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus existing window
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
