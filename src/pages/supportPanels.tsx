/**
 * Panel "Bantuan" untuk halaman customer.
 *
 *  - SupportMenuSheet : pilihan cara menghubungi CS
 *                       (chat di website · WhatsApp · Telegram)
 *  - SupportChatSheet : chat di website (balasan otomatis sederhana, bukan AI)
 *
 * Pilihan WhatsApp/Telegram dan balasan otomatis diatur Owner dari
 * Panel Admin → tab "Bantuan CS" (disimpan di pengaturan toko).
 */

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Headset, Loader2, MessageCircle, Send, XCircle } from "lucide-react";
import {
  apiSupportMyThread,
  apiSupportSend,
  type SupportMessage,
  type SupportPublicConfig,
} from "@/lib/convexApi";

const ACCENT = "#00e676";
const DARK = "#0b0b0f";

/* =====================================================================
 * PILIHAN BANTUAN — chat website / WhatsApp / Telegram
 * ===================================================================== */
export function SupportMenuSheet({
  open,
  config,
  onClose,
  onChat,
}: {
  open: boolean;
  config: SupportPublicConfig | null;
  onClose: () => void;
  onChat: () => void;
}) {
  if (!open) return null;
  const wa = config?.contactEnabled && config.waUrl ? config.waUrl : null;
  const tg = config?.contactEnabled && config.tgUrl ? config.tgUrl : null;
  const auto = config?.autoReply !== false;

  return (
    <div
      className="fixed inset-0 z-[94] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-zinc-950 border border-white/10 rounded-t-3xl sm:rounded-3xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center border border-white/20 flex-shrink-0"
            style={{ background: `linear-gradient(140deg, ${ACCENT} 0%, #00773c 100%)` }}
          >
            <Headset className="w-5 h-5" style={{ color: DARK }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-white leading-tight">Bantuan</p>
            <p className="text-[11px] text-zinc-400 truncate">Pilih cara menghubungi kami</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 text-zinc-400 hover:text-white"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-2.5">
          <button
            onClick={onChat}
            className="w-full text-left rounded-2xl border border-white/12 bg-white/5 hover:bg-white/10 px-4 py-3.5 flex items-center gap-3 transition-colors"
          >
            <span
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: "rgba(0,230,118,0.15)", color: ACCENT }}
            >
              <MessageCircle className="w-5 h-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-white">Chat di Website</span>
              <span className="block text-[11px] text-zinc-400">
                {auto ? "Dijawab otomatis (CS) — bisa lanjut ke admin" : "Pesan langsung masuk ke admin/CS"}
              </span>
            </span>
            <ArrowRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          </button>

          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noreferrer"
              className="w-full text-left rounded-2xl border border-white/12 bg-white/5 hover:bg-white/10 px-4 py-3.5 flex items-center gap-3 transition-colors"
            >
              <span
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "rgba(37,211,102,0.15)", color: "#25d366" }}
              >
                <MessageCircle className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-white">WhatsApp</span>
                <span className="block text-[11px] text-zinc-400">
                  {config?.waNumber || "Chat langsung dengan admin"}
                </span>
              </span>
              <ArrowRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            </a>
          )}

          {tg && (
            <a
              href={tg}
              target="_blank"
              rel="noreferrer"
              className="w-full text-left rounded-2xl border border-white/12 bg-white/5 hover:bg-white/10 px-4 py-3.5 flex items-center gap-3 transition-colors"
            >
              <span
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: "rgba(56,148,220,0.15)", color: "#3894dc" }}
              >
                <Send className="w-5 h-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-white">Telegram</span>
                <span className="block text-[11px] text-zinc-400">{config?.tgName || "Chat lewat Telegram"}</span>
              </span>
              <ArrowRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
            </a>
          )}
        </div>

        <p className="px-5 pb-5 text-[11px] text-zinc-500 leading-relaxed">
          Laporan lewat chat website selalu tersedia dan tercatat di akunmu.
          {auto
            ? " Balasan pertama datang otomatis; kalau perlu admin, tulis “admin”."
            : " Admin akan membalas di halaman chat."}
        </p>
      </div>
    </div>
  );
}

/* =====================================================================
 * CHAT CS DI WEBSITE — balasan otomatis sederhana, bisa dialihkan ke admin
 * ===================================================================== */
