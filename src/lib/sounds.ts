// Sound effects for notifications using Web Audio API
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext || audioContext.state === "closed") {
    audioContext = new AudioContext();
  }
  // Resume if suspended (mobile Chrome autoplay policy)
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
  return audioContext;
}

function playTone(frequency: number, duration: number, type: OscillatorType = "sine", volume: number = 0.3) {
  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = type;

    gainNode.gain.setValueAtTime(volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  } catch {
    // Audio not supported
  }
}

export function playMessageSound() {
  // WhatsApp-like message sound (two short beeps)
  playTone(800, 0.1, "sine", 0.2);
  setTimeout(() => playTone(1000, 0.15, "sine", 0.2), 100);
}

export function playCallSound() {
  // Phone ringing sound (repeating pattern)
  let count = 0;
  // Ensure AudioContext is ready before playing
  const ctx = getAudioContext();
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
  const interval = setInterval(() => {
    if (count >= 30) { // Ring for 30 seconds max
      clearInterval(interval);
      return;
    }
    playTone(440, 0.3, "sine", 0.3);
    setTimeout(() => playTone(480, 0.3, "sine", 0.3), 300);
    count++;
  }, 1000);
  return () => clearInterval(interval);
}

export function playEndCallSound() {
  // Call ended sound
  playTone(600, 0.15, "sine", 0.2);
  setTimeout(() => playTone(500, 0.15, "sine", 0.2), 150);
  setTimeout(() => playTone(400, 0.2, "sine", 0.2), 300);
}

// Show in-app notification banner (works on Android Chrome too)
function showInAppNotification(title: string, body: string) {
  // Remove existing banner if any
  const existing = document.getElementById("app-notif-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.id = "app-notif-banner";
  banner.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:99999;padding:14px 16px;padding-top:calc(14px + env(safe-area-inset-top,0px));background:linear-gradient(135deg,#059669,#10b981);color:white;display:flex;align-items:center;gap:12px;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,0.3);font-family:Inter,sans-serif;animation:slideDown 0.3s ease;`;
  banner.innerHTML = `
    <div style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
    </div>
    <div style="flex:1;min-width:0">
      <p style="font-size:14px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${title}</p>
      <p style="font-size:12px;margin:2px 0 0;opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${body}</p>
    </div>
    <span style="font-size:18px;opacity:0.7;flex-shrink:0">✕</span>
  `;
  banner.onclick = () => { window.focus(); banner.remove(); };
  document.body.appendChild(banner);
  // Auto remove after 6 seconds
  setTimeout(() => { if (banner.parentNode) banner.remove(); }, 6000);
  // Add slide animation
  if (!document.getElementById("notif-banner-style")) {
    const style = document.createElement("style");
    style.id = "notif-banner-style";
    style.textContent = `@keyframes slideDown{from{transform:translateY(-100%)}to{transform:translateY(0)}}`;
    document.head.appendChild(style);
  }
}

// Browser notification with sound - shows on screen on ALL devices
export function sendNotificationWithSound(title: string, body: string, options?: NotificationOptions) {
  // Play sound
  playMessageSound();

  // ALWAYS show in-app banner (works on Android Chrome)
  showInAppNotification(title, body);

  // Also try native notification (works on desktop)
  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      try {
        const notif = new Notification(title, {
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: options?.tag || "notification-" + Date.now(),
          requireInteraction: false,
          ...options,
        } as any);
        setTimeout(() => notif.close(), 5000);
        notif.onclick = () => { window.focus(); notif.close(); };
      } catch (err) {
        console.error("Native notification error:", err);
      }
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((p) => {
        if (p === "granted") sendNotificationWithSound(title, body, options);
      });
    }
  }
}

// Request notification permission - returns true if granted
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) {
    console.log("Notifications not supported");
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission === "denied") {
    console.log("Notifications denied by user");
    return false;
  }

  // Request permission
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

// Update document title with unread count
export function updateTitleBadge(count: number) {
  const baseTitle = "LaporanPintarID";
  if (count > 0) {
    document.title = `(${count}) ${baseTitle}`;
  } else {
    document.title = baseTitle;
  }
}

// Clear badge
export function clearTitleBadge() {
  document.title = "LaporanPintarID";
}
