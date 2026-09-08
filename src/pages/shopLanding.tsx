import { useEffect, useState, type ReactNode } from "react";
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
  Sparkles,
  ShoppingBag,
  ChevronDown,
  Gift,
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
const GOLD = "#ffc857";

const GRAD_BRAND = "linear-gradient(92deg, #ffffff 5%, #00e676 45%, #ff5f56 90%)";
const GRAD_EMBLEM = "linear-gradient(140deg, #ff3d2e 0%, #e10600 45%, #7a0a05 100%)";


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
      "Server 3 (API Ditznesia v1). Data negara & layanan live dari server.",
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
      "Server 4 (API Ditznesia v2). Otomatis memakai kunci API akun Ditznesia yang sama dengan server v1.",
    badge: "Baru",
  },
];

/* ------- demo "pembelian terbaru" (sosial proof, non-transaksi nyata) ------- */
const DEMO_BUYERS = [
  { name: "R***", svc: "WhatsApp", cty: "Indonesia" },
  { name: "A***", svc: "Telegram", cty: "Malaysia" },
  { name: "F***", svc: "Facebook", cty: "Indonesia" },
  { name: "D***", svc: "TikTok", cty: "Jepang" },
  { name: "S***", svc: "Google", cty: "Singapura" },
  { name: "M***", svc: "WhatsApp", cty: "India" },
  { name: "N***", svc: "Instagram", cty: "Filipina" },
  { name: "W***", svc: "Telegram", cty: "Thailand" },
  { name: "I***", svc: "Shopee", cty: "Indonesia" },
  { name: "B***", svc: "Twitter", cty: "Vietnam" },
  { name: "E***", svc: "WhatsApp", cty: "Malaysia" },
  { name: "T***", svc: "Facebook", cty: "Indonesia" },
];
const DEMO_PRICES = [1429, 1786, 2143, 2857, 3571, 4286, 5000, 6429, 7143, 9286, 10714];

const fmtRp = (n: number) => n.toLocaleString("id-ID");

/* =====================================================================
 * LOGO 3D KAKO NOKOS (dipakai di navbar landing)
 * ===================================================================== */
