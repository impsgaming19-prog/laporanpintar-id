import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, PhoneIncoming, PhoneMissed, Clock, Video, VideoOff, Mic, MicOff, Volume2, Maximize2, UserPlus, MoreHorizontal } from "lucide-react";
import { ConvexProvider, ConvexReactClient, useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { AuthProvider, useAuth, DataProvider, ThemeProvider, useTheme, useData } from "@/contexts/AppContext";
import { playCallSound, playEndCallSound, sendNotificationWithSound, playMessageSound } from "@/lib/sounds";
import { startRinging, stopRinging, startIncomingRing, stopIncomingRing } from "@/lib/callSounds";
import { getFCMToken, onMessageListener } from "@/lib/firebase";
import type { ViewMode, Transaction } from "@/lib/types";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import Navbar from "@/components/Navbar";
import SettingsPage from "@/pages/SettingsPage";
import BudgetPage from "@/pages/BudgetPage";
import SecurityPage from "@/pages/SecurityPage";
import ReportsPage from "@/pages/ReportsPage";
import TransactionForm from "@/components/TransactionForm";
import TransactionList from "@/components/TransactionList";
import ChatPage from "@/pages/ChatPage";
import GalleryPage from "@/pages/GalleryPage";
import OwnerPage from "@/pages/OwnerPage";

const convex = new ConvexReactClient("https://adamant-hedgehog-160.convex.cloud");

function AppContent() {
  const { isAuthenticated, user } = useAuth();
  const { theme } = useTheme();
  const [currentView, setCurrentView] = useState<ViewMode>("dashboard");
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  const isDark = theme === "dark";

  // Global call state
  const [incomingCall, setIncomingCall] = useState<{ callerId: string; signalId: any; offerData: any } | null>(null);
  const [globalCallState, setGlobalCallState] = useState<"idle" | "ringing" | "in-call">("idle");
  const [globalCallDuration, setGlobalCallDuration] = useState(0);
  const [globalCallerName, setGlobalCallerName] = useState("");
  const [isVideoCall, setIsVideoCall] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioMuted, setAudioMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioElRef = useRef<HTMLAudioElement>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  // Store partner info for BOTH caller and callee (so hangup works for both)
  const callPartnerRef = useRef<{ partnerId: string; partnerName: string } | null>(null);

  // Global notification listener - watches for new messages on ANY page
  const saveFCMToken = useMutation(api.fcm.saveToken);
  const upsertUser = useMutation(api.chat.upsertUser);
  const { profilePhoto } = useAuth();
  const newMessages = useQuery(
    api.chat.getNewMessages,
    user ? { userId: user.id } : "skip"
  );
  const processedMsgsRef = useRef<Set<string>>(new Set());

  // Sync profile photo + FCM token + message notification on ANY page
  useEffect(() => {
    if (!user) return;

    // Compress & sync profile photo to Convex (handles old uncompressed photos in localStorage)
    const syncProfile = async () => {
      try {
        let photo = profilePhoto || undefined;
        if (!photo) return;

        // Compress function with progressive quality reduction
        const compressPhoto = (dataUrl: string, size: number, quality: number): Promise<string> => {
          return new Promise((resolve) => {
            const img = new window.Image();
            img.onload = () => {
              const canvas = document.createElement("canvas");
              let w = img.width;
              let h = img.height;
              if (w > size || h > size) {
                if (w > h) { h = (h / w) * size; w = size; }
                else { w = (w / h) * size; h = size; }
              }
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext("2d");
              if (ctx) {
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL("image/jpeg", quality));
              } else {
                resolve(dataUrl);
              }
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
          });
        };

        // Try to compress if photo is large or doesn't look compressed
        if (photo.length > 30000) {
          // Progressive compression: try smaller sizes if still too big
          const attempts = [
            { size: 300, quality: 0.8 },
            { size: 200, quality: 0.6 },
            { size: 150, quality: 0.5 },
          ];
          for (const attempt of attempts) {
            const compressed = await compressPhoto(photo, attempt.size, attempt.quality);
            if (compressed.length < 200000) { // Under 200KB is safe for Convex
              photo = compressed;
              localStorage.setItem("profile_photo", compressed);
              break;
            }
            photo = compressed;
          }
          // Final size check
          if (photo.length > 500000) {
            // Still too large, do one final aggressive compression
            photo = await compressPhoto(photo, 100, 0.4);
            localStorage.setItem("profile_photo", photo);
          }
        }

        await upsertUser({
          userId: user.id,
          username: user.username,
          fullName: user.fullName,
          profilePhoto: photo,
        });
      } catch (err) {
        console.error("Profile sync error:", err);
      }
    };
    syncProfile();

    // Save FCM token + Capacitor native push token
    const setupFCM = async () => {
      try {
        // Web FCM token
        const token = await getFCMToken();
        if (token) await saveFCMToken({ userId: user.id, token });
      } catch (err) {
        console.error("FCM setup error:", err);
      }
      // Capacitor native push token (for APK)
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          // Request permission
          const perm = await PushNotifications.requestPermissions();
          if (perm.receive === "granted") {
            // Register for push
            await PushNotifications.register();
            // Listen for registration
            PushNotifications.addListener("registration", (token: any) => {
              console.log("[Capacitor] Push token:", token.value);
              saveFCMToken({ userId: user.id, token: token.value }).catch(() => {});
            });
            // Listen for push notification received
            PushNotifications.addListener("pushNotificationReceived", (notif: any) => {
              console.log("[Capacitor] Push received:", notif.title);
              sendNotificationWithSound(notif.title || "Pesan Baru", notif.body || "");
            });
            // Listen for push notification action
            PushNotifications.addListener("pushNotificationActionPerformed", (action: any) => {
              console.log("[Capacitor] Push action:", action.actionId);
            });
          }
        }
      } catch (err) {
        console.log("[Capacitor] Not running as native app:", err);
      }
    };
    setupFCM();

    // Listen for foreground FCM push notifications
    const unsub = onMessageListener((payload: any) => {
      console.log("[Global] Foreground push received:", payload);
      const title = payload?.notification?.title || "Pesan Baru";
      const body = payload?.notification?.body || "";
      playMessageSound();
      sendNotificationWithSound(title, body);
    });

    return () => { if (typeof unsub === "function") unsub(); };
  }, [user, saveFCMToken, upsertUser, profilePhoto]);

  // Global message notification - works on ANY page (Dashboard, Settings, etc.)
  useEffect(() => {
    if (!newMessages || !user) return;
    for (const msg of newMessages) {
      if (msg.senderId === user.id) continue; // Skip own messages
      if (processedMsgsRef.current.has(msg._id)) continue;
      processedMsgsRef.current.add(msg._id);
      // Play sound + show notification for new message
      playMessageSound();
      sendNotificationWithSound(`Pesan dari ${msg.senderName}`, msg.text || "📷 Foto", { tag: String(msg._id) });
    }
  }, [newMessages, user]);

  const incomingSignals = useQuery(
    api.callSignals.getSignals,
    user ? { userId: user.id } : "skip"
  );
  const hangUpMut = useMutation(api.callSignals.hangUp);
  const rejectCallMut = useMutation(api.callSignals.rejectCall);
  const sendSignalMut = useMutation(api.callSignals.sendSignal);
  const deleteSignalMut = useMutation(api.callSignals.deleteSignal);
  const sendCallEventMut = useMutation(api.chat.sendCallEvent);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const processedSignalsRef = useRef<Set<string>>(new Set());
  const callActiveRef = useRef(false);
  const callEventSentRef = useRef(false);

  const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };

  // Check for incoming calls globally
  useEffect(() => {
    if (!user || !incomingSignals) return;
    for (const sig of incomingSignals) {
      if (processedSignalsRef.current.has(sig._id)) continue;

      if (sig.type === "offer" && sig.calleeId === user.id && !incomingCall) {
        processedSignalsRef.current.add(sig._id);

        // Play incoming ringtone
        stopCallSoundRef.current = playCallSound();
        startIncomingRing();

        // Send browser notification with sound
        sendNotificationWithSound(
          "📞 Panggilan Masuk",
          "Ada yang menelepon Anda!",
          { tag: "incoming-call" }
        );

        setIncomingCall({ callerId: sig.callerId, signalId: sig._id, offerData: sig.data });
      } else if (sig.type === "reject" && sig.calleeId === user.id) {
        processedSignalsRef.current.add(sig._id);
        endGlobalCall();
        playEndCallSound();
        stopIncomingRing();
        stopRinging();
      } else if (sig.type === "answer" && sig.calleeId === user.id && pcRef.current) {
        processedSignalsRef.current.add(sig._id);
        // Stop ALL sounds immediately when call is answered
        stopRinging();
        stopIncomingRing();
        if (stopCallSoundRef.current) {
          stopCallSoundRef.current();
          stopCallSoundRef.current = null;
        }
        pcRef.current.setRemoteDescription(new RTCSessionDescription(sig.data)).then(() => {
          setGlobalCallState("in-call");
          setGlobalCallDuration(0);
          timerRef.current = setInterval(() => setGlobalCallDuration((p) => p + 1), 1000);
        });
        deleteSignalMut({ signalId: sig._id });
      } else if (sig.type === "candidate" && sig.calleeId === user.id && pcRef.current) {
        if (sig.data) pcRef.current.addIceCandidate(new RTCIceCandidate(sig.data)).catch(() => {});
        deleteSignalMut({ signalId: sig._id });
      } else if (sig.type === "hangup") {
        processedSignalsRef.current.add(sig._id);
        endGlobalCall();
        playEndCallSound();
        stopIncomingRing();
        stopRinging();
      }
    }
  }, [incomingSignals, user]);

  // Store cleanup function for call sound
  const stopCallSoundRef = useRef<(() => void) | null>(null);

  const endGlobalCall = useCallback(() => {
    // Stop all sounds
    if (stopCallSoundRef.current) {
      stopCallSoundRef.current();
      stopCallSoundRef.current = null;
    }
    stopIncomingRing();
    stopRinging();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current = null;
    pcRef.current = null;
    timerRef.current = null;
    callActiveRef.current = false;
    setIncomingCall(null);
    setGlobalCallState("idle");
    setGlobalCallDuration(0);
    setGlobalCallerName("");
    setIsVideoCall(false);
    setVideoEnabled(true);
    setAudioMuted(false);
    setIsSpeakerOn(false);
    remoteStreamRef.current = null;
    callPartnerRef.current = null;
  }, []);

  // Hang up — works for BOTH caller and callee
  const hangUpCall = useCallback(async () => {
    const partner = callPartnerRef.current;
    if (callEventSentRef.current) return; // Prevent duplicate events
    if (!user || !partner) { endGlobalCall(); return; }
    callEventSentRef.current = true;
    const status = globalCallState === "in-call" ? "answered" : "missed";
    try {
      await hangUpMut({
        callerId: user.id,
        callerName: user.fullName,
        calleeId: partner.partnerId,
        calleeName: partner.partnerName,
        duration: globalCallDuration,
        status,
      });
    } catch {}
    // Send call event to chat (only caller sends)
    try {
      await sendCallEventMut({
        senderId: user.id,
        senderName: user.fullName,
        receiverId: partner.partnerId,
        callType: isVideoCall ? "video" : "voice",
        status,
        duration: globalCallDuration,
      });
    } catch {}
    playEndCallSound();
    endGlobalCall();
  }, [user, globalCallDuration, globalCallState, isVideoCall, hangUpMut, endGlobalCall, sendCallEventMut]);

  // Reject call (tolak)
  const rejectGlobalCall = useCallback(async () => {
    if (!user || !incomingCall || callEventSentRef.current) return;
    callEventSentRef.current = true;
    try {
      await rejectCallMut({
        callerId: incomingCall.callerId,
        calleeId: user.id,
        callerName: undefined,
        calleeName: user.fullName,
      });
    } catch {}
    // Send call event to chat (from caller's perspective)
    try {
      await sendCallEventMut({
        senderId: incomingCall.callerId,
        senderName: "",
        receiverId: user.id,
        callType: isVideoCall ? "video" : "voice",
        status: "rejected",
        duration: 0,
      });
    } catch {}
    playEndCallSound();
    stopIncomingRing();
    endGlobalCall();
  }, [user, incomingCall, isVideoCall, rejectCallMut, endGlobalCall, sendCallEventMut]);

  // Accept call (angkat) - STOP ALL SOUNDS IMMEDIATELY
  const acceptGlobalCall = useCallback(async () => {
    if (!user || !incomingCall) return;
    // Stop ALL sounds immediately when accepting
    stopIncomingRing();
    stopRinging();
    if (stopCallSoundRef.current) {
      stopCallSoundRef.current();
      stopCallSoundRef.current = null;
    }
    const partnerId = incomingCall.callerId;
    callPartnerRef.current = { partnerId, partnerName: "Pengguna" };
    setGlobalCallState("in-call");
    // Detect if caller sent video tracks (check sdp for m=video line)
    const offerHasVideo = incomingCall.offerData?.sdp?.includes("m=video ") ?? false;
    if (offerHasVideo) setIsVideoCall(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: offerHasVideo });
      streamRef.current = stream;
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcRef.current = pc;
      callActiveRef.current = true;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (e) => {
        console.log("[Call] ontrack received:", e.streams[0]?.getTracks().map(t => t.kind));
        remoteStreamRef.current = e.streams[0];
        if (remoteAudioElRef.current && e.streams[0]) {
          remoteAudioElRef.current.srcObject = e.streams[0];
          remoteAudioElRef.current.play().catch(() => {});
        }
        if (remoteVideoRef.current && e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0];
        }
      };
      if (offerHasVideo && localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      pc.onicecandidate = async (e) => {
        if (e.candidate && callActiveRef.current) {
          try {
            await sendSignalMut({
              callerId: user.id,
              calleeId: partnerId,
              type: "candidate",
              data: e.candidate.toJSON(),
            });
          } catch {}
        }
      };
      // Handle peer disconnect
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
          hangUpCall();
        }
      };

      if (incomingCall.offerData) {
        await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offerData));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignalMut({
          callerId: user.id,
          calleeId: partnerId,
          type: "answer",
          data: answer,
        });
        deleteSignalMut({ signalId: incomingCall.signalId });
        setGlobalCallDuration(0);
        timerRef.current = setInterval(() => setGlobalCallDuration((p) => p + 1), 1000);
        // Mirror local video if video call
        if (offerHasVideo && localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } else {
        endGlobalCall();
      }
    } catch (err) {
      console.error("Accept call failed:", err);
      endGlobalCall();
    }
  }, [user, incomingCall, deleteSignalMut, sendSignalMut, endGlobalCall, hangUpCall]);

  useEffect(() => {
    return () => endGlobalCall();
  }, []);

  // Sync ALL remote media when refs mount (elements render AFTER ontrack fires)
  useEffect(() => {
    if (remoteStreamRef.current) {
      // Sync remote audio
      if (remoteAudioElRef.current && !remoteAudioElRef.current.srcObject) {
        remoteAudioElRef.current.srcObject = remoteStreamRef.current;
      }
      // Sync remote video
      if (remoteVideoRef.current && !remoteVideoRef.current.srcObject) {
        remoteVideoRef.current.srcObject = remoteStreamRef.current;
      }
    }
    // Sync local video
    if (streamRef.current && localVideoRef.current && !localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject = streamRef.current;
    }
  });



  // Listen for global startCall event from ChatPage (audio only)
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!user || !detail?.partnerId) return;
      if (callActiveRef.current) return;
      setGlobalCallerName(user.fullName);
      callPartnerRef.current = { partnerId: detail.partnerId, partnerName: detail.partnerName || "Pengguna" };
      callEventSentRef.current = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;
        callActiveRef.current = true;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        pc.ontrack = (ev) => {
          console.log("[Call] ontrack received:", ev.streams[0]?.getTracks().map(t => t.kind));
          remoteStreamRef.current = ev.streams[0];
          // Directly set audio element if already mounted
          if (remoteAudioElRef.current && ev.streams[0]) {
            remoteAudioElRef.current.srcObject = ev.streams[0];
            remoteAudioElRef.current.play().catch(() => {});
          }
        };
        pc.onicecandidate = async (ev) => {
          if (ev.candidate && callActiveRef.current) {
            try {
              await sendSignalMut({
                callerId: user.id,
                calleeId: detail.partnerId,
                type: "candidate",
                data: ev.candidate.toJSON(),
              });
            } catch {}
          }
        };
        // Handle peer disconnect
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
            hangUpCall();
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignalMut({
          callerId: user.id,
          calleeId: detail.partnerId,
          type: "offer",
          data: offer,
        });
        setGlobalCallState("ringing");
        startRinging();
      } catch {
        endGlobalCall();
      }
    };
    window.addEventListener("globalStartCall", handler);
    return () => window.removeEventListener("globalStartCall", handler);
  }, [user]);

  // Listen for global startVideoCall event from ChatPage (video + audio)
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!user || !detail?.partnerId) return;
      if (callActiveRef.current) return;
      setIsVideoCall(true);
      setGlobalCallerName(user.fullName);
      callPartnerRef.current = { partnerId: detail.partnerId, partnerName: detail.partnerName || "Pengguna" };
      callEventSentRef.current = false;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        streamRef.current = stream;
        const pc = new RTCPeerConnection(ICE_SERVERS);
        pcRef.current = pc;
        callActiveRef.current = true;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        // Set local video preview
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
        pc.ontrack = (ev) => {
          remoteStreamRef.current = ev.streams[0];
          // useEffect will sync to actual elements
        };
        pc.onicecandidate = async (ev) => {
          if (ev.candidate && callActiveRef.current) {
            try {
              await sendSignalMut({
                callerId: user.id,
                calleeId: detail.partnerId,
                type: "candidate",
                data: ev.candidate.toJSON(),
              });
            } catch {}
          }
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "disconnected" || pc.connectionState === "failed" || pc.connectionState === "closed") {
            hangUpCall();
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignalMut({
          callerId: user.id,
          calleeId: detail.partnerId,
          type: "offer",
          data: offer,
        });
        setGlobalCallState("ringing");
        startRinging();
      } catch {
        endGlobalCall();
      }
    };
    window.addEventListener("globalStartVideoCall", handler);
    return () => window.removeEventListener("globalStartVideoCall", handler);
  }, [user]);

  useEffect(() => {
    document.body.className = isDark ? "theme-dark" : "theme-light";
  }, [isDark]);

  if (!isAuthenticated) return <LoginPage />;

  return (
    <DataProvider>
      <div className={`min-h-screen transition-colors duration-300 ${isDark ? "bg-zinc-950" : "bg-zinc-100"}`}>
        <Navbar currentView={currentView} onNavigate={(v) => { setEditingTx(null); setCurrentView(v); }} />
        <main className="pb-6">
          {currentView === "dashboard" && <DashboardPage currentView={currentView} onNavigate={setCurrentView} />}
          {currentView === "add" && <TransactionForm editingTx={editingTx} onCancel={() => { setEditingTx(null); setCurrentView("transactions"); }} />}
          {currentView === "transactions" && <TransactionList onEdit={(tx) => { setEditingTx(tx); setCurrentView("add"); }} onAdd={() => { setEditingTx(null); setCurrentView("add"); }} />}
          {currentView === "reports" && <ReportsPage />}
          {currentView === "budget" && <BudgetPage />}
          {currentView === "security" && <SecurityPage />}
          {currentView === "settings" && <SettingsPage />}
          {currentView === "notifications" && <NotifikasiPage />}
          {currentView === "chat" && <ChatPage />}
          {currentView === "gallery" && <GalleryPage />}
          {currentView === "owner" && <OwnerPage />}
        </main>

        {/* Global Call Overlay — incoming or outgoing */}
        <AnimatePresence>
          {(incomingCall || globalCallState !== "idle") && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex flex-col bg-zinc-950">
              <audio ref={remoteAudioElRef} autoPlay />

              {/* VIDEO MODE */}
              {isVideoCall && globalCallState === "in-call" ? (
                <>
                  {/* Remote video fills screen */}
                  <div className="flex-1 relative bg-black flex items-center justify-center">
                    <video ref={remoteVideoRef} autoPlay playsInline
                      className="w-full h-full object-cover" />
                    {/* Local video PIP */}
                    <div className="absolute top-4 right-4 w-[100px] h-[140px] rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl z-10">
                      <video ref={localVideoRef} autoPlay playsInline muted
                        className="w-full h-full object-cover scale-x-[-1]" />
                    </div>
                    {/* Call info overlay */}
                    <div className="absolute top-4 left-4 z-10">
                      <p className="text-white text-[18px] font-bold drop-shadow-lg">
                        {incomingCall ? (globalCallerName || "Pengguna Lain") : callPartnerRef.current?.partnerName || "Memanggil..."}
                      </p>
                      <p className="text-emerald-400 text-[13px]">
                        📹 Video • {Math.floor(globalCallDuration / 60)}:{(globalCallDuration % 60).toString().padStart(2, "0")}
                      </p>
                    </div>
                    {/* Controls */}
                    <div className="absolute bottom-0 left-0 right-0 p-8 flex items-center justify-center gap-6 z-10">
                      <button onClick={() => {
                        setAudioMuted((p) => {
                          const next = !p;
                          streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
                          return next;
                        });
                      }} className={`w-14 h-14 rounded-full flex items-center justify-center cursor-pointer ${audioMuted ? "bg-white/20" : "bg-white/10"}`}>
                        {audioMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
                      </button>
                      <button onClick={hangUpCall}
                        className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/30 cursor-pointer">
                        <PhoneOff className="w-7 h-7 text-white" />
                      </button>
                      <button onClick={() => {
                        setVideoEnabled((p) => {
                          const next = !p;
                          streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next; });
                          return next;
                        });
                      }} className={`w-14 h-14 rounded-full flex items-center justify-center cursor-pointer ${!videoEnabled ? "bg-white/20" : "bg-white/10"}`}>
                        {videoEnabled ? <Video className="w-6 h-6 text-white" /> : <VideoOff className="w-6 h-6 text-white" />}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
              /* AUDIO / RINGING MODE */
              <>
                {/* Top bar */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <button onClick={() => { /* Minimize call overlay - no-op for now */ }} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center cursor-pointer">
                    <Maximize2 className="w-5 h-5 text-white" />
                  </button>
                  <div className="text-center">
                    <p className="text-white text-[16px] font-bold">{incomingCall ? (globalCallerName || "Pengguna Lain") : callPartnerRef.current?.partnerName || "Memanggil..."}</p>
                    <p className="text-white/60 text-[11px]">Terenkripsi secara end-to-end</p>
                  </div>
                  <button onClick={() => { if (navigator.share) { navigator.share({ title: 'Panggilan', text: `Sedang nelpon ${callPartnerRef.current?.partnerName || ''}` }).catch(() => {}); } }} className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center cursor-pointer">
                    <UserPlus className="w-5 h-5 text-white" />
                  </button>
                </div>

                {/* Center avatar + status */}
                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="w-28 h-28 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mb-4 ring-4 ring-white/10">
                    {isVideoCall ? <Video className="w-12 h-12 text-white" /> : <Phone className="w-12 h-12 text-white" />}
                  </div>
                  <p className="text-white/50 text-[12px] mt-1">
                    {incomingCall && globalCallState === "idle" && (isVideoCall ? "📹 Video Masuk" : "📞 Panggilan Masuk")}
                    {globalCallState === "ringing" && "📡 Menunggu dijawab..."}
                    {globalCallState === "in-call" && `${Math.floor(globalCallDuration / 60)}:${(globalCallDuration % 60).toString().padStart(2, "0")}`}
                  </p>
                </div>

                {/* Incoming call: accept/reject buttons */}
                {incomingCall && globalCallState === "idle" && (
                  <div className="px-8 pb-12">
                    <div className="flex items-center justify-center gap-16">
                      <div className="flex flex-col items-center gap-2">
                        <button onClick={rejectGlobalCall}
                          className="w-16 h-16 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/30 cursor-pointer">
                          <PhoneOff className="w-7 h-7 text-white" />
                        </button>
                        <span className="text-[11px] text-white/50">Tolak</span>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <button onClick={acceptGlobalCall}
                          className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/30 animate-pulse cursor-pointer">
                          {isVideoCall ? <Video className="w-7 h-7 text-white" /> : <Phone className="w-7 h-7 text-white" />}
                        </button>
                        <span className="text-[11px] text-emerald-400">Angkat</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Active call controls - WhatsApp style 2x3 grid */}
                {(globalCallState === "ringing" || globalCallState === "in-call") && (
                  <div className="px-6 pb-12">
                    <div className="rounded-3xl bg-white/[0.06] backdrop-blur-xl p-6">
                      <div className="grid grid-cols-3 gap-6">
                        {/* Row 1 */}
                        <button onClick={() => {
                          setIsSpeakerOn(p => {
                            const next = !p;
                            if (remoteAudioElRef.current) {
                              remoteAudioElRef.current.volume = next ? 1.0 : 0.3;
                              try { (remoteAudioElRef.current as any).setSinkId?.(''); } catch {}
                            }
                            return next;
                          });
                        }} className="flex flex-col items-center gap-2 cursor-pointer">
                          <div className={`w-14 h-14 rounded-full flex items-center justify-center ${isSpeakerOn ? "bg-white/20" : "bg-white/10"}`}>
                            <Volume2 className="w-6 h-6 text-white" />
                          </div>
                          <span className="text-[11px] text-white/60">Speaker</span>
                        </button>
                        {isVideoCall && (
                          <button onClick={() => {
                            setVideoEnabled(p => {
                              const next = !p;
                              streamRef.current?.getVideoTracks().forEach(t => { t.enabled = next; });
                              return next;
                            });
                          }} className="flex flex-col items-center gap-2 cursor-pointer">
                            <div className={`w-14 h-14 rounded-full flex items-center justify-center ${!videoEnabled ? "bg-white/20" : "bg-white/10"}`}>
                              {videoEnabled ? <Video className="w-6 h-6 text-white" /> : <VideoOff className="w-6 h-6 text-white" />}
                            </div>
                            <span className="text-[11px] text-white/60">Video</span>
                          </button>
                        )}
                        {!isVideoCall && <div />}
                        <button onClick={() => {
                          setAudioMuted(p => {
                            const next = !p;
                            streamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
                            return next;
                          });
                        }} className="flex flex-col items-center gap-2 cursor-pointer">
                          <div className={`w-14 h-14 rounded-full flex items-center justify-center ${audioMuted ? "bg-white/20" : "bg-white/10"}`}>
                            {audioMuted ? <MicOff className="w-6 h-6 text-white" /> : <Mic className="w-6 h-6 text-white" />}
                          </div>
                          <span className="text-[11px] text-white/60">{audioMuted ? "Bunyikan" : "Bisukan"}</span>
                        </button>

                        {/* Row 2 */}
                        <button onClick={() => {
                          // Toggle speaker loud mode
                          if (remoteAudioElRef.current) {
                            const newVol = remoteAudioElRef.current.volume > 0.5 ? 0.3 : 1.0;
                            remoteAudioElRef.current.volume = newVol;
                            setIsSpeakerOn(newVol > 0.5);
                          }
                        }} className="flex flex-col items-center gap-2 cursor-pointer">
                          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                            <MoreHorizontal className="w-6 h-6 text-white" />
                          </div>
                          <span className="text-[11px] text-white/60">Lainnya</span>
                        </button>
                        <button onClick={() => {
                          if (navigator.share) {
                            navigator.share({ title: 'Panggilan', text: `Sedang nelpon ${callPartnerRef.current?.partnerName || ''}` }).catch(() => {});
                          }
                        }} className="flex flex-col items-center gap-2 cursor-pointer">
                          <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center">
                            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                          </div>
                          <span className="text-[11px] text-white/60">Bagikan</span>
                        </button>
                        <div className="flex flex-col items-center gap-2">
                          <button onClick={hangUpCall}
                            className="w-16 h-16 -mt-1 rounded-full bg-red-500 flex items-center justify-center shadow-lg shadow-red-500/30 cursor-pointer">
                            <PhoneOff className="w-7 h-7 text-white" />
                          </button>
                          <span className="text-[11px] text-white/60">Akhiri</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </DataProvider>
  );
}

function NotifikasiPage() {
  const { theme } = useTheme();
  const { notifications, unreadCount, markAllRead } = useData();
  const isDark = theme === "dark";
  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";
  const textMuted = isDark ? "text-zinc-500" : "text-zinc-400";

  const colorMap: Record<string, string> = {
    emerald: "bg-emerald-500",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
    red: "bg-red-500",
    slate: "bg-slate-500",
  };

  return (
    <div className="max-w-lg mx-auto px-5 pt-5 pb-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-[22px] font-bold tracking-tight ${textPrimary}`}>Notifikasi</h1>
          <p className={`text-[13px] mt-0.5 ${textSecondary}`}>
            {notifications.length > 0 ? `${notifications.length} notifikasi, ${unreadCount} belum dibaca` : "Belum ada notifikasi"}
          </p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead}
            className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-500 text-[12px] font-semibold cursor-pointer hover:bg-emerald-500/20 transition-colors">
            Tandai Semua Dibaca
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className={`rounded-2xl border p-8 text-center ${card}`}>
          <div className="text-4xl mb-3">🔔</div>
          <p className={`text-[14px] font-medium ${textPrimary}`}>Belum ada notifikasi</p>
          <p className={`text-[13px] mt-1 ${textSecondary}`}>Notifikasi akan muncul saat ada transaksi baru, budget hampir habis, atau target tercapai.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div key={n.id} className={`rounded-2xl border p-4 transition-all ${card} ${!n.read ? (isDark ? "border-emerald-500/20 bg-emerald-500/[0.03]" : "border-emerald-200 bg-emerald-50/50") : ""}`}>
              <div className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${colorMap[n.color] || "bg-slate-500"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-semibold ${textPrimary}`}>{n.title}</p>
                  <p className={`text-[13px] mt-0.5 ${textSecondary}`}>{n.desc}</p>
                  <p className={`text-[11px] mt-1 ${textMuted}`}>{n.time}</p>
                </div>
                {!n.read && (
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 flex-shrink-0 mt-2" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AppInner() {
  return (
    <ConvexProvider client={convex}>
      <AppContent />
    </ConvexProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </ThemeProvider>
  );
}
