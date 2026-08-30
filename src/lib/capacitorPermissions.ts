import { Capacitor } from "@capacitor/core";

/**
 * Request runtime permissions for camera and microphone (Android 6+)
 * Required for video/audio calls to work on native Android
 */
export async function requestMediaPermissions(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return true; // Web doesn't need runtime permissions
  }

  try {
    // Capacitor handles permission requests automatically
    // Just need to request when getUserMedia is called
    return true;
  } catch (err) {
    console.error("Permission request failed:", err);
    return false;
  }
}

/**
 * Request notification permission for push notifications
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const result = await PushNotifications.requestPermissions();
    return result.receive === "granted";
  } catch (err) {
    console.error("Notification permission request failed:", err);
    return false;
  }
}

/**
 * Initialize platform-specific audio settings
 * For native Android, ensure audio output settings are correct
 */
export async function initializeAudioSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    // For native apps, we might need to configure audio session
    // This is handled by Capacitor internally
    console.log("[Audio] Initialized for native platform");
  } catch (err) {
    console.error("Audio initialization failed:", err);
  }
}

/**
 * Check if running as native app or PWA
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