function BrandLogo({ large = false }: { large?: boolean }) {
  const box = large ? "w-12 h-12" : "w-9 h-9";
  const radius = large ? "rounded-2xl" : "rounded-xl";
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-shrink-0" style={{ perspective: 600 }}>
        {/* glow di belakang emblem */}
        <motion.div
          className="absolute inset-0 rounded-full blur-lg"
          style={{ background: "radial-gradient(circle, rgba(0,230,118,0.65) 0%, rgba(225,6,0,0.45) 70%, transparent 100%)" }}
          animate={{ opacity: [0.55, 0.95, 0.55], scale: [1, 1.25, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className={`relative ${box} ${radius} flex items-center justify-center shadow-2xl border border-white/25`}
          style={{ background: GRAD_EMBLEM, boxShadow: "0 12px 30px -6px rgba(225,6,0,0.65), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -6px 12px rgba(0,0,0,0.35)" }}
          whileHover={{ rotateY: 12, rotateX: -6, scale: 1.06 }}
          transition={{ type: "spring", stiffness: 300, damping: 16 }}
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-white drop-shadow" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12h2m16 0h2M8 12a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4 4z" />
          </svg>
          <span className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 rounded-full bg-[#00e676] border-2 border-[#0b0b0f]" />
        </motion.div>
      </div>
      <div className="leading-tight">
        <motion.p
          className={large ? "text-lg font-black tracking-tight" : "text-[15px] font-extrabold tracking-tight"}
          style={{
            backgroundImage: GRAD_BRAND,
            backgroundSize: "220% auto",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
            WebkitTextFillColor: "transparent",
          }}
          animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        >
          KAKO NOKOS
        </motion.p>
        <p className="text-[11px] text-zinc-400 tracking-[0.18em] uppercase">
          Toko Nomor Online
        </p>
      </div>
    </div>
  );
}

/** tombol solid (aksen hijau) dengan efek tekan 3D */
function AccentButton({
  children,
  onClick,
  className = "",
  glow = true,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
  glow?: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -2, scale: 1.02 }}
      whileTap={{ y: 2, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      className={`relative text-black font-bold hover:brightness-110 overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(180deg, #7dffc4 0%, ${ACCENT} 45%, #00b25a 100%)`,
        boxShadow: glow
          ? "0 10px 24px -6px rgba(0,230,118,0.5), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.18)"
          : "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -3px 6px rgba(0,0,0,0.2)",
      }}
    >
      {children}
    </motion.button>
  );
}

/** tombol outline/netral dengan efek tekan */
function GhostButton({
  children,
  onClick,
  className = "",
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ y: -1, scale: 1.01, backgroundColor: "rgba(255,255,255,0.07)" }}
      whileTap={{ y: 1, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      className={`border border-white/20 hover:bg-white/5 ${className}`}
    >
      {children}
    </motion.button>
  );
}

/* ------- ticker "pembelian terbaru" (demo visual) ------- */
function LivePurchaseStrip() {
  const [idx, setIdx] = useState(0);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIdx((v) => (v + 1) % DEMO_BUYERS.length);
      setStep((v) => v + 1);
    }, 4200);
    return () => clearInterval(id);
  }, []);

  const buyer = DEMO_BUYERS[idx];
  const price = DEMO_PRICES[(step + idx * 3) % DEMO_PRICES.length];
  const when =
    step % 3 === 0 ? "baru saja" : step % 3 === 1 ? "1 mnt lalu" : "2 mnt lalu";

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-black/30 backdrop-blur px-4 py-3 relative overflow-hidden max-w-md">
      {/* strip hijau berjalan di bawah */}
      <motion.div
        className="absolute bottom-0 left-0 h-[2px]"
        style={{ background: "linear-gradient(90deg, transparent, #00e676, transparent)" }}
        animate={{ width: ["0%", "100%"] }}
        transition={{ duration: 4.2, repeat: Infinity, ease: "linear" }}
      />
      <div className="flex items-center gap-2 text-[11px] font-bold tracking-wide mb-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
        </span>
        <span className="text-emerald-300">PEMBELIAN TERBARU</span>
        <span className="text-zinc-500 font-medium normal-case tracking-normal">(demo tampilan)</span>
      </div>
      <div className="min-h-[44px] flex items-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: -24, filter: "blur(3px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 24, filter: "blur(3px)" }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="flex w-full items-center gap-3"
          >
            <span className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 border border-emerald-400/30"
              style={{ background: "rgba(0,230,118,0.12)" }}>
              <ShoppingBag className="w-4 h-4 text-emerald-300" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-zinc-200 truncate">
                <b className="text-white">{buyer.name}</b> membeli nomor{" "}
                <b style={{ color: ACCENT }}>{buyer.svc}</b> · {buyer.cty}
              </p>
              <p className="text-[11px] text-zinc-500">{when} · otomatis masuk ke riwayat</p>
            </div>
            <span className="text-[13px] font-black whitespace-nowrap" style={{ color: ACCENT }}>
              +Rp {fmtRp(price)}
            </span>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

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
      {/* ===== latar: orbs 3D bergerak pelan ===== */}
      <motion.div
        className="pointer-events-none absolute -top-40 -left-32 w-[30rem] h-[30rem] rounded-full blur-3xl"
        style={{ backgroundColor: "rgba(225,6,0,0.28)" }}
        animate={{ x: [0, 70, 0], y: [0, 40, 0], scale: [1, 1.15, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute top-1/3 -right-36 w-[34rem] h-[34rem] rounded-full blur-3xl"
        style={{ backgroundColor: "rgba(0,230,118,0.16)" }}
        animate={{ x: [0, -60, 0], y: [0, -50, 0], scale: [1.1, 0.95, 1.1] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute bottom-0 left-1/3 w-72 h-72 rounded-full blur-3xl"
        style={{ backgroundColor: "rgba(255,200,87,0.10)" }}
        animate={{ y: [20, -30, 20] }}
        transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* ================= NAV ================= */}
      <header className="relative z-10 border-b border-white/10 bg-[#0b0b0f]/70 backdrop-blur-md sticky top-0">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-3">
          <BrandLogo />
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => openAuth("login")} className="px-4 py-2 rounded-xl text-sm font-semibold text-zinc-200">
              Masuk
            </GhostButton>
            <AccentButton onClick={() => openAuth("register")} className="px-4 py-2 rounded-xl text-sm">
              Daftar
            </AccentButton>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* ================= HERO ================= */}
        <section className="max-w-6xl mx-auto px-5 pt-14 pb-10 grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
          <div>
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold border border-red-500/30 bg-red-500/10 text-red-300"
            >
              <Sparkles className="w-3.5 h-3.5" /> Nomor virtual sekali pakai · LIVE dari server resmi
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="text-4xl md:text-[3.4rem] font-black mt-4 leading-[1.08] tracking-tight"
              style={{ textShadow: "0 10px 40px rgba(0,0,0,0.6)" }}
            >
              Verifikasi Akun{" "}
              <motion.span
                style={{
                  backgroundImage: "linear-gradient(92deg, #00e676, #7dffc4 60%, #00e676)",
                  backgroundSize: "200% auto",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                  WebkitTextFillColor: "transparent",
                }}
                animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
              >
                Tanpa Ribet
              </motion.span>
              ,
              <br />
              Harga <span style={{ color: RED, textShadow: "0 0 26px rgba(225,6,0,0.45)" }}>Jelas & Final</span>.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="text-zinc-400 text-[15px] mt-4 leading-relaxed max-w-lg"
            >
              KAKO NOKOS menjual nomor virtual untuk verifikasi WhatsApp, Telegram, Facebook, Google, dan ratusan
              layanan lain — lintas negara. Data negara, layanan, stok, dan harga <b className="text-zinc-200">langsung dari server resmi</b>, bukan daftar tempelan.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="flex flex-wrap gap-3 mt-6"
            >
              <AccentButton
                onClick={() => openAuth("register")}
                className="px-6 py-3.5 rounded-2xl text-sm flex items-center gap-2"
              >
                Daftar Gratis — Isi Saldo Pertama <ArrowRight className="w-4 h-4" />
              </AccentButton>
              <GhostButton
                onClick={() => openAuth("login")}
                className="px-6 py-3.5 rounded-2xl text-sm font-semibold text-white flex items-center gap-2"
              >
                <LogIn className="w-4 h-4" /> Saya sudah punya akun
              </GhostButton>
            </motion.div>

            {/* statistik hero */}
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.24 }}
              className="grid grid-cols-3 gap-3 mt-7 max-w-md"
            >
              {[
                {
                  key: totalCountries == null ? "…" : String(totalCountries),
                  label: "Negara (semua server)",
                  color: ACCENT,
                },
                { key: "24/7", label: "OTP dicek otomatis", color: ACCENT },
                { key: "0", label: "Biaya tersembunyi", color: RED },
              ].map((s) => (
                <div key={s.label}>
                  <motion.p
                    key={s.key}
                    initial={{ scale: 1.35, opacity: 0.6 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 18 }}
                    className="text-2xl font-black"
                    style={{ color: s.color, textShadow: `0 0 22px ${s.color}55` }}
                  >
                    {s.key}
                  </motion.p>
                  <p className="text-[11px] text-zinc-500 leading-snug mt-0.5">{s.label}</p>
                </div>
              ))}
            </motion.div>

            {/* ticker pembelian demo */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <LivePurchaseStrip />
            </motion.div>
          </div>

          {/* kartu mock 3D + hover gerak */}
          <motion.div
            style={{ perspective: 1200, transformStyle: "preserve-3d" }}
            initial={{ opacity: 0, y: 24, rotateY: -10, rotateX: 6 }}
            animate={{ opacity: 1, y: 0, rotateY: -10, rotateX: 6 }}
            whileHover={{ rotateY: 0, rotateX: 0, scale: 1.02 }}
            transition={{ type: "spring", stiffness: 120, damping: 16 }}
            className="mx-auto w-full max-w-md"
          >
            <motion.div
              animate={{ y: [0, -9, 0] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
              className="rounded-3xl border border-white/10 p-6 backdrop-blur"
              style={{
                background: "linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02) 50%, rgba(0,230,118,0.05))",
                boxShadow: "0 30px 60px -20px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.04) inset",
              }}
            >
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-bold flex items-center gap-2"><Globe className="w-4 h-4 text-red-500" /> Pilih Server</p>
                <motion.span
                  className="text-[11px] px-2 py-0.5 rounded-full font-bold"
                  style={{ backgroundColor: ACCENT, color: DARK, boxShadow: "0 0 16px rgba(0,230,118,0.6)" }}
                  animate={{ boxShadow: ["0 0 10px rgba(0,230,118,0.35)", "0 0 22px rgba(0,230,118,0.8)", "0 0 10px rgba(0,230,118,0.35)"] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  LIVE
                </motion.span>
              </div>
              <div className="flex flex-wrap gap-2">
                {SERVER_LIST.slice(0, 3).map((s, i) => (
                  <motion.span
                    key={s.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 + i * 0.08 }}
                    whileHover={{ y: -2, scale: 1.04 }}
                    className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-zinc-800 text-white border border-white/10 shadow-lg"
                  >
                    {s.label}
                  </motion.span>
                ))}
              </div>
              <div className="mt-4 rounded-2xl bg-zinc-950/80 border border-white/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[12px] text-zinc-400">Negara terpopuler</span>
                  <span className="text-[11px] text-zinc-500">indonesia 🇮🇩</span>
                </div>
                {[
                  { name: "WhatsApp", price: "Rp 1.429", stok: "stok 412" },
                  { name: "Telegram", price: "Rp 3.571", stok: "stok 208" },
                  { name: "Facebook", price: "Rp 1.786", stok: "stok 96" },
                ].map((s) => (
                  <motion.div
                    key={s.name}
                    whileHover={{ x: 4, backgroundColor: "rgba(255,255,255,0.04)" }}
                    className="flex items-center justify-between py-2 border-b border-white/5 last:border-0 rounded-lg px-1 -mx-1 transition-colors cursor-default"
                  >
                    <span className="text-[13px] text-white font-medium">{s.name}</span>
                    <span className="text-[12px] font-bold" style={{ color: ACCENT }}>
                      {s.price} <span className="text-zinc-600 font-normal">• {s.stok}</span>
                    </span>
                  </motion.div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2 text-[12px] text-zinc-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                Harga di layar = harga yang kamu bayar. Tidak ada markup rahasia.
              </div>
            </motion.div>
          </motion.div>
        </section>

        {/* ================= CARA KERJA ================= */}
        <section className="max-w-6xl mx-auto px-5 py-10">
          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            className="text-2xl md:text-3xl font-extrabold text-center"
          >
            Gimana Cara Kerjanya?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            className="text-zinc-500 text-sm text-center mt-2 max-w-xl mx-auto"
          >
            Sistem <b className="text-white">isi saldo (deposit)</b> — bukan bayar per transaksi. Lebih aman buat kamu.
          </motion.p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
            {[
              { icon: <Wallet className="w-6 h-6 text-red-500" />, step: "01", title: "Daftar & Isi Saldo", desc: "Buat akun gratis (email + password), lalu isi saldo lewat QR Paymentku. Saldo masuk otomatis begitu bayaran lunas." },
              { icon: <ShoppingCart className="w-6 h-6 text-red-500" />, step: "02", title: "Pilih & Beli Nomor", desc: "Pilih server, negara, dan layanan yang kamu butuhkan. Harga final langsung dipotong dari saldo — tidak ada biaya lain." },
              { icon: <PhoneIncoming className="w-6 h-6 text-red-500" />, step: "03", title: "OTP Otomatis Masuk", desc: "Kode OTP dicek otomatis sampai ketemu lalu tampil di riwayat. Gagal = saldo kembali otomatis." },
            ].map((c, i) => (
              <motion.div
                key={c.step}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ delay: i * 0.08 }}
                whileHover={{ y: -6, scale: 1.02 }}
                className="rounded-3xl border border-white/10 bg-zinc-900/50 p-6 relative overflow-hidden"
                style={{ boxShadow: "0 18px 40px -22px rgba(0,0,0,0.9)" }}
              >
                <span className="absolute -top-3 -right-1 text-[72px] font-black text-white/[0.04] select-none">{c.step}</span>
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4" style={{ background: "linear-gradient(140deg, rgba(225,6,0,0.28), rgba(225,6,0,0.08))", border: "1px solid rgba(225,6,0,0.25)" }}>
                  {c.icon}
                </div>
                <p className="font-bold text-lg">{c.title}</p>
                <p className="text-zinc-400 text-[13px] mt-2 leading-relaxed">{c.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ================= GARANSI & ATURAN ================= */}
        <section className="max-w-6xl mx-auto px-5 py-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              className="rounded-3xl border border-emerald-500/25 p-6"
              style={{ background: "linear-gradient(150deg, rgba(0,230,118,0.10), rgba(0,230,118,0.02))", boxShadow: "0 20px 50px -25px rgba(0,230,118,0.35), inset 0 0 40px rgba(0,230,118,0.04)" }}
            >
              <h3 className="text-lg font-bold flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" /> Kamu Tidak Akan Rugi
              </h3>
              <ul className="mt-4 space-y-3 text-[14px] text-zinc-300 leading-relaxed">
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /> Kalau order gagal dibuat server, <b>saldo dikembalikan otomatis</b>.</li>
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /> Kalau nomor tak kunjung dapat OTP, kamu bisa <b>batalkan & refund</b> — saldo balik utuh.</li>
                <li className="flex gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" /> Semua transaksi tercatat di <b>Riwayat</b> akun kamu.</li>
              </ul>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: 0.08 }}
              className="rounded-3xl border border-white/10 bg-zinc-900/50 p-6"
              style={{ boxShadow: "0 20px 50px -25px rgba(0,0,0,0.9)" }}
            >
              <h3 className="text-lg font-bold flex items-center gap-2">
                <Timer className="w-5 h-5 text-amber-400" /> Aturan Batalkan & Refund
              </h3>
              <ul className="mt-4 space-y-3 text-[14px] text-zinc-300 leading-relaxed">
                <li className="flex gap-2"><span className="text-amber-400 font-bold flex-shrink-0">1.</span> Pembatalan hanya bisa dilakukan <b>minimal 2 menit</b> setelah order dibuat.</li>
                <li className="flex gap-2"><span className="text-amber-400 font-bold flex-shrink-0">2.</span> Kalau <b>kode OTP sudah masuk</b>, order tidak bisa dibatalkan/direfund — nomor sudah terpakai.</li>
                <li className="flex gap-2"><span className="text-amber-400 font-bold flex-shrink-0">3.</span> Refund selalu kembali ke <b>saldo akun</b>, siap dipakai beli lagi.</li>
              </ul>
            </motion.div>
          </div>
        </section>

        {/* ================= FAQ & KEBIJAKAN ================= */}
        <section className="max-w-6xl mx-auto px-5 py-10">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-black">
              Tanya Jawab{" "}
              <motion.span
                style={{
                  backgroundImage: GRAD_BRAND,
                  backgroundSize: "220% auto",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                  WebkitTextFillColor: "transparent",
                }}
                animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              >
                & Aturan
              </motion.span>
            </h2>
            <p className="text-zinc-400 text-sm mt-2">Hal yang sering ditanyakan pembeli — biar tenang sebelum transaksi.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              {
                q: "Apakah harga di website sudah final?",
                a: "Ya. Harga yang tampil adalah harga yang kamu bayar (sudah termasuk layanan & biaya operasional). Tidak ada biaya tambahan diam-diam. Refund juga memakai harga yang sama persis.",
              },
              {
                q: "Berapa lama nomor & OTP sampai?",
                a: "Umumnya 1–2 menit setelah order dibuat. Sistem kami mengecek OTP ke server otomatis setiap ±20 detik sampai kodenya masuk (±10 menit), jadi kamu tidak perlu terus-terusan membuka halaman.",
              },
              {
                q: "Kalau OTP tidak kunjung masuk, bagaimana?",
                a: "Kalau sampai batas waktu tidak ada OTP, sistem membatalkan order dan mengembalikan saldo kamu otomatis ke akun — tidak ada yang hilang.",
              },
              {
                q: "Kapan saya bisa refund / batalkan order?",
                a: "Minimal 2 menit setelah order dibuat (untuk mencegah penyalahgunaan). Kalau kode OTP sudah masuk, order tidak bisa dibatalkan/direfund karena nomor sudah terpakai.",
              },
              {
                q: "Bagaimana cara isi saldo?",
                a: "Login → klik Isi Saldo → pilih nominal → bayar lewat QRIS Paymentku → saldo masuk otomatis ke akun dalam beberapa detik setelah pembayaran lunas.",
              },
              {
                q: "Apakah data & saldo saya aman?",
                a: "Password disimpan hanya di server (tidak pernah tampil di halaman atau dibagikan), semua transaksi tercatat di Riwayat akun, dan saldo hanya bisa dipakai di akunmu sendiri.",
              },
              {
                q: "Kenapa ada server/layanan yang tidak muncul?",
                a: "Kadang server provider sedang gangguan, stok habis, atau dimatikan sementara oleh admin. Coba pilih server lain atau buka lagi beberapa menit kemudian.",
              },
              {
                q: "Beli nomor untuk apa saja?",
                a: "Untuk menerima kode OTP verifikasi dari berbagai layanan (WhatsApp, Telegram, aplikasi, marketplace, dan lainnya) lintas negara — tergantung layanan yang tersedia di server.",
              },
            ].map((f, i) => (
              <details
                key={i}
                className="group rounded-2xl border border-white/10 bg-zinc-900/50 overflow-hidden transition-colors hover:border-white/20"
              >
                <summary className="list-none px-5 py-4 cursor-pointer flex items-center gap-3 select-none">
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[12px] font-black flex-shrink-0"
                    style={{ background: "rgba(225,6,0,0.14)", color: "#ff6b63", border: "1px solid rgba(225,6,0,0.25)" }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-semibold text-[14px] flex-1">{f.q}</span>
                  <motion.span
                    className="text-zinc-500 shrink-0"
                    animate={{ rotate: 0 }}
                  >
                    <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
                  </motion.span>
                </summary>
                <p className="px-5 pb-5 pl-[68px] text-[13px] text-zinc-400 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
          <p className="text-center text-[12px] text-zinc-600 mt-6">
            Butuh bantuan? Hubungi Customer Service kami setelah login — bantuan cepat & ramah.
          </p>
        </section>

        {/* ================= CTA ================= */}
        <section className="max-w-6xl mx-auto px-5 py-12 text-center">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            className="rounded-3xl p-10 md:p-14 relative overflow-hidden border border-white/10"
            style={{ background: "linear-gradient(135deg, rgba(225,6,0,0.20), rgba(11,11,15,0.7) 55%), #0b0b0f", boxShadow: "0 40px 90px -40px rgba(225,6,0,0.5)" }}
          >
            {/* kilau berjalan di atas CTA */}
            <motion.div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent, #00e676, #e10600, transparent)" }}
              animate={{ x: ["-100%", "100%"] }}
              transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
            />
            <h2 className="text-3xl md:text-4xl font-black">
              Siap Verifikasi{" "}
              <motion.span
                style={{
                  backgroundImage: GRAD_BRAND,
                  backgroundSize: "220% auto",
                  backgroundClip: "text",
                  WebkitBackgroundClip: "text",
                  color: "transparent",
                  WebkitTextFillColor: "transparent",
                }}
                animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              >
                Akun Kamu?
              </motion.span>
            </h2>
            <p className="text-zinc-400 text-sm mt-3 max-w-lg mx-auto">
              Daftar gratis, isi saldo sekali, dan langsung bisa beli nomor virtual dari ratusan layanan lintas negara.
            </p>
            <div className="flex flex-wrap justify-center gap-3 mt-6">
              <AccentButton
                onClick={() => openAuth("register")}
                className="px-7 py-3.5 rounded-2xl text-sm flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" /> Daftar Sekarang — Gratis
              </AccentButton>
              <GhostButton
                onClick={() => openAuth("login")}
                className="px-7 py-3.5 rounded-2xl text-sm font-semibold text-white"
              >
                Masuk
              </GhostButton>
            </div>
          </motion.div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 mt-6 py-6 text-center text-[12px] text-zinc-500">
        <p className="font-semibold tracking-wide" style={{ color: ACCENT }}>
          KAKO NOKOS
        </p>
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
  const [refCode, setRefCode] = useState("");
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
        const reg = await apiShopRegister({ email, password, fullName, refCode: refCode.trim() || undefined });
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
        initial={{ y: 60, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
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
            <motion.button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                setError(null);
              }}
              whileTap={{ scale: 0.95 }}
              className={`py-2 rounded-xl text-[13px] transition-all ${tabCls(mode === m.id)}`}
              style={mode === m.id ? { backgroundColor: ACCENT, boxShadow: "0 6px 16px -6px rgba(0,230,118,0.5)" } : {}}
            >
              {m.label}
            </motion.button>
          ))}
        </div>

        <p className="text-[12px] text-zinc-500 mb-4 leading-relaxed -mt-1">
          {mode === "login" && "Masuk untuk melihat saldo dan membeli nomor."}
          {mode === "register" && "Buat akun — saldo kamu tersimpan dan bisa diisi kapan saja."}
        </p>

        {mode !== "login" && (
          <>
            <label className="block mb-3">
              <span className="text-[12px] text-zinc-400 mb-1 block">Nama (opsional)</span>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nama kamu"
                className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
              />
            </label>
            <label className="block mb-3">
              <span className="text-[12px] text-zinc-400 mb-1 block">Kode undangan teman (opsional)</span>
              <input
                value={refCode}
                onChange={(e) => setRefCode(e.target.value.toUpperCase())}
                placeholder="cth: A7B3K9QP"
                autoComplete="off"
                className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none uppercase"
              />
            </label>
            <p className="text-[11px] text-emerald-300/90 leading-relaxed mb-4 flex gap-1.5 -mt-1">
              <Gift className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                Didaftarkan pakai kode undangan? Setelah <b>deposit pertamamu ≥ Rp 10.000</b>, kamu & temanmu
                masing-masing dapat <b>bonus Rp 5.000</b>.
              </span>
            </p>
          </>
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

        <motion.button
          onClick={submit}
          disabled={busy}
          whileTap={busy ? undefined : { scale: 0.96, y: 1 }}
          whileHover={busy ? undefined : { y: -1 }}
          className="w-full py-3.5 rounded-xl text-sm font-bold text-black hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2"
          style={{
            background: "linear-gradient(180deg, #7dffc4 0%, #00e676 45%, #00b25a 100%)",
            boxShadow: "0 12px 28px -8px rgba(0,230,118,0.55), inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -3px 6px rgba(0,0,0,0.18)",
          }}
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
        </motion.button>

        <p className="text-[11px] text-zinc-500 text-center mt-4 leading-relaxed">
          Nomor virtual untuk verifikasi WhatsApp, Telegram, dan lainnya. Isi saldo lalu beli — harga yang tampil
          itulah yang dibayar.
        </p>
      </motion.div>
    </motion.div>
  );
}
