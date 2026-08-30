import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Unlock AudioContext on first user interaction (mobile Chrome autoplay policy)
const unlockAudio = () => {
  try {
    const ctx = new AudioContext();
    if (ctx.state === "suspended") ctx.resume();
    ctx.close();
  } catch {}
  document.removeEventListener("touchstart", unlockAudio);
  document.removeEventListener("click", unlockAudio);
};
document.addEventListener("touchstart", unlockAudio, { once: true });
document.addEventListener("click", unlockAudio, { once: true });

// Register Firebase Cloud Messaging service worker (single registration)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
      console.log("FCM SW registered:", reg.scope);
    } catch (e) {
      console.log("FCM SW registration failed:", e);
    }
  });
}
