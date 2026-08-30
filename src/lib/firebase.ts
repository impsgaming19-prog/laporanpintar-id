import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyAALUbktKkL1PxmqLUdR7czX_-kCukW_94",
  authDomain: "laporankuyoks.firebaseapp.com",
  projectId: "laporankuyoks",
  storageBucket: "laporankuyoks.firebasestorage.app",
  messagingSenderId: "276969227812",
  appId: "1:276969227812:web:91173b1df476a96eb27ab1",
  measurementId: "G-EVC2QT1G8B"
};

const VAPID_KEY = "BOERy3pEFV_SFclhm94SqGB4vz7adtbKN4bzSix2xCiv3VOE5t2CcnxLHyBjaWJdsIaAS6GQs7RTr3uT9VewMZE";

const app = initializeApp(firebaseConfig);

let messaging: ReturnType<typeof getMessaging> | null = null;

try {
  if (typeof window !== "undefined" && "Notification" in window) {
    messaging = getMessaging(app);
  }
} catch {
  // FCM not supported
}

// Wait for service worker to be ready
async function waitForServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;

  // Check if already registered
  let reg = await navigator.serviceWorker.getRegistration("/");
  if (reg) return reg;

  // Try to register
  try {
    reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
    return reg;
  } catch {
    try {
      reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      return reg;
    } catch {
      return null;
    }
  }
}

// Get FCM token for this device
export async function getFCMToken(): Promise<string | null> {
  if (!messaging) return null;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("Notification permission denied");
      return null;
    }

    // Wait for service worker to be fully ready
    const swReg = await waitForServiceWorker();
    if (swReg) {
      // Make sure it's activated
      if (swReg.installing) {
        await new Promise<void>((resolve) => {
          swReg.installing!.addEventListener("statechange", (e) => {
            if ((e.target as ServiceWorker).state === "activated") resolve();
          });
        });
      }
    }

    const tokenOptions: any = { vapidKey: VAPID_KEY };
    if (swReg) {
      tokenOptions.serviceWorkerRegistration = swReg;
    }

    const token = await getToken(messaging, tokenOptions);
    console.log("FCM Token:", token ? "obtained" : "null");
    return token;
  } catch (err) {
    console.error("FCM token error:", err);
    return null;
  }
}

// Listen for foreground messages
export function onMessageListener(callback: (payload: any) => void) {
  if (!messaging) return () => {};

  return onMessage(messaging, (payload) => {
    console.log("Foreground message:", payload);
    callback(payload);
  });
}

export { app, messaging };