export function SupportChatSheet({
  open,
  userId,
  config,
  onClose,
}: {
  open: boolean;
  userId: string;
  config?: SupportPublicConfig | null;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [mode, setMode] = useState<string>("ai");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = async () => {
    const res = await apiSupportMyThread(userId).catch(() => null);
    if (!res) return;
    if (!res.ok) {
      if (res.error) setError(res.error);
      return;
    }
    setMessages(res.messages || []);
    setMode(res.mode || "ai");
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    load().finally(() => setLoading(false));
    const timer = setInterval(() => {
      load().catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  const send = async (raw?: string) => {
    const body = (raw ?? text).trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user" as const, body, createdAt: Date.now() },
    ]);
    const res = await apiSupportSend(userId, body).catch(() => null);
    if (res && !res.ok && res.error) setError(res.error);
    await load();
    setBusy(false);
  };

  if (!open) return null;

  const quick = [
    "Cara beli nomor gimana?",
    "OTP belum masuk",
    "Aturan refund / batal",
    "Mau bicara dengan admin",
  ];
  const staffMode = mode === "human";
  const auto = config?.autoReply !== false;

  return (
    <div
      className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg bg-zinc-950 border border-white/10 rounded-t-3xl sm:rounded-3xl flex flex-col max-h-[92vh] overflow-hidden"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center border border-white/20 flex-shrink-0"
            style={{ background: `linear-gradient(140deg, ${ACCENT} 0%, #00773c 100%)` }}
          >
            <Headset className="w-5 h-5" style={{ color: DARK }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-white leading-tight">Chat CS</p>
            <p className="text-[11px] text-zinc-400 truncate">
              {staffMode
                ? "Terhubung ke admin/CS — balasan muncul di halaman ini"
                : auto
                  ? "Dijawab otomatis (CS) · tulis “admin” untuk minta admin"
                  : "Pesan masuk ke admin/CS — balasan muncul di halaman ini"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 text-zinc-400 hover:text-white"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading && messages.length === 0 && (
            <div className="flex items-center justify-center gap-2 text-zinc-500 text-sm py-8">
              <Loader2 className="w-4 h-4 animate-spin" /> Memuat percakapan…
            </div>
          )}

          {!loading && messages.length === 0 && (
            <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
              <p className="text-sm font-bold text-white flex items-center gap-2">
                <Headset className="w-4 h-4" style={{ color: ACCENT }} /> Ada yang bisa dibantu?
              </p>
              <p className="text-[12px] text-zinc-400 mt-1">
                {auto ? (
                  <>
                    Tulis pertanyaan atau laporanmu di bawah — dijawab otomatis oleh CS. Kalau perlu admin, tulis{" "}
                    <b className="text-white">admin</b>.
                  </>
                ) : (
                  <>
                    Tulis pertanyaan atau laporanmu di bawah. Pesan langsung masuk ke admin/CS dan dibalas di halaman
                    ini.
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {quick.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="text-[11px] px-3 py-1.5 rounded-full border border-white/15 text-zinc-200 hover:bg-white/10"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            const mine = m.role === "user";
            const staff = m.role === "staff";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap border ${
                    mine
                      ? "bg-red-600/20 border-red-500/30 text-white"
                      : staff
                        ? "bg-sky-500/10 border-sky-500/30 text-zinc-100"
                        : "bg-zinc-900/80 border-white/10 text-zinc-100"
                  }`}
                >
                  {!mine && (
                    <p
                      className="text-[10px] font-bold uppercase tracking-wide mb-1 flex items-center gap-1"
                      style={{ color: staff ? "#7dd3fc" : ACCENT }}
                    >
                      <Headset className="w-3 h-3" />
                      {staff ? m.authorName || "Admin/CS" : "CS Otomatis"}
                    </p>
                  )}
                  {m.body}
                </div>
              </div>
            );
          })}
        </div>

        {error && <p className="px-4 pb-2 text-[12px] text-red-300">{error}</p>}

        <div className="border-t border-white/10 p-3 flex items-end gap-2 bg-[#0b0b0f]">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={staffMode ? "Tulis balasan untuk admin…" : "Tulis pesan atau laporanmu…"}
            className="flex-1 resize-none bg-white/5 border border-white/10 rounded-2xl px-3.5 py-2.5 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-white/25 max-h-28"
          />
          <button
            onClick={() => send()}
            disabled={busy || !text.trim()}
            className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 disabled:opacity-40"
            style={{ backgroundColor: ACCENT, color: DARK }}
          >
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
