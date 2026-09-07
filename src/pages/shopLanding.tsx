import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  ArrowRight,
  LogIn,
  Globe,
  ShieldCheck,
  Wallet,
  ShoppingCart,
  PhoneIncoming,
  CheckCircle2,
  Timer,
  Loader2,
  UserPlus,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  apiListCountries,
  apiShopLogin,
  apiShopRegister,
  type Country,
  type ProviderId,
  type ShopUser,
} from "@/lib/convexApi";

/* ---------- brand ---------- */
const RED = "#e10600";
const DARK = "#0b0b0f";
const ACCENT = "#00e676";

type ServerDef = {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  description: string;
  badge: string | null;
};

const SERVER_LIST: ServerDef[] = [
  {
    id: "jasav1",
    label: "JasaOTP v1",
    provider: "kirimkode",
    providerLabel: "KirimKode",
    description:
      "Terhubung langsung ke API KirimKode. Negara, layanan, stok, dan harga diambil langsung dari server.",
    badge: "Populer",
  },
  {
    id: "jasav2",
    label: "JasaOTP v2",
    provider: "ditznesia",
    providerLabel: "Ditznesia",
    description:
      "Terhubung langsung ke API Ditznesia v1. Data negara & layanan live dari server.",
    badge: null,
  },
  {
    id: "jasav3",
    label: "JasaOTP v3",
    provider: "ditznesia_v2",
    providerLabel: "Ditznesia API v2",
    description:
      "Terhubung langsung ke API Ditznesia v2. Pilihan nomor mengikuti stok server.",
    badge: null,
  },
  {
    id: "jasav4",
    label: "JasaOTP v4",
    provider: "ditznesia_v2",
    providerLabel: "Ditznesia API v2",
    description:
      "Server tambahan (Ditznesia API v2). Aktif bila kunci API server ini diisi.",
    badge: "Baru",
  },
];

/* =====================================================================
 * LANDING PAGE (sebelum login) + modal masuk/daftar
 * ===================================================================== */
