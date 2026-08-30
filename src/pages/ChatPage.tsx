import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Send, ArrowLeft, MessageCircle, UserPlus, X, ImagePlus, Trash2, MoreVertical, Phone, PhoneIncoming, PhoneMissed, PhoneOff, Clock, Mic, MicOff, Play, Pause, Video, Timer, Bomb, Check, PhoneOutgoing, Camera,
} from "lucide-react";
import { useAuth, useTheme, useData } from "@/contexts/AppContext";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { playMessageSound, sendNotificationWithSound, updateTitleBadge } from "@/lib/sounds";

type ChatView = "inbox" | "search" | "conversation" | "callhistory";

export default function ChatPage() {
  const { user, profilePhoto } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [view, setView] = useState<ChatView>("inbox");
  const [searchQuery, setSearchQuery] = useState("");
  const [activePartner, setActivePartner] = useState<{ userId: string; fullName: string; username?: string } | null>(null);
  const [messageText, setMessageText] = useState("");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ msgId: string; isMine: boolean; x: number; y: number } | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "default"
  );
  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playingMsgId, setPlayingMsgId] = useState<string | null>(null);
  const [playProgress, setPlayProgress] = useState(0);
  const [msgTimer, setMsgTimer] = useState<number>(0);
  const [showTimerPicker, setShowTimerPicker] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const callHistory = useQuery(
    api.callSignals.getCallHistory,
    user ? { userId: user.id } : "skip"
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(0);

  const upsertUser = useMutation(api.chat.upsertUser);
  const heartbeat = useMutation(api.chat.heartbeat);
  const sendMessage = useMutation(api.chat.sendMessage);
  const markAsRead = useMutation(api.chat.markAsRead);
  const deleteMessageMut = useMutation(api.chat.deleteMessage);
  const clearChatMut = useMutation(api.chat.clearChat);
  const clearCallHistoryMut = useMutation(api.callSignals.clearCallHistory);
  const deleteCallEntryMut = useMutation(api.callSignals.deleteCallEntry);

  const sendPushNotif = useAction(api.fcmActions.sendPushNotification);



  useEffect(() => {
    if (user && profilePhoto) {
      upsertUser({ userId: user.id, username: user.username, fullName: user.fullName, profilePhoto });
    }
  }, [profilePhoto, user, upsertUser]);

  const conversations = useQuery(api.chat.getConversations, user ? { userId: user.id } : "skip");
  const searchResults = useQuery(api.chat.searchUsers, searchQuery.length >= 1 && user ? { query: searchQuery, currentUserId: user.id } : "skip");
  const messages = useQuery(api.chat.getMessages, user && activePartner ? { user1Id: user.id, user2Id: activePartner.userId } : "skip");
  const partnerStatus = useQuery(api.chat.getUserStatus, activePartner ? { userId: activePartner.userId } : "skip");

  useEffect(() => {
    if (user) {
      upsertUser({ userId: user.id, username: user.username, fullName: user.fullName, profilePhoto: profilePhoto || undefined });
      const interval = setInterval(() => { heartbeat({ userId: user.id }); }, 30000);
      return () => clearInterval(interval);
    }
  }, [user, upsertUser, heartbeat]);



  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === "answer-call") {
        window.dispatchEvent(new CustomEvent("globalStartCall", { detail: { partnerId: event.data.callerId, partnerName: "Pengguna" } }));
      } else if (event.data.type === "open-chat") {
        const partner = conversations?.find(c => c.partner.userId === event.data.partnerId);
        if (partner) openConversation(partner.partner);
      }
    };
    navigator.serviceWorker?.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", handleMessage);
  }, [conversations]);

  const requestNotificationPermission = async () => {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") {
        playMessageSound();
        const notif = new Notification("Notifikasi Aktif! 🔔", { body: "Notifikasi chat sudah aktif.", icon: "/favicon.svg", requireInteraction: false });
        setTimeout(() => notif.close(), 3000);
      }
    }
  };



  useEffect(() => {
    if (!messages || !user || !activePartner) return;
    if (messages.length > prevMessageCount.current && prevMessageCount.current > 0) {
      const newMsgs = messages.slice(prevMessageCount.current);
      for (const msg of newMsgs) {
        if (msg.senderId !== user.id) {
          playMessageSound();
          sendNotificationWithSound(`Pesan dari ${activePartner.fullName}`, msg.text || "📷 Foto", { tag: String(msg._id) });
        }
      }
    }
    prevMessageCount.current = messages.length;
  }, [messages, user, activePartner]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  useEffect(() => {
    if (user && activePartner) markAsRead({ senderId: activePartner.userId, receiverId: user.id });
  }, [user, activePartner, markAsRead]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 1024;
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) { if (w > h) { h = (h / w) * maxSize; w = maxSize; } else { w = (w / h) * maxSize; h = maxSize; } }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) { ctx.drawImage(img, 0, 0, w, h); setPendingImage(canvas.toDataURL("image/jpeg", 0.92)); }
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const sendingRef = useRef(false);
  const handleSend = async () => {
    if (!user || !activePartner) return;
    if (!messageText.trim() && !pendingImage) return;
    if (sendingRef.current) return;
    sendingRef.current = true;
    const text = messageText.trim() || (pendingImage ? "📷 Foto" : "");
    const img = pendingImage;
    setMessageText(""); setPendingImage(null);
    try {
      await sendMessage({ senderId: user.id, senderName: user.fullName, receiverId: activePartner.userId, text, image: img || undefined, timer: msgTimer > 0 ? msgTimer : undefined });
      try { await sendPushNotif({ recipientId: activePartner.userId, title: user.fullName, body: text.substring(0, 100), senderId: user.id, senderName: user.fullName }); } catch {}
    } finally { sendingRef.current = false; }
  };

  const handleDeleteMessage = async (msgId: string) => { setContextMenu(null); try { await deleteMessageMut({ messageId: msgId as any }); } catch {} };
  const handleClearChat = async () => { if (!user || !activePartner) return; setShowClearConfirm(false); try { await clearChatMut({ user1Id: user.id, user2Id: activePartner.userId }); } catch {} };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => { setAudioBlob(reader.result as string); setAudioDuration(recordTime); };
        reader.readAsDataURL(blob); stream.getTracks().forEach((t) => t.stop());
      };
      recorderRef.current = recorder; recorder.start(100); setIsRecording(true); setRecordTime(0);
      recordTimerRef.current = setInterval(() => setRecordTime((p) => p + 1), 1000);
    } catch { alert("Tidak bisa mengakses mikrofon."); }
  };
  const stopRecording = () => { recorderRef.current?.stop(); if (recordTimerRef.current) clearInterval(recordTimerRef.current); setIsRecording(false); };
  const cancelRecording = () => { recorderRef.current?.stop(); if (recordTimerRef.current) clearInterval(recordTimerRef.current); setIsRecording(false); setAudioBlob(null); setAudioDuration(0); setRecordTime(0); };

  const sendingVoiceRef = useRef(false);
  const sendVoiceMessage = async () => {
    if (!user || !activePartner || !audioBlob) return;
    if (sendingVoiceRef.current) return;
    sendingVoiceRef.current = true;
    const blob = audioBlob; const dur = audioDuration;
    setAudioBlob(null); setAudioDuration(0); setRecordTime(0);
    try {
      await sendMessage({ senderId: user.id, senderName: user.fullName, receiverId: activePartner.userId, text: "🎤 Pesan Suara", audio: blob, audioDuration: dur });
      try { await sendPushNotif({ recipientId: activePartner.userId, title: user.fullName, body: "🎤 Pesan Suara", senderId: user.id, senderName: user.fullName }); } catch {}
    } catch {} finally { sendingVoiceRef.current = false; }
  };

  const togglePlayAudio = (msgId: string, audioData: string) => {
    if (playingMsgId === msgId && audioRef.current) { audioRef.current.pause(); setPlayingMsgId(null); setPlayProgress(0); return; }
    if (audioRef.current) audioRef.current.pause();
    const audio = new Audio(audioData); audioRef.current = audio; setPlayingMsgId(msgId); setPlayProgress(0);
    audio.ontimeupdate = () => { if (audio.duration) setPlayProgress((audio.currentTime / audio.duration) * 100); };
    audio.onended = () => { setPlayingMsgId(null); setPlayProgress(0); };
    audio.play().catch(() => { setPlayingMsgId(null); setPlayProgress(0); });
  };

  const startCall = (isVideo = false) => {
    if (!user || !activePartner) return;
    window.dispatchEvent(new CustomEvent(isVideo ? "globalStartVideoCall" : "globalStartCall", { detail: { partnerId: activePartner.userId, partnerName: activePartner.fullName } }));
  };

  const handleContextMenu = (e: React.MouseEvent, msgId: string, isMine: boolean) => { e.preventDefault(); setContextMenu({ msgId, isMine, x: e.clientX, y: e.clientY }); };
  const openConversation = (partner: { userId: string; fullName: string; username?: string }) => { setActivePartner(partner); setView("conversation"); setSearchQuery(""); };

  const totalUnread = useMemo(() => conversations ? conversations.reduce((sum, c) => sum + c.unreadCount, 0) : 0, [conversations]);
  useEffect(() => { updateTitleBadge(totalUnread); return () => updateTitleBadge(0); }, [totalUnread]);

  const formatRecTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";
  const textMuted = isDark ? "text-zinc-500" : "text-zinc-400";
  const inputCls = isDark ? "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-zinc-500" : "bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400";

  const timerOptions = [
    { v: 0, l: "Mati", desc: "Pesan tidak menghilang" },
    { v: 86400, l: "24 jam", desc: "Pesan hilang setelah 1 hari" },
    { v: 604800, l: "7 hari", desc: "Pesan hilang setelah 7 hari" },
    { v: 7776000, l: "90 hari", desc: "Pesan hilang setelah 90 hari" },
  ];
  const getTimerLabel = (v: number) => v === 0 ? "Mati" : v === 86400 ? "24 jam" : v === 604800 ? "7 hari" : "90 hari";

  if (view === "conversation" && activePartner) {
    return (
      <div className="max-w-lg mx-auto flex flex-col" style={{ height: "calc(100vh - 52px)" }}>
        {/* Chat header */}
        <div className={`flex items-center gap-3 px-5 py-3 border-b ${isDark ? "border-white/[0.06] bg-zinc-900/80 backdrop-blur-xl" : "border-zinc-200 bg-white/80 backdrop-blur-xl"}`}>
          <button onClick={() => { setView("inbox"); setActivePartner(null); }} className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${isDark ? "text-zinc-400 hover:bg-white/[0.06]" : "text-zinc-500 hover:bg-zinc-100"}`}>
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button onClick={() => setShowProfile(true)} className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600 flex-shrink-0 overflow-hidden">
              {partnerStatus?.profilePhoto ? <img src={partnerStatus.profilePhoto} className="w-full h-full object-cover" alt="" /> : <span className="text-[14px] font-bold text-white">{activePartner.fullName.charAt(0)}</span>}
            </div>
            <div className="min-w-0">
              <p className={`text-[14px] font-semibold truncate ${textPrimary}`}>{activePartner.fullName}</p>
              <div className="flex items-center gap-1.5">
                {partnerStatus?.isOnline ? (<><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /><p className="text-[11px] text-emerald-500 font-medium">Online</p></>) : (<p className={`text-[11px] ${textMuted}`}>Offline • {formatLastSeen(partnerStatus?.lastSeen || 0)}</p>)}
              </div>
            </div>
          </button>
          <button onClick={() => startCall(false)} className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${isDark ? "text-emerald-400 hover:bg-emerald-500/10" : "text-emerald-600 hover:bg-emerald-50"}`}><Phone className="w-5 h-5" /></button>
          <button onClick={() => startCall(true)} className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${isDark ? "text-blue-400 hover:bg-blue-500/10" : "text-blue-600 hover:bg-blue-50"}`}><Video className="w-5 h-5" /></button>
          <div className="relative">
            <button onClick={() => setShowChatMenu(!showChatMenu)} className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer ${isDark ? "text-zinc-400 hover:bg-white/[0.06]" : "text-zinc-500 hover:bg-zinc-100"}`}><MoreVertical className="w-5 h-5" /></button>
            {showChatMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowChatMenu(false)} />
                <div className="absolute right-0 top-12 z-50 w-52 rounded-2xl border border-white/10 bg-zinc-800 shadow-2xl overflow-hidden">
                  <button onClick={() => { setShowChatMenu(false); setShowTimerPicker(true); }} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.06] transition-colors cursor-pointer">
                    <Bomb className={`w-5 h-5 ${msgTimer > 0 ? "text-amber-400" : "text-zinc-400"}`} />
                    <div>
                      <p className="text-[13px] text-white font-medium">Pesan Menghilang</p>
                      <p className="text-[11px] text-zinc-500">{getTimerLabel(msgTimer) === "Mati" ? "Nonaktif" : getTimerLabel(msgTimer)}</p>
                    </div>
                  </button>
                  <div className="h-px bg-white/[0.06]" />
                  <button onClick={() => { setShowChatMenu(false); setShowClearConfirm(true); }} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-white/[0.06] transition-colors cursor-pointer">
                    <Trash2 className="w-5 h-5 text-red-400" />
                    <p className="text-[13px] text-red-400 font-medium">Hapus Chat</p>
                  </button>
                </div>
              </>
            )}
          </div>
          {notificationPermission !== "granted" && (<button onClick={requestNotificationPermission} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium cursor-pointer ${isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"}`}>🔔 Aktifkan</button>)}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {(!messages || messages.length === 0) && (<div className="text-center py-12"><p className={`text-[13px] ${textMuted}`}>Mulai chat dengan {activePartner.fullName}</p></div>)}
          {messages?.map((msg) => {
            const isMine = msg.senderId === user?.id;
            // Call event - WhatsApp style inline
            if ((msg as any).callEvent) {
              const ev = (msg as any).callEvent;
              const isMissed = ev.status === "missed" || ev.status === "rejected";
              const isVideo = ev.type === "video";
              // WhatsApp-style duration: 47 dtk / 4 mnt
              let durText = "";
              if (ev.duration > 0) {
                if (ev.duration >= 3600) durText = `${Math.floor(ev.duration / 3600)} jam`;
                else if (ev.duration >= 60) durText = `${Math.floor(ev.duration / 60)} mnt`;
                else durText = `${ev.duration} dtk`;
              }
              const statusText = ev.status === "missed" ? "Tidak dijawab" : ev.status === "rejected" ? "Ditolak" : durText;
              // Direction: outgoing (↗) = isMine, incoming (↘) = not isMine
              return (
                <div key={msg._id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] px-4 py-3 rounded-2xl ${isMine ? (isMissed ? "bg-red-900/30 border border-red-500/20" : "bg-emerald-900/30 border border-emerald-500/20") : (isMissed ? "bg-zinc-800/80 border border-red-500/10" : "bg-zinc-800/80 border border-white/[0.06]")} ${isMine ? "rounded-br-md" : "rounded-bl-md"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isMissed ? "bg-red-500/15" : "bg-emerald-500/15"}`}>
                        {isVideo ? (
                          <Video className={`w-5 h-5 ${isMissed ? "text-red-400" : "text-emerald-400"}`} />
                        ) : (
                          <Phone className={`w-5 h-5 ${isMissed ? "text-red-400" : "text-emerald-400"}`} />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[13px] font-medium ${isMissed ? "text-red-400" : "text-white"}`}>{isVideo ? "Telepon video" : "Telepon suara"}</span>
                          {/* Direction arrow */}
                          <span className={`text-[12px] ${isMissed ? "text-red-400/60" : "text-emerald-400/60"}`}>{isMine ? "↗" : "↘"}</span>
                        </div>
                        <p className={`text-[11px] ${isMissed ? "text-red-400/70" : "text-white/50"}`}>{statusText}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-1 mt-1">
                      <p className={`text-[10px] ${isMissed ? "text-red-400/50" : "text-white/40"}`}>{formatTime(msg.timestamp)}</p>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={msg._id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
                <div onContextMenu={(e) => handleContextMenu(e, msg._id, isMine)}
                  onPointerDown={(e) => { const t = setTimeout(() => { handleContextMenu({ preventDefault: () => {}, clientX: e.clientX, clientY: e.clientY } as any, msg._id, isMine); }, 500); (e.currentTarget as any)._longPressTimer = t; }}
                  onPointerUp={(e) => clearTimeout((e.currentTarget as any)._longPressTimer)}
                  onPointerLeave={(e) => clearTimeout((e.currentTarget as any)._longPressTimer)}
                  className={`max-w-[80%] select-none ${msg.image ? "" : "px-4 py-2.5 rounded-2xl"} ${msg.image ? "" : isMine ? "bg-emerald-500 text-white rounded-br-md" : isDark ? "bg-zinc-800 text-white rounded-bl-md" : "bg-zinc-100 text-zinc-900 rounded-bl-md"}`}>
                  {msg.image && (<div className="mb-1.5"><img src={msg.image} alt="Foto" className="max-w-[260px] rounded-2xl cursor-pointer" onClick={() => window.open(msg.image, "_blank")} /></div>)}
                  {(msg as any).audio && (
                    <div className="flex items-center gap-2.5 py-1 min-w-[180px]">
                      <button onClick={() => togglePlayAudio(msg._id, (msg as any).audio)} className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer ${isMine ? "bg-white/20" : isDark ? "bg-emerald-500/15" : "bg-emerald-100"}`}>
                        {playingMsgId === msg._id ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 ml-0.5 text-white" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className={`h-1.5 rounded-full overflow-hidden ${isMine ? "bg-white/20" : isDark ? "bg-white/10" : "bg-zinc-200"}`}><div className="h-full bg-white rounded-full transition-all duration-200" style={{ width: `${playingMsgId === msg._id ? playProgress : 0}%` }} /></div>
                        <p className={`text-[10px] mt-1 ${isMine ? "text-white/60" : textMuted}`}>{formatRecTime((msg as any).audioDuration || 0)}</p>
                      </div>
                    </div>
                  )}
                  {msg.text && msg.text !== "📷 Foto" && msg.text !== "🎤 Pesan Suara" && (<p className={`text-[14px] leading-relaxed break-words ${msg.image ? (isMine ? "text-emerald-400" : textSecondary) : ""}`}>{msg.text}</p>)}
                  <div className="flex items-center justify-end gap-1 mt-1">
                    {(msg as any).timer && (<span className="text-[9px] text-amber-300/70">⏱</span>)}
                    <p className={`text-[10px] ${msg.image ? (isMine ? "text-emerald-400" : textMuted) : (isMine ? "text-emerald-100" : textMuted)}`}>{formatTime(msg.timestamp)}</p>
                    {isMine && (<span className={`text-[12px] ${msg.read ? "text-emerald-300" : "text-emerald-200/70"}`}>{msg.read ? "✓✓" : "✓"}</span>)}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Profile Modal */}
        {showProfile && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowProfile(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className={`w-72 rounded-3xl p-6 text-center ${card}`} onClick={(e) => e.stopPropagation()}>
              <div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600 overflow-hidden">
                {partnerStatus?.profilePhoto ? <img src={partnerStatus.profilePhoto} className="w-full h-full object-cover" alt="" /> : <span className="text-[28px] font-bold text-white">{activePartner.fullName.charAt(0)}</span>}
              </div>
              <p className={`text-[18px] font-bold ${textPrimary}`}>{activePartner.fullName}</p>
              <p className={`text-[13px] mt-1 ${textMuted}`}>@{partnerStatus?.username || activePartner.username || activePartner.userId.slice(0, 8)}</p>
              <div className="flex items-center justify-center gap-2 mt-3">
                {partnerStatus?.isOnline ? (<><div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" /><span className="text-[13px] text-emerald-500 font-medium">Online</span></>) : (<span className={`text-[13px] ${textMuted}`}>Offline • {formatLastSeen(partnerStatus?.lastSeen || 0)}</span>)}
              </div>
              <button onClick={() => setShowProfile(false)} className="mt-5 w-full py-2.5 rounded-xl bg-emerald-500 text-white text-[14px] font-semibold cursor-pointer">Tutup</button>
            </motion.div>
          </div>
        )}

        {/* Message Context Menu */}
        {contextMenu && (<>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} />
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="fixed z-50 bg-zinc-800 border border-white/10 rounded-xl shadow-2xl overflow-hidden" style={{ left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.min(contextMenu.y, window.innerHeight - 60) }}>
            {contextMenu.isMine && (<button onClick={() => handleDeleteMessage(contextMenu.msgId)} className="flex items-center gap-2.5 w-full px-4 py-3 text-[13px] text-red-400 hover:bg-white/[0.06] transition-colors cursor-pointer"><Trash2 className="w-4 h-4" /> Hapus Pesan</button>)}
            {!contextMenu.isMine && (<p className="px-4 py-3 text-[12px] text-zinc-400">Pesan orang lain</p>)}
          </motion.div>
        </>)}

        {/* Clear Chat Confirm */}
        {showClearConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowClearConfirm(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="w-72 rounded-3xl p-6 text-center bg-zinc-800 border border-white/10" onClick={(e) => e.stopPropagation()}>
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4"><Trash2 className="w-6 h-6 text-red-400" /></div>
              <p className="text-[16px] font-bold text-white">Bersihkan Chat?</p>
              <p className="text-[13px] text-zinc-400 mt-1">Semua pesan dengan {activePartner.fullName} akan dihapus permanen.</p>
              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowClearConfirm(false)} className="flex-1 py-2.5 rounded-xl bg-white/[0.06] text-zinc-300 text-[14px] font-medium cursor-pointer">Batal</button>
                <button onClick={handleClearChat} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-[14px] font-semibold cursor-pointer">Hapus</button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Timer Picker Modal - Full Bottom Sheet */}
        <AnimatePresence>
          {showTimerPicker && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowTimerPicker(false)}>
              <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 25, stiffness: 300 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-zinc-900 rounded-t-3xl p-5 pb-8 border-t border-white/10">
                <div className="flex items-center gap-3 mb-4">
                  <Bomb className="w-5 h-5 text-amber-400" />
                  <p className="text-[16px] font-bold text-white">Pesan Menghilang</p>
                </div>
                <p className="text-[12px] text-zinc-400 mb-4">Pilih berapa lama pesan akan tetap terlihat sebelum menghilang.</p>
                <div className="space-y-2">
                  {timerOptions.map((opt) => (
                    <button key={opt.v} onClick={() => { setMsgTimer(opt.v); setShowTimerPicker(false); }}
                      className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all cursor-pointer ${msgTimer === opt.v ? "bg-emerald-500/15 border border-emerald-500/30" : "bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08]"}`}>
                      <div>
                        <p className={`text-[14px] font-medium ${msgTimer === opt.v ? "text-emerald-400" : "text-white"}`}>{opt.l}</p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">{opt.desc}</p>
                      </div>
                      {msgTimer === opt.v && <Check className="w-5 h-5 text-emerald-400" />}
                    </button>
                  ))}
                </div>
                <button onClick={() => setShowTimerPicker(false)} className="w-full mt-4 py-3 rounded-2xl bg-white/[0.06] text-zinc-400 text-[14px] font-medium cursor-pointer hover:bg-white/[0.1]">Tutup</button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pending image preview */}
        {pendingImage && (
          <div className={`px-4 py-2 border-t ${isDark ? "border-white/[0.06] bg-zinc-900" : "border-zinc-200 bg-white"}`}>
            <div className="relative inline-block">
              <img src={pendingImage} alt="Preview" className="h-20 rounded-xl object-cover" />
              <button onClick={() => setPendingImage(null)} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 flex items-center justify-center"><X className="w-3 h-3 text-white" /></button>
            </div>
          </div>
        )}

        {/* Recording UI */}
        {(isRecording || audioBlob) && (
          <div className={`px-4 py-3 border-t ${isDark ? "border-white/[0.06] bg-zinc-900" : "border-zinc-200 bg-white"}`}>
            {isRecording ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[14px] text-white font-mono">{formatRecTime(recordTime)}</span>
                  <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden mx-2"><motion.div className="h-full bg-red-500 rounded-full" animate={{ width: `${Math.min((recordTime / 60) * 100, 100)}%` }} /></div>
                </div>
                <button onClick={cancelRecording} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center cursor-pointer"><X className="w-4 h-4 text-zinc-400" /></button>
                <button onClick={stopRecording} className="w-11 h-11 rounded-full bg-red-500 flex items-center justify-center cursor-pointer shadow-lg shadow-red-500/30"><MicOff className="w-5 h-5 text-white" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 flex-1"><Mic className="w-4 h-4 text-emerald-400" /><span className="text-[13px] text-white">Pesan suara ({formatRecTime(audioDuration)})</span></div>
                <button onClick={cancelRecording} className="px-3 py-1.5 rounded-lg bg-white/10 text-[12px] text-zinc-400 cursor-pointer">Batal</button>
                <button onClick={sendVoiceMessage} className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center cursor-pointer shadow-sm shadow-emerald-500/20"><Send className="w-4 h-4 text-white" /></button>
              </div>
            )}
          </div>
        )}

        {/* Normal Input */}
        {!isRecording && !audioBlob && (
          <div className={`px-4 py-3 border-t ${isDark ? "border-white/[0.06] bg-zinc-900" : "border-zinc-200 bg-white"}`}>
            {msgTimer > 0 && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <Bomb className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-[11px] text-amber-400">Pesan akan menghilang: {getTimerLabel(msgTimer)}</span>
                <button onClick={() => setMsgTimer(0)} className="text-[11px] text-zinc-500 ml-auto cursor-pointer">✕</button>
              </div>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageUpload} className="hidden" />
            <div className="flex items-center gap-2">
              <button onClick={() => fileInputRef.current?.click()} className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer flex-shrink-0 transition-all ${isDark ? "bg-white/[0.06] text-zinc-400 hover:bg-white/[0.1]" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"}`}><ImagePlus className="w-5 h-5" /></button>
              <button onClick={() => cameraInputRef.current?.click()} className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer flex-shrink-0 transition-all ${isDark ? "bg-white/[0.06] text-blue-400 hover:bg-white/[0.1]" : "bg-zinc-100 text-blue-500 hover:bg-zinc-200"}`}><Camera className="w-5 h-5" /></button>
              <button onClick={startRecording} className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer flex-shrink-0 transition-all ${isDark ? "bg-white/[0.06] text-zinc-400 hover:bg-white/[0.1]" : "bg-zinc-100 text-zinc-500 hover:bg-zinc-200"}`}><Mic className="w-5 h-5" /></button>

              <input type="text" value={messageText} onChange={(e) => setMessageText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !sendingRef.current && handleSend()} placeholder="Ketik pesan..." className={`flex-1 min-w-0 rounded-xl border px-4 py-2.5 text-[14px] outline-none ${inputCls}`} />
              <button onClick={handleSend} disabled={sendingRef.current || (!messageText.trim() && !pendingImage)} className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-all ${messageText.trim() || pendingImage ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20" : isDark ? "bg-white/[0.04] text-zinc-600" : "bg-zinc-100 text-zinc-400"}`}><Send className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="max-w-lg mx-auto px-5 pt-5 pb-8 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className={`text-[22px] font-bold tracking-tight ${textPrimary}`}>Chat</h1>
          <p className={`text-[13px] mt-0.5 ${textSecondary}`}>{totalUnread > 0 ? `${totalUnread} pesan belum dibaca` : "Real-time chat antar pengguna"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView(view === "callhistory" ? "inbox" : "callhistory")} className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer shadow-sm ${view === "callhistory" ? "bg-emerald-500 text-white shadow-emerald-500/20" : isDark ? "bg-white/[0.06] text-zinc-400" : "bg-zinc-100 text-zinc-500"}`}><Clock className="w-5 h-5" /></button>
          <button onClick={() => setView("search")} className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center cursor-pointer shadow-sm shadow-emerald-500/20"><UserPlus className="w-5 h-5 text-white" /></button>
        </div>
      </div>

      {view === "search" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className={`flex-1 flex items-center gap-2 rounded-xl border px-3 py-2.5 ${card}`}><Search className={`w-4 h-4 flex-shrink-0 ${textMuted}`} /><input type="text" value={searchQuery} autoFocus onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari username atau nama..." className={`flex-1 min-w-0 bg-transparent text-[14px] outline-none ${isDark ? "text-white placeholder:text-zinc-500" : "text-zinc-900 placeholder:text-zinc-400"}`} /></div>
            <button onClick={() => { setView("inbox"); setSearchQuery(""); }} className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer ${isDark ? "bg-white/[0.06] text-zinc-400" : "bg-zinc-100 text-zinc-500"}`}><X className="w-5 h-5" /></button>
          </div>
          {searchResults === undefined ? (<p className={`text-center text-[13px] py-4 ${textMuted}`}>Mencari...</p>) : searchResults.length === 0 ? (<p className={`text-center text-[13px] py-4 ${textMuted}`}>{searchQuery.length > 0 ? "Tidak ditemukan" : "Ketik username atau nama untuk mencari"}</p>) : (
            <div className="space-y-2">
              {searchResults.map((u) => (
                <button key={u._id} onClick={() => openConversation({ userId: u.userId, fullName: u.fullName, username: u.username })} className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer text-left ${card} hover:border-emerald-500/30`}>
                  <div className="w-11 h-11 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600 flex-shrink-0 overflow-hidden">{u.profilePhoto ? <img src={u.profilePhoto} className="w-full h-full object-cover" alt="" /> : <span className="text-[15px] font-bold text-white">{u.fullName.charAt(0)}</span>}</div>
                  <div className="min-w-0"><p className={`text-[14px] font-semibold truncate ${textPrimary}`}>{u.fullName}</p><p className={`text-[12px] truncate ${textMuted}`}>@{u.username}</p></div>
                  <MessageCircle className={`w-4 h-4 flex-shrink-0 ml-auto ${textMuted}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === "callhistory" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className={`text-[14px] font-semibold ${textPrimary}`}>📞 Riwayat Panggilan</p>
            <div className="flex items-center gap-3">
              {callHistory && callHistory.length > 0 && (<button onClick={async () => { if (user && confirm("Hapus semua riwayat panggilan?")) { await clearCallHistoryMut({ userId: user.id }); } }} className="text-[12px] text-red-400 cursor-pointer hover:text-red-300">Hapus Riwayat</button>)}
              <button onClick={() => setView("inbox")} className={`text-[12px] cursor-pointer ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>Kembali</button>
            </div>
          </div>
          {!callHistory ? (<p className={`text-center text-[13px] py-8 ${textMuted}`}>Memuat...</p>) : callHistory.length === 0 ? (
            <div className={`text-center py-12 rounded-2xl border ${card}`}><Clock className={`w-12 h-12 mx-auto mb-3 ${textMuted}`} /><p className={`text-[14px] font-medium ${textPrimary}`}>Belum ada riwayat</p><p className={`text-[13px] mt-1 ${textSecondary}`}>Riwayat panggilan akan muncul di sini</p></div>
          ) : (
            <div className="space-y-2">
              {callHistory.map((call) => {
                const isCaller = call.callerId === user?.id;
                const otherName = isCaller ? call.calleeName : call.callerName;
                const statusIcon = call.status === "answered" ? <PhoneIncoming className="w-4 h-4 text-emerald-400" /> : call.status === "rejected" ? <PhoneOff className="w-4 h-4 text-red-400" /> : <PhoneMissed className="w-4 h-4 text-amber-400" />;
                const statusText = call.status === "answered" ? "Dijawab" : call.status === "rejected" ? "Ditolak" : "Tidak dijawab";
                const durasi = call.duration > 0 ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, "0")}` : "-";
                return (
                  <div key={call._id} className={`flex items-center gap-3 p-3.5 rounded-2xl border ${card}`}>
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${call.status === "answered" ? "bg-emerald-500/15" : call.status === "rejected" ? "bg-red-500/15" : "bg-amber-500/15"}`}>{statusIcon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2"><p className={`text-[14px] font-semibold truncate ${textPrimary}`}>{otherName}</p><span className={`text-[11px] px-1.5 py-0.5 rounded-md flex-shrink-0 ${call.status === "answered" ? "bg-emerald-500/10 text-emerald-400" : call.status === "rejected" ? "bg-red-500/10 text-red-400" : "bg-amber-500/10 text-amber-400"}`}>{statusText}</span></div>
                      <div className="flex items-center gap-2 mt-0.5"><p className={`text-[12px] ${textMuted}`}>{isCaller ? "Ke " : "Dari "}{otherName}</p><span className={`text-[11px] ${textMuted}`}>• {durasi}</span></div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); deleteCallEntryMut({ callId: call._id }); }} className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    <span className={`text-[10px] flex-shrink-0 ${textMuted}`}>{formatTime(call.timestamp)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {view === "inbox" && (<>
        <button onClick={() => setView("search")} className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 ${card} cursor-pointer`}><Search className={`w-4 h-4 flex-shrink-0 ${textMuted}`} /><span className={`text-[14px] ${textMuted}`}>Cari pengguna...</span></button>
        {!conversations ? (<p className={`text-center text-[13px] py-8 ${textMuted}`}>Memuat...</p>) : conversations.length === 0 ? (
          <div className={`text-center py-16 rounded-2xl border ${card}`}><MessageCircle className={`w-12 h-12 mx-auto mb-3 ${textMuted}`} /><p className={`text-[14px] font-medium ${textPrimary}`}>Belum ada obrolan</p><p className={`text-[13px] mt-1 ${textSecondary}`}>Klik tombol + untuk mulai chat</p></div>
        ) : (
          <div className="space-y-2">
            {conversations.map((conv) => (
              <button key={conv.partner.userId} onClick={() => openConversation(conv.partner)} className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer text-left ${card} hover:border-emerald-500/20`}>
                <div className="relative flex-shrink-0">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-400 to-emerald-600">{conv.partner.profilePhoto ? <img src={conv.partner.profilePhoto} className="w-full h-full object-cover" alt="" /> : <span className="text-[15px] font-bold text-white">{conv.partner.fullName.charAt(0)}</span>}</div>
                  {conv.isOnline && (<div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-zinc-900" />)}
                  {conv.unreadCount > 0 && (<div className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-emerald-500 flex items-center justify-center px-1"><span className="text-[10px] font-bold text-white">{conv.unreadCount}</span></div>)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2"><p className={`text-[14px] font-semibold truncate ${textPrimary}`}>{conv.partner.fullName}</p><span className={`text-[10px] flex-shrink-0 ${textMuted}`}>{formatTime(conv.lastMessageTime)}</span></div>
                  <p className={`text-[11px] truncate ${textMuted}`}>@{conv.partner.username}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {conv.lastSenderId === user?.id && (<span className="text-[12px] text-emerald-500">{conv.unreadCount === 0 ? "✓✓" : "✓"}</span>)}
                    <p className={`text-[13px] truncate ${conv.unreadCount > 0 ? "font-medium text-white" : textSecondary}`}>{conv.lastMessage}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </>)}
    </motion.div>
  );
}

function formatTime(timestamp: number): string {
  const now = Date.now(); const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000); const hours = Math.floor(diff / 3600000); const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "Baru"; if (minutes < 60) return `${minutes}m`; if (hours < 24) return `${hours}j`; if (days < 7) return `${days}h`;
  const d = new Date(timestamp); return `${d.getDate()}/${d.getMonth() + 1}`;
}

function formatLastSeen(timestamp: number): string {
  if (timestamp === 0) return "Belum pernah online";
  const now = Date.now(); const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000); const hours = Math.floor(diff / 3600000); const days = Math.floor(diff / 86400000);
  if (minutes < 1) return "Baru saja"; if (minutes < 60) return `Terakhir ${minutes}m lalu`; if (hours < 24) return `Terakhir ${hours}j lalu`; if (days < 7) return `Terakhir ${days}h lalu`;
  const d = new Date(timestamp); return `Terakhir ${d.getDate()}/${d.getMonth() + 1}`;
}