export function LandingPage({ onAuthed }: { onAuthed: (user: ShopUser) => void }) {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [totalCountries, setTotalCountries] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lists = await Promise.all(
        (["kirimkode", "ditznesia"] as ProviderId[]).map((id) => apiListCountries(id).catch(() => [] as Country[]))
      );
      if (cancelled) return;
      const seen = new Set<string>();
      for (const l of lists) for (const c of l) seen.add(String(c.name || "").trim().toLowerCase());
      setTotalCountries(seen.size > 0 ? seen.size : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openAuth = (mode: "login" | "register") => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-red-500/30 relative overflow-hidden">
      {/* glow dekoratif */}
      <div className="pointer-events-none absolute -top-32 -left-24 w-96 h-96 rounded-full blur-3xl" style={{ backgroundColor: "rgba(225,6,0,0.22)" }} />
      <div className="pointer-events-none absolute top-1/3 -right-32 w-[28rem] h-[28rem] rounded-full blur-3xl" style={{ backgroundColor: "rgba(0,230,118,0.10)" }} />

      {/* ================= NAV ================= */}
      <header className="relative z-10 border-b border-white/10 bg-[#0b0b0f]/70 backdrop-blur-md sticky top-0">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-600 flex items-center justify-center shadow-lg shadow-red-600/30">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h2m16 0h2M8 12a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4 4z" />
              </svg>
            </div>
            <div>
              <p className="text-[15px] font-extrabold tracking-tight">KAKO NOKOS</p>
              <p className="text-[11px] text-zinc-400 tracking-wide">Toko Nomor Online</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => openAuth("login")} className="px-4 py-2 rounded-xl text-sm font-semibold border border-white/15 text-zinc-200 hover:bg-white/5">
              Masuk
            </button>
            <button
              onClick={() => openAuth("register")}
              className="px-4 py-2 rounded-xl text-sm font-bold text-black hover:brightness-110"
              style={{ backgroundColor: ACCENT }}
            >
              Daftar
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* ================= HERO ================= */}
        <section className="max-w-6xl mx-auto px-5 pt-14 pb-10 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold border border-red-500/30 bg-red-500/10 text-red-300">
              <Zap className="w-3.5 h-3.5" /> Nomor virtual sekali pakai
            </span>
            <h1 className="text-4xl md:text-5xl font-black mt-4 leading-[1.1] tracking-tight">
              Verifikasi Akun <span style={{ color: ACCENT }}>Tanpa Ribet</span>,
              <br />
              Harga <span style={{ color: RED }}>Jelas & Final</span>.
            </h1>
            <p className="text-zinc-400 text-[15px] mt-4 leading-relaxed max-w-lg">
              KAKO NOKOS menjual nomor virtual untuk verifikasi WhatsApp, Telegram, Facebook, Google, dan ratusan
              layanan lain — lintas negara. Data negara, layanan, stok, dan harga <b className="text-zinc-200">langsung dari server resmi</b>, bukan daftar tempelan.
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <button
                onClick={() => openAuth("register")}
                className="px-6 py-3.5 rounded-2xl text-black text-sm font-bold shadow-lg shadow-emerald-500/20 flex items-center gap-2 hover:brightness-110 active:scale-[0.99] transition-all"
                style={{ backgroundColor: ACCENT }}
              >
                Daftar Gratis — Isi Saldo Pertama <ArrowRight className="w-4 h-4" />
              </button>
              <button onClick={() => openAuth("login")} className="px-6 py-3.5 rounded-2xl text-white text-sm font-semibold border border-white/20 hover:bg-white/5 flex items-center gap-2">
                <LogIn className="w-4 h-4" /> Saya sudah punya akun
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-8 max-w-md">
              <div>
                <p className="text-2xl font-black" style={{ color: ACCENT }}>{totalCountries == null ? "…" : totalCountries}</p>
                <p className="text-[11px] text-zinc-500">Negara (semua server)</p>
              </div>
              <div>
                <p className="text-2xl font-black" style={{ color: ACCENT }}>24/7</p>
                <p className="text-[11px] text-zinc-500">OTP dicek otomatis</p>
              </div>
              <div>
                <p className="text-2xl font-black" style={{ color: ACCENT }}>0</p>
                <p className="text-[11px] text-zinc-500">Biaya tersembunyi</p>
              </div>
            </div>
          </div>

          {/* kartu mock */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 max-w-md mx-auto w-full">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold flex items-center gap-2"><Globe className="w-4 h-4 text-red-500" /> Pilih Server</p>
              <span className="text-[11px] px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: ACCENT, color: DARK }}>LIVE</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {SERVER_LIST.slice(0, 3).map((s) => (
                <span key={s.id} className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-zinc-800 text-white border border-white/10">{s.label}</span>
              ))}
            </div>
            <div className="mt-4 rounded-2xl bg-zinc-950/80 border border-white/10 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[12px] text-zinc-400">Negara terpopuler</span>
                <span className="text-[11px] text-zinc-500">indonesia 🇮🇩</span>
              </div>
              {[
                { name: "WhatsApp", price: "Rp 3.500", stok: "stok 412" },
                { name: "Telegram", price: "Rp 2.100", stok: "stok 208" },
                { name: "Facebook", price: "Rp 1.800", stok: "stok 96" },
              ].map((s) => (
                <div key={s.name} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <span className="text-[13px] text-white font-medium">{s.name}</span>
                  <span className="text-[12px] font-bold" style={{ color: ACCENT }}>{s.price} <span className="text-zinc-600 font-normal">• {s.stok}</span></span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[12px] text-zinc-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              Harga di layar = harga yang kamu bayar. Tidak ada markup rahasia.
            </div>
          </motion.div>
        </section>

        {/* ================= CARA KERJA ================= */}
        <section className="max-w-6xl mx-auto px-5 py-10">
          <h2 className="text-2xl md:text-3xl font-extrabold text-center">Gimana Cara Kerjanya?</h2>
          <p className="text-zinc-500 text-sm text-center mt-2 max-w-xl mx-auto">
            Sistem <b className="text-white">isi saldo (deposit)</b> — bukan bayar per transaksi. Lebih aman buat kamu.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            {[
              { icon: <Wallet className="w-6 h-6 text-red-500" />, step: "01", title: "Daftar & Isi Saldo", desc: "Buat akun gratis (email + password), lalu isi saldo lewat QR Paymentku. Saldo masuk otomatis begitu bayaran lunas." },
              { icon: <ShoppingCart className="w-6 h-6 text-red-500" />, step: "02", title: "Pilih & Beli Nomor", desc: "Pilih server, negara, dan layanan yang kamu butuhkan. Harga final langsung dipotong dari saldo — tidak ada biaya lain." },
              { icon: <PhoneIncoming className="w-6 h-6 text-red-500" />, step: "03", title: "OTP Otomatis Masuk", desc: "Kode OTP dicek otomatis sampai ketemu lalu tampil di riwayat. Gagal = saldo kembali otomatis." },
            ].map((c) => (
              <div key={c.step} className="rounded-3xl border border-white/10 bg-zinc-900/50 p-6 relative overflow-hidden">
                <span className="absolute -top-3 -right-1 text-[72px] font-black text-white/[0.04] select-none">{c.step}</span>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: "rgba(225,6,0,0.15)" }}>
                  {c.icon}
                </div>
                <p className="font-bold text-lg">{c.title}</p>
                <p className="text-zinc-400 text-[13px] mt-2 leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ================= GARANSI & ATURAN ================= */}
        <section className="max-w-6xl mx-auto px-5 py-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.04] p-6">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" /> Kamu Tidak Akan Rugi
              </h3>
              <ul className="mt-4 space-y-3 text-[14px] text-zinc-300 leading-relaxed">
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /> Kalau order gagal dibuat server, <b>saldo dikembalikan otomatis</b>.</li>
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /> Kalau nomor tak kunjung dapat OTP, kamu bisa <b>batalkan & refund</b> — saldo balik utuh.</li>
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /> Semua transaksi tercatat di <b>Riwayat</b> akun kamu.</li>
              </ul>
            </div>
            <div className="rounded-3xl border border-white/10 bg-zinc-900/50 p-6">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Timer className="w-5 h-5 text-amber-400" /> Aturan Batalkan & Refund
              </h3>
              <ul className="mt-4 space-y-3 text-[14px] text-zinc-300 leading-relaxed">
                <li className="flex gap-2"><span className="text-amber-400 font-bold flex-shrink-0">1.</span> Pembatalan hanya bisa dilakukan <b>minimal 2 menit</b> setelah order dibuat.</li>
                <li className="flex gap-2"><span className="text-amber-400 font-bold flex-shrink-0">2.</span> Kalau <b>kode OTP sudah masuk</b>, order tidak bisa dibatalkan/direfund — nomor sudah terpakai.</li>
                <li className="flex gap-2"><span className="text-amber-400 font-bold flex-shrink-0">3.</span> Refund selalu kembali ke <b>saldo akun</b>, siap dipakai beli lagi.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ================= CTA ================= */}
        <section className="max-w-6xl mx-auto px-5 py-12 text-center">
          <div className="rounded-3xl p-10 md:p-14 relative overflow-hidden border border-white/10" style={{ background: "linear-gradient(135deg, rgba(225,6,0,0.16), rgba(11,11,15,0.6) 55%), #0b0b0f" }}>
            <h2 className="text-3xl md:text-4xl font-black">Siap Verifikasi Akun Kamu?</h2>
            <p className="text-zinc-400 text-sm mt-3 max-w-lg mx-auto">
              Daftar gratis, isi saldo sekali, dan langsung bisa beli nomor virtual dari ratusan layanan lintas negara.
            </p>
            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <button onClick={() => openAuth("register")} className="px-7 py-3.5 rounded-2xl text-sm font-bold text-black hover:brightness-110" style={{ backgroundColor: ACCENT }}>
                Daftar Sekarang — Gratis
              </button>
              <button onClick={() => openAuth("login")} className="px-7 py-3.5 rounded-2xl text-sm font-semibold border border-white/20 hover:bg-white/5">
                Masuk
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 mt-6 py-6 text-center text-[12px] text-zinc-500">
        <p className="font-semibold text-white tracking-wide">KAKO NOKOS</p>
        <p className="mt-1">Toko nomor virtual online — harga tampil = harga bayar. Pembayaran via QR Paymentku.</p>
      </footer>

      {/* ============ MODAL MASUK / DAFTAR ============ */}
      <AnimatePresence>
        {authOpen && (
          <AuthModal
            initialMode={authMode}
            onClose={() => setAuthOpen(false)}
            onAuthed={(user) => {
              setAuthOpen(false);
              onAuthed(user);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* =====================================================================
 * MODAL AUTH: Masuk | Daftar
 * (pendaftaran Owner/CS tidak tersedia dari halaman ini — akun Owner
 *  dibuat langsung oleh developer, akun CS dibuat dari Panel Admin)
 * ===================================================================== */
function AuthModal({
  initialMode,
  onClose,
  onAuthed,
}: {
  initialMode: "login" | "register";
  onClose: () => void;
  onAuthed: (user: ShopUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Isi email dan password dulu.");
      return;
    }
    if (mode !== "login" && password.length < 4) {
      setError("Password minimal 4 karakter.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        const reg = await apiShopRegister({ email, password, fullName });
        if (!reg.success) {
          setError(reg.error || "Gagal mendaftar.");
          return;
        }
      }
      const res = await apiShopLogin(email, password);
      if (!res.ok || !res.user) {
        setError(res.error || "Login gagal.");
        return;
      }
      onAuthed(res.user);
    } catch (err: any) {
      setError(err?.message || "Terjadi kesalahan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  const tabCls = (active: boolean) =>
    active
      ? "text-black font-bold"
      : "text-zinc-400 hover:text-white border border-white/10";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-t-3xl sm:rounded-3xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">
            {mode === "login" ? "Masuk" : "Daftar Akun"}
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400">
            ✕
          </button>
        </div>

        {/* pilihan mode */}
        <div className="grid grid-cols-2 gap-2 mb-5">
          {([
            { id: "login" as const, label: "Masuk" },
            { id: "register" as const, label: "Daftar" },
          ]).map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                setError(null);
              }}
              className={`py-2 rounded-xl text-[13px] transition-all ${tabCls(mode === m.id)}`}
              style={mode === m.id ? { backgroundColor: ACCENT } : {}}
            >
              {m.label}
            </button>
          ))}
        </div>

        <p className="text-[12px] text-zinc-500 mb-4 leading-relaxed -mt-1">
          {mode === "login" && "Masuk untuk melihat saldo dan membeli nomor."}
          {mode === "register" && "Buat akun — saldo kamu tersimpan dan bisa diisi kapan saja."}
        </p>

        {mode !== "login" && (
          <label className="block mb-3">
            <span className="text-[12px] text-zinc-400 mb-1 block">Nama (opsional)</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Nama kamu"
              className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
            />
          </label>
        )}
        <label className="block mb-3">
          <span className="text-[12px] text-zinc-400 mb-1 block">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="nama@email.com"
            autoComplete="email"
            className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
          />
        </label>
        <label className="block mb-3">
          <span className="text-[12px] text-zinc-400 mb-1 block">Password</span>
          <div className="relative">
            <input
              type={showPass ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "login" ? "Password kamu" : "Minimal 4 karakter"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className="w-full rounded-xl bg-zinc-800 border border-white/10 pl-4 pr-11 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPass((v) => !v)}
              tabIndex={-1}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
              aria-label={showPass ? "Sembunyikan password" : "Lihat password"}
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </label>

        {error && (
          <p className="text-[13px] text-red-300 leading-relaxed mb-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-3.5 rounded-xl text-sm font-bold text-black hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg"
          style={{ backgroundColor: ACCENT }}
        >
          {busy ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Memproses...
            </>
          ) : mode === "login" ? (
            <>
              <LogIn className="w-4 h-4" /> Masuk
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4" /> Daftar
            </>
          )}
        </button>

        <p className="text-[11px] text-zinc-500 text-center mt-4 leading-relaxed">
          Nomor virtual untuk verifikasi WhatsApp, Telegram, dan lainnya. Isi saldo lalu beli — harga yang tampil
          itulah yang dibayar.
        </p>
      </motion.div>
    </motion.div>
  );
}
