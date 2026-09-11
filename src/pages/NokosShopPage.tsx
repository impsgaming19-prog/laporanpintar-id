import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShoppingCart,
  History,
  Zap,
  ShieldCheck,
  PhoneIncoming,
  ArrowRight,
  Wallet,
  ChevronDown,
  Globe,
  Search,
  ArrowRightCircle,
  QrCode,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
  LogOut,
  LogIn,
  UserPlus,
  Settings,
  Users,
  BarChart3,
  Server,
  UserCog,
  Timer,
  Ban,
  Trash2,
  Plus,
  Minus,
  KeyRound,
  Gift,
  Ticket,
  Info,
  MessageCircle,
  Send,
  Bot,
  Headset,
} from "lucide-react";

import {
  apiCreatePayment,
  apiAdminAdjustBalance,
  apiAdminDeposits,
  apiAdminListUsers,
  apiAdminOrders,
  apiAdminRefundOrder,
  apiAdminStats,
  apiGetOrderStatus,
  apiListCountries,
  apiListCountriesMeta,
  apiListServices,
  apiShopBuyWithBalance,
  apiShopCancelOrder,
  apiShopCheckMyOrder,
  apiShopCreateStaff,
  apiShopDeleteStaff,
  apiShopDepositCreate,
  apiShopDepositPoll,
  apiShopGetSettings,
  apiShopLogin,
  apiShopOrders,
  apiShopRecordOtp,
  apiMyReferral,
  apiPromoRedeem,
  apiShopRegister,
  apiShopRegisterOwner,
  apiShopSetServerEnabled,
  apiShopWallet,
  apiGetPaymentConfig,
  apiManualDepositCreate,
  computeSellPrice,
  formatRupiah,
  type AdminDeposit,
  type AdminOrder,
  type AdminStats,
  type AdminUser,
  type Country,
  type PayMethod,
  type ProviderId,
  type Service,
  type ShopOrder,
  apiSupportMyThread,
  apiSupportSend,
  type ShopUser,
  type SupportMessage,
} from "@/lib/convexApi";
import {
  AdminDepositTab,
  CustomerAdminTab as CustomerAdminTabPanel,
} from "@/pages/adminBits";
import { LandingPage as ShopLanding } from "@/pages/shopLanding";
import { AdminHub } from "@/pages/adminHub";

/* ---------- brand ---------- */
const RED = "#e10600";
const DARK = "#0b0b0f";
const ACCENT = "#00e676";

const SESSION_KEY = "kakonokos_session";

type Session = { user: ShopUser };

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s && s.user && s.user.id) return s as Session;
    return null;
  } catch {
    return null;
  }
}

type ServerDef = {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  description: string;
  badge: string | null;
};

/**
 * Nama server yang dilihat customer. Sengaja TIDAK menyebut nama provider/API
 * supaya pembeli tidak menembak langsung ke sumbernya. Nama provider tetap
 * tersimpan di data order (kolom provider/providerLabel) untuk panel Owner.
 */
const SERVER_LIST: ServerDef[] = [
  {
    id: "jasav1",
    label: "Server v1",
    provider: "kirimkode",
    providerLabel: "Pilihan terlengkap",
    description:
      "Pilihan negara & layanan paling lengkap, harga mulai Rp 250-an. Pakai ini kalau bingung mau pilih yang mana.",
    badge: "Populer",
  },
  {
    id: "jasav2",
    label: "Server v2",
    provider: "kirimkode_alt",
    providerLabel: "Stok alternatif",
    description:
      "Server cadangan kalau stok atau layanan di Server v1 sedang habis. Caranya sama, nomor tetap dikirim otomatis.",
    badge: null,
  },
  {
    id: "jasav3",
    label: "Server v3",
    provider: "kirimkode",
    providerLabel: "Cadangan",
    description:
      "Cadangan jalur utama, supaya pembelian tetap jalan saat server lain ramai.",
    badge: null,
  },
  {
    id: "jasav4",
    label: "Server v4",
    provider: "kirimkode_alt",
    providerLabel: "Cadangan",
    description:
      "Pilihan terakhir kalau server lain sedang gangguan. Saldo tetap aman — gagal order = saldo kembali otomatis.",
    badge: "Cadangan",
  },
];

const roleMeta: Record<string, { label: string; cls: string }> = {
  owner: { label: "OWNER", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  cs: { label: "CS", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  customer: { label: "Customer", cls: "bg-white/5 text-zinc-300 border-white/10" },
};

const CANCEL_MIN_SECONDS = 120;

/** Jumlah maksimal chip negara yang dirender sekaligus (daftar bisa 90+ negara). */
const MAX_COUNTRY_CHIPS = 90;

type PayPhase = "idle" | "processing" | "waitingOtp" | "success" | "error";

const DEPOSIT_PRESETS = [10000, 25000, 50000, 100000, 250000, 500000];

/* =====================================================================
 * SHEET ISI SALDO — QR Paymentku (otomatis) + Isi Manual (QR/Bank/E-Wallet)
 * ===================================================================== */
function DepositSheet({
  open,
  userId,
  initialAmount,
  onClose,
  onBalance,
}: {
  open: boolean;
  userId: string;
  initialAmount?: number;
  onClose: () => void;
  onBalance: (balance: number) => void;
}) {
  const [amount, setAmount] = useState(initialAmount && initialAmount >= 5000 ? initialAmount : 25000);
  const [cfg, setCfg] = useState<{ paykuEnabled: boolean; methods: PayMethod[] } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refId, setRefId] = useState<string | null>(null);
  const [manualId, setManualId] = useState<string | null>(null);
  const [manualNote, setManualNote] = useState("");
  const pollingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setAmount(initialAmount && initialAmount >= 5000 ? initialAmount : 25000);
    setStatus(null);
    setError(null);
    setRefId(null);
    setManualId(null);
    setManualNote("");
    setBusy(false);
    let cancelled = false;
    apiGetPaymentConfig()
      .then((r) => {
        if (!cancelled) setCfg({ paykuEnabled: r.paykuEnabled !== false, methods: r.methods || [] });
      })
      .catch(() => {
        if (!cancelled) setCfg({ paykuEnabled: true, methods: [] });
      });
    return () => {
      cancelled = true;
      pollingRef.current = false;
    };
  }, [open, initialAmount]);

  const startQris = async () => {
    setBusy(true);
    setError(null);
    setStatus("Membuat QR pembayaran...");
    try {
      const inv = await apiShopDepositCreate(userId, amount);
      if (!inv.ok || !inv.payUrl || !inv.referenceId) {
        setError(inv.error || "Gagal membuat QR deposit.");
        setStatus(null);
        return;
      }
      setRefId(inv.referenceId);
      try {
        window.open(inv.payUrl, "_blank", "noopener");
      } catch {
        /* popup diblokir — pengguna tetap bisa buka manual */
      }
      setStatus(`QR deposit dibuka di tab baru (Ref: ${inv.referenceId}). Bayar Rp ${formatRupiah(inv.amount || amount)} — saldo masuk otomatis begitu lunas.`);
      pollingRef.current = true;
      for (let i = 0; i < 30 && pollingRef.current; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const st = await apiShopDepositPoll(inv.referenceId).catch(() => null);
        if (!st) continue;
        if (st.paid) {
          pollingRef.current = false;
          setStatus("Pembayaran diterima — saldo sudah masuk ke akun kamu. 🎉");
          if (st.balance != null) onBalance(st.balance);
          break;
        }
      }
      if (pollingRef.current) {
        pollingRef.current = false;
        setStatus("Waktu cek habis. Kalau sudah membayar, tekan 'Cek Pembayaran Lagi'.");
      }
    } catch (err: any) {
      pollingRef.current = false;
      setError(err?.message || "Gagal membuat QR deposit.");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    if (!refId) return;
    setBusy(true);
    setError(null);
    setStatus("Mengecek pembayaran...");
    const st = await apiShopDepositPoll(refId).catch(() => null);
    if (st?.paid) {
      setStatus("Pembayaran diterima — saldo sudah masuk ke akun kamu. 🎉");
      if (st.balance != null) onBalance(st.balance);
    } else {
      setStatus("Belum terdeteksi lunas. Pastikan QR sudah dibayar, lalu coba lagi.");
    }
    setBusy(false);
  };

  const submitManual = async () => {
    const method = cfg?.methods.find((m) => m.id === manualId);
    if (!method) {
      setError("Pilih metode pembayaran dulu.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const res = await apiManualDepositCreate(userId, amount, method.id, manualNote.trim() || undefined);
      if (!res.ok || !res.referenceId) {
        setError(res.error || "Gagal mengirim konfirmasi. Coba lagi.");
        return;
      }
      setManualId(null);
      setManualNote("");
      setStatus(
        `Konfirmasi terkirim (Ref: ${res.referenceId}). Pembayaran Rp ${formatRupiah(res.amount || amount)} lewat ${res.methodLabel || method.label} akan dicek admin/CS — saldo masuk setelah disetujui. Kalau lama, hubungi CS.`
      );
    } catch (err: any) {
      setError(err?.message || "Gagal mengirim konfirmasi.");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-t-3xl sm:rounded-3xl p-6 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Wallet className="w-5 h-5" style={{ color: ACCENT }} /> Isi Saldo
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400">
            ✕
          </button>
        </div>

        <p className="text-[13px] text-zinc-400 mb-4 leading-relaxed">
          Pilih nominal, lalu bayar via <b className="text-white">QRIS</b> (saldo masuk otomatis) atau{" "}
          <b className="text-white">Isi Manual QR / Bank / E-Wallet</b> (dikonfirmasi admin/CS sebelum saldo masuk).
        </p>

        {!cfg && (
          <p className="text-[13px] text-zinc-400 mb-3 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Memuat pilihan pembayaran...
          </p>
        )}

        {status && (
          <p className="text-[13px] text-zinc-300 leading-relaxed mb-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">{status}</p>
        )}
        {error && (
          <p className="text-[13px] text-red-300 leading-relaxed mb-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
        )}

        <div className="grid grid-cols-3 gap-2 mb-4">
          {DEPOSIT_PRESETS.map((nominal) => (
            <button
              key={nominal}
              onClick={() => setAmount(nominal)}
              className={`rounded-xl px-2 py-3 text-sm font-semibold transition-all border ${
                amount === nominal ? "border-red-500 bg-red-600/10 text-white" : "border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Rp {formatRupiah(nominal)}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mb-5">
          <span className="text-[13px] text-zinc-400">Rp</span>
          <input
            type="number"
            min={5000}
            step={1000}
            value={amount}
            onChange={(e) => setAmount(Math.max(5000, Number(e.target.value) || 0))}
            className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm focus:border-red-500 focus:outline-none"
          />
        </div>

        {cfg && cfg.paykuEnabled && (
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 mb-3">
            <p className="text-[13px] font-bold text-white flex items-center gap-2 mb-1">
              <QrCode className="w-4 h-4" style={{ color: ACCENT }} /> QRIS — otomatis
            </p>
            <p className="text-[12px] text-zinc-400 mb-3">Begitu pembayaran lunas, saldo langsung masuk tanpa konfirmasi.</p>
            <div className="flex gap-2">
              <button
                onClick={startQris}
                disabled={busy || amount < 5000}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-black hover:brightness-95 disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ backgroundColor: ACCENT }}
              >
                {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</> : <><QrCode className="w-4 h-4" /> Buat QR & Isi Saldo</>}
              </button>
              {refId && !busy && (
                <button onClick={checkAgain} className="px-4 py-3 rounded-xl text-sm font-semibold border border-white/15 text-zinc-200 hover:bg-white/5 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Cek Lagi
                </button>
              )}
            </div>
          </div>
        )}

        {cfg && cfg.methods.length > 0 && (
          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4">
            <p className="text-[13px] font-bold text-white flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4" style={{ color: ACCENT }} /> Isi Manual (QR/Bank/E-Wallet)
            </p>
            <div className="flex flex-wrap gap-2 mb-3">
              {cfg.methods.map((m) => {
                const active = manualId === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      setManualId(active ? null : m.id);
                      setError(null);
                      setStatus(null);
                    }}
                    className={`px-3 py-2 rounded-xl text-[12.5px] font-semibold border transition-all ${active ? "text-black" : "border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}
                    style={active ? { backgroundColor: ACCENT } : {}}
                  >
                    {m.type === "qr" ? "◈ QR" : m.type === "bank" ? "🏦 Bank" : "📱 E-Wallet"} · {m.label}
                  </button>
                );
              })}
            </div>

            {(() => {
              const m = cfg.methods.find((x) => x.id === manualId);
              if (!m) return null;
              return (
                <div className="space-y-3">
                  <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
                    {m.imageUrl ? (
                      <div className="flex justify-center mb-2">
                        <img src={m.imageUrl} alt="QR" className="w-40 h-40 object-contain rounded-lg bg-white p-1" />
                      </div>
                    ) : null}
                    <p className="text-[12px] text-zinc-400">
                      {m.type === "qr" ? "Scan / bayar ke QR ini" : m.type === "bank" ? "Transfer ke rekening:" : "Bayar ke E-Wallet:"}
                    </p>
                    {m.accountNo ? (
                      <p className="text-[15px] font-black text-white tracking-wide select-all mt-0.5">{m.accountNo}</p>
                    ) : null}
                    <p className="text-[12px] text-zinc-400 mt-0.5">a.n. {m.accountName}</p>
                    {m.accountNo ? (
                      <button
                        onClick={() => {
                          try {
                            navigator.clipboard.writeText(m.accountNo);
                          } catch {
                            /* ignore */
                          }
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/15 text-zinc-200 hover:bg-white/5"
                      >
                        <Copy className="w-3.5 h-3.5" /> Salin Nomor
                      </button>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    placeholder="Nama pengirim / catatan (opsional, biar cepat dicek)"
                    className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
                  />
                  <button
                    onClick={submitManual}
                    disabled={busy || amount < 5000}
                    className="w-full py-3 rounded-xl text-sm font-bold text-black hover:brightness-95 disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ backgroundColor: ACCENT }}
                  >
                    {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Mengirim...</> : <><CheckCircle2 className="w-4 h-4" /> Saya sudah bayar — minta saldo masuk</>}
                  </button>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    Setelah kamu kirim, admin/CS mencocokkan pembayaran lalu menekan Terima — saldo masuk ke akunmu.
                  </p>
                </div>
              );
            })()}
          </div>
        )}

        {cfg && !cfg.paykuEnabled && cfg.methods.length === 0 && (
          <p className="text-[13px] text-zinc-400 leading-relaxed rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            Pembayaran sedang dinonaktifkan sementara. Hubungi CS untuk isi saldo.
          </p>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ===================================================================== */
export default function NokosShopPage() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- visibilitas server (dari Panel Admin Owner) ---------- */
  const [serverVisibility, setServerVisibility] = useState<Record<string, boolean>>({});
  const visibleServers = useMemo(
    () => SERVER_LIST.filter((s) => serverVisibility[s.id] !== false),
    [serverVisibility]
  );

  const [selectedServerId, setSelectedServerId] = useState<string>(SERVER_LIST[0].id);
  const server =
    visibleServers.find((s) => s.id === selectedServerId) || visibleServers[0] || null;

  const [countries, setCountries] = useState<Country[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedCountryId, setSelectedCountryId] = useState<number | string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<number | string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataFallback, setDataFallback] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [serviceQuery, setServiceQuery] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [totalCountries, setTotalCountries] = useState<number | null>(null);

  /* ---------- buy overlay ---------- */
  const [payPhase, setPayPhase] = useState<PayPhase>("idle");
  const buyRunRef = useRef(false);
  const [payMessage, setPayMessage] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [resultOtp, setResultOtp] = useState<string | null>(null);
  const [resultOrderId, setResultOrderId] = useState<string | null>(null);
  const [resultPhone, setResultPhone] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);

  /* ---------- deposit modal ---------- */
  const [depositOpen, setDepositOpen] = useState(false);
  // Sheet isi saldo baru (Paymentku + Isi Manual). depositOpen lama tidak dipakai lagi.
  const [depositSheetOpen, setDepositSheetOpen] = useState(false);
  const [depositSheetAmount, setDepositSheetAmount] = useState(25000);
  /* ---------- panel Hubungi CS ---------- */
  const [supportOpen, setSupportOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState(25000);
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositStatus, setDepositStatus] = useState<string | null>(null);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositRef, setDepositRef] = useState<string | null>(null);
  const depositPolling = useRef(false);

  /* ---------- metode pembayaran (Paymentku + isi manual) ---------- */
  const [payConfig, setPayConfig] = useState<{ paykuEnabled: boolean; methods: PayMethod[] } | null>(null);
  const [manualMethodId, setManualMethodId] = useState<string | null>(null);
  const [manualNote, setManualNote] = useState("");
  const [manualBusy, setManualBusy] = useState(false);

  /* ---------- muat pengaturan pembayaran & reset tiap buka modal ---------- */
  useEffect(() => {
    if (!depositOpen) return;
    let cancelled = false;
    setDepositError(null);
    setDepositStatus(null);
    setDepositRef(null);
    setManualMethodId(null);
    setManualNote("");
    apiGetPaymentConfig()
      .then((r) => {
        if (cancelled) return;
        setPayConfig({
          paykuEnabled: r.paykuEnabled !== false,
          methods: r.methods || [],
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Kalau gagal dibaca, tetap tampilkan Paymentku (perilaku lama) biar tidak macet.
        setPayConfig({ paykuEnabled: true, methods: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [depositOpen]);

  /* ---------- kode promo / voucher & referral ---------- */
  const [promoCode, setPromoCode] = useState("");
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [refInfo, setRefInfo] = useState<{ refCode: string; referredBy: string; referralBonusAt: number | null } | null>(null);

  /* ---------- panel admin (owner/cs) ---------- */
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminHubOpen, setAdminHubOpen] = useState(false);
  const [adminTab, setAdminTab] = useState<"ringkasan" | "customer" | "transaksi" | "deposit" | "staff" | "server">("ringkasan");
  const [adminStatsData, setAdminStatsData] = useState<AdminStats | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminOrdersData, setAdminOrdersData] = useState<AdminOrder[]>([]);
  const [adminDepositsData, setAdminDepositsData] = useState<AdminDeposit[]>([]);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminMsg, setAdminMsg] = useState<string | null>(null);

  /* ---------- cancel/refund ---------- */
  const [cancelTarget, setCancelTarget] = useState<ShopOrder | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const ordersRef = useRef<ShopOrder[]>([]);
  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const selectedService = useMemo(() => {
    if (selectedServiceId == null) return null;
    return services.find((s) => String(s.service ?? s.id) === String(selectedServiceId)) || null;
  }, [services, selectedServiceId]);

  const sellPrice = useMemo(() => {
    if (!selectedService) return 0;
    // Harga jual datang dari backend (satu sumber angka); fallback hitung lokal.
    return selectedService.sellPrice ?? computeSellPrice(selectedService.price);
  }, [selectedService]);

  const visibleCountries = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => String(c.name || "").toLowerCase().includes(q));
  }, [countries, countryQuery]);

  const visibleServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => {
      const name = String(s.name || "");
      const code = String(s.service ?? s.id ?? "");
      return name.toLowerCase().includes(q) || code.toLowerCase().includes(q);
    });
  }, [services, serviceQuery]);

  const showNotice = (text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 4500);
  };

  /* ---------- muat ulang wallet + riwayat ---------- */
  const refreshWalletOrders = async (userId: string) => {
    const [w, o] = await Promise.all([
      apiShopWallet(userId).catch(() => null),
      apiShopOrders(userId).catch(() => null),
    ]);
    if (w?.ok && w.wallet) setWalletBalance(w.wallet.balance);
    if (o?.ok && o.orders) setOrders(o.orders);
  };

  useEffect(() => {
    if (!session) {
      setWalletBalance(null);
      setOrders([]);
      return;
    }
    setOrdersLoading(true);
    refreshWalletOrders(session.user.id).finally(() => setOrdersLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  /* ---------- muat pengaturan server (visibilitas) ---------- */
  useEffect(() => {
    let cancelled = false;
    apiShopGetSettings()
      .then((r) => {
        if (!cancelled && r.ok && r.servers) setServerVisibility(r.servers);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [adminOpen]);

  /* kalau server yang dipilih disembunyikan owner, pindah otomatis */
  useEffect(() => {
    if (visibleServers.length === 0) return;
    if (!visibleServers.some((s) => s.id === selectedServerId)) {
      setSelectedServerId(visibleServers[0].id);
    }
  }, [visibleServers, selectedServerId]);

  /* ---------- total negara semua server (statistik hero) ---------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ids: ProviderId[] = ["kirimkode", "kirimkode_alt"];
      const lists = await Promise.all(ids.map((id) => apiListCountries(id).catch(() => [] as Country[])));
      if (cancelled) return;
      const seen = new Set<string>();
      for (const list of lists) for (const c of list) seen.add(String(c.name || "").trim().toLowerCase());
      setTotalCountries(seen.size > 0 ? seen.size : null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- ambil negara per server ---------- */
  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    setCountries([]);
    setServices([]);
    setSelectedCountryId(null);
    setSelectedServiceId(null);
    setDataError(null);
    setDataFallback(false);
    setCountryQuery("");
    setServiceQuery("");

    const load = async () => {
      setLoadingData(true);
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const meta = await apiListCountriesMeta(server.provider, server.label);
          const list = meta.countries;
          if (cancelled) return;
          if (list.length === 0) {
            if (!cancelled) setLoadingData(false);
            setDataError("Server tidak mengembalikan daftar negara (kosong).");
            return;
          }
          setDataFallback(meta.viaFallback);
          setCountries(list);
          const first = list.find((c) => c.id != null) || list[0];
          setSelectedCountryId(first.id);
          if (!cancelled) setLoadingData(false);
          return;
        } catch (err: any) {
          lastErr = err;
          if (!cancelled && attempt < 2) {
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
      }
      if (!cancelled && lastErr) {
        setDataError(lastErr?.message || "Gagal terhubung ke server provider.");
      }
      if (!cancelled) setLoadingData(false);
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server?.id, reloadToken]);

  /* ---------- ambil layanan saat negara berubah ---------- */
  useEffect(() => {
    if (!server || selectedCountryId == null) return;
    let cancelled = false;
    setServices([]);
    setSelectedServiceId(null);
    setServiceQuery("");
    setLoadingData(true);

    const load = async () => {
      // Negara dari KirimKode datang dari node tertentu (api1..api10); layanan
      // harus diminta ke node yang sama supaya data & harga cocok.
      const node = countries.find((c) => String(c.id) === String(selectedCountryId))?.server || undefined;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const list = await apiListServices(server.provider, selectedCountryId, node, server.label);
          if (cancelled) return;
          setServices(list);
          if (list.length > 0) {
            const first = list[0];
            setSelectedServiceId(first.service ?? first.id);
          }
          if (!cancelled) setLoadingData(false);
          return;
        } catch (err: any) {
          lastErr = err;
          if (!cancelled && attempt < 2) {
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
      }
      if (!cancelled && lastErr) {
        setDataError(lastErr?.message || "Gagal mengambil daftar layanan.");
      }
      if (!cancelled) setLoadingData(false);
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCountryId, server?.id]);

  /* ---------- auth helpers ---------- */
  const applySession = (user: ShopUser) => {
    const s: Session = { user };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
    setSession(s);
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setSession(null);
    closePaySheet();
    setAdminOpen(false);
  };

  const closePaySheet = () => {
    buyRunRef.current = false;
    setPayPhase("idle");
    setPayMessage(null);
    setPayError(null);
    setResultOtp(null);
    setResultOrderId(null);
    setResultPhone(null);
    setPayAmount(0);
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  /* ---------- kode promo / voucher & referral ---------- */
  const refreshRef = async () => {
    if (!session) return;
    try {
      const r = await apiMyReferral(session.user.id);
      if (r.ok && r.refCode) {
        setRefInfo({ refCode: r.refCode, referredBy: r.referredBy || "", referralBonusAt: r.referralBonusAt ?? null });
      }
    } catch {
      /* ignore */
    }
  };

  const redeemCode = async () => {
    if (!session) return;
    const code = promoCode.trim();
    if (!code) {
      setPromoMsg({ kind: "err", text: "Masukkan kode promo dulu." });
      return;
    }
    setPromoBusy(true);
    setPromoMsg(null);
    try {
      const r = await apiPromoRedeem(session.user.id, code);
      if (r.ok) {
        setPromoCode("");
        setPromoMsg({ kind: "ok", text: `Kode ${code} berhasil ditukar — +Rp ${formatRupiah(r.nominal || 0)} masuk ke saldo kamu!` });
        if (r.balance != null) setWalletBalance(r.balance);
        await refreshWalletOrders(session.user.id);
      } else {
        setPromoMsg({ kind: "err", text: r.error || "Kode tidak bisa ditukar." });
      }
    } catch (err: any) {
      setPromoMsg({ kind: "err", text: err?.message || "Gagal menukar kode." });
    } finally {
      setPromoBusy(false);
    }
  };

  useEffect(() => {
    if (session) refreshRef();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const statusMeta = (status: string): { label: string; cls: string } => {
    if (status === "done" || status === "otp") return { label: "OTP masuk", cls: "bg-emerald-500/15 text-emerald-400" };
    if (status === "ordered") return { label: "Menunggu OTP", cls: "bg-amber-500/15 text-amber-400" };
    if (status === "refunded") return { label: "Dikembalikan", cls: "bg-sky-500/15 text-sky-400" };
    return { label: "Gagal", cls: "bg-red-500/15 text-red-400" };
  };

  /* =====================================================================
   * BELI NOMOR (potong saldo; gagal = refund otomatis; OTP disimpan)
   * ===================================================================== */
  const handleBuy = async () => {
    if (!session || !selectedService || selectedCountryId == null || !server) {
      setPayError("Pilih layanan dulu.");
      setPayPhase("error");
      return;
    }
    const bal = walletBalance ?? 0;
    if (bal < sellPrice) {
      setDepositAmount(Math.max(5000, sellPrice));
      setDepositSheetAmount(Math.max(5000, sellPrice));
      setDepositSheetOpen(true);
      setPayError(`Saldo kamu Rp ${formatRupiah(bal)}, kurang untuk layanan ini (Rp ${formatRupiah(sellPrice)}). Silakan isi saldo dulu.`);
      setPayPhase("error");
      return;
    }

    buyRunRef.current = true;
    setPayPhase("processing");
    setPayError(null);
    setPayAmount(sellPrice);
    setPayMessage("Memotong saldo & memesan nomor dari server provider...");

    try {
      const res = await apiShopBuyWithBalance({
        userId: session.user.id,
        provider: server.provider,
        country: selectedCountryId,
        service: selectedService.service ?? selectedService.id!,
        providerPrice: selectedService.price,
        countryName: countries.find((c) => String(c.id) === String(selectedCountryId))?.name,
        serviceName: selectedService.name ?? undefined,
        server: countries.find((c) => String(c.id) === String(selectedCountryId))?.server ?? undefined,
        serverLabel: server.label,
      });
      if (!res.ok || !res.orderId) {
        if (res.refunded && session) await refreshWalletOrders(session.user.id);
        setPayPhase("error");
        setPayError(
          res.error || "Gagal memesan nomor. Kalau saldo sudah terpotong, saldo dikembalikan otomatis."
        );
        return;
      }

      if (res.balance != null) setWalletBalance(res.balance);
      setResultOrderId(res.orderId);
      if (res.number) setResultPhone(res.number);
      setPayPhase("waitingOtp");
      setPayMessage(
        res.number
          ? `✅ Nomor kamu: ${res.number} — pakai nomor ini untuk verifikasi, lalu tunggu OTP masuk (±1–5 menit).`
          : "Nomor dipesan! Menunggu OTP masuk (bisa ±1–5 menit)..."
      );

      // Polling OTP (maks ±2 menit di layar ini)
      let otp: string | null = null;
      let phone: string | null = null;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const st = await apiGetOrderStatus(server.provider, res.orderId).catch(() => null);
        if (st?.code != null && st.code !== "") {
          otp = String(st.code);
          break;
        }
        const raw = (st?.raw as any)?.data as any;
        if (raw && (raw.phone || raw.phone_number || raw.number)) {
          phone = String(raw.phone || raw.phone_number || raw.number);
        }
      }
      if (!buyRunRef.current) return; // customer menutup layar saat menunggu — jangan paksa muncul lagi
      setResultOtp(otp);
      if (phone) setResultPhone(phone);
      setPayPhase(otp ? "success" : "error");
      if (otp) {
        // Simpan ke riwayat: otp tersimpan -> status berubah & tidak bisa di-cancel.
        await apiShopRecordOtp(session.user.id, res.orderId, otp).catch(() => {});
        setPayMessage("OTP masuk! Salin kode dan selesaikan verifikasi akun kamu.");
      } else {
        setPayError(`Order ${res.orderId} dibuat tapi OTP belum masuk. Nomor aktif ±20 menit — tekan \"Cek OTP Lagi\" atau gunakan tombol \"Periksa OTP\" di Riwayat.`);
      }
      if (session) await refreshWalletOrders(session.user.id);
    } catch (err: any) {
      setPayPhase("error");
      setPayError(err?.message || "Terjadi kesalahan saat proses pembelian.");
    }
  };

  const handleCheckOtp = async () => {
    if (!resultOrderId || !session) return;
    setPayMessage("Mengecek OTP...");
    const st = await apiGetOrderStatus(server?.provider || "kirimkode", resultOrderId, server?.label).catch(() => null);
    if (st?.code != null && st.code !== "") {
      const otp = String(st.code);
      setResultOtp(otp);
      setPayPhase("success");
      setPayMessage("OTP masuk! Salin kode dan selesaikan verifikasi akun kamu.");
      await apiShopRecordOtp(session.user.id, resultOrderId, otp).catch(() => {});
      if (session) await refreshWalletOrders(session.user.id);
    } else {
      setPayError("OTP belum masuk. Nomor aktif ±20 menit; coba lagi beberapa saat.");
    }
  };

  /* =====================================================================
   * DEPOSIT (isi saldo via QR Paymentku, masuk otomatis)
   * ===================================================================== */
  const startDeposit = async () => {
    if (!session) return;
    setDepositBusy(true);
    setDepositError(null);
    setDepositStatus("Membuat invoice pembayaran QR...");
    try {
      const inv = await apiShopDepositCreate(session.user.id, depositAmount);
      if (!inv.ok || !inv.payUrl || !inv.referenceId) {
        setDepositError(inv.error || "Gagal membuat QR deposit.");
        setDepositStatus(null);
        return;
      }
      setDepositRef(inv.referenceId);
      try {
        window.open(inv.payUrl, "_blank", "noopener");
      } catch {
        /* popup blocked */
      }
      setDepositStatus(
        `QR deposit dibuka di tab baru. Bayar Rp ${formatRupiah(inv.amount || depositAmount)} lalu tunggu — saldo masuk otomatis (Ref: ${inv.referenceId}).`
      );

      depositPolling.current = true;
      for (let i = 0; i < 30 && depositPolling.current; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const st = await apiShopDepositPoll(inv.referenceId).catch(() => null);
        if (!st) continue;
        if (st.paid) {
          setWalletBalance(st.balance ?? 0);
          setDepositStatus("Pembayaran diterima — saldo sudah masuk ke akun kamu. 🎉");
          depositPolling.current = false;
          break;
        }
      }
      if (depositPolling.current) {
        depositPolling.current = false;
        setDepositStatus("Waktu cek habis. Kalau sudah membayar, tekan 'Cek Pembayaran Lagi'.");
      }
    } catch (err: any) {
      depositPolling.current = false;
      setDepositError(err?.message || "Gagal membuat QR deposit.");
      setDepositStatus(null);
    } finally {
      setDepositBusy(false);
    }
  };

  const checkDepositAgain = async () => {
    if (!depositRef) return;
    setDepositBusy(true);
    setDepositError(null);
    setDepositStatus("Mengecek pembayaran...");
    const st = await apiShopDepositPoll(depositRef).catch(() => null);
    if (st?.paid) {
      setWalletBalance(st.balance ?? 0);
      setDepositStatus("Pembayaran diterima — saldo sudah masuk ke akun kamu. 🎉");
    } else {
      setDepositStatus("Belum terdeteksi lunas. Pastikan QR sudah dibayar, lalu coba lagi.");
    }
    setDepositBusy(false);
  };

  /* ---------- isi saldo MANUAL (QR/Bank/E-Wallet, menunggu konfirmasi admin) ---------- */
  const submitManualDeposit = async () => {
    if (!session || !manualMethodId) return;
    const method = payConfig?.methods.find((m) => m.id === manualMethodId);
    if (!method) {
      setDepositError("Pilih metode pembayaran dulu.");
      return;
    }
    setManualBusy(true);
    setDepositError(null);
    setDepositStatus(null);
    try {
      const res = await apiManualDepositCreate(session.user.id, depositAmount, method.id, manualNote.trim() || undefined);
      if (!res.ok || !res.referenceId) {
        setDepositError(res.error || "Gagal mengirim konfirmasi. Coba lagi.");
        return;
      }
      setManualMethodId(null);
      setManualNote("");
      setDepositStatus(
        `Konfirmasi terkirim (Ref: ${res.referenceId}). Pembayaran Rp ${formatRupiah(res.amount || depositAmount)} lewat ${res.methodLabel || method.label} akan dicek admin/CS — saldo masuk setelah disetujui. Kalau lama, hubungi CS.`
      );
    } catch (err: any) {
      setDepositError(err?.message || "Gagal mengirim konfirmasi.");
    } finally {
      setManualBusy(false);
    }
  };

  useEffect(() => {
    return () => {
      depositPolling.current = false;
    };
  }, []);

  /* =====================================================================
   * AUTO-POLL OTP order aktif (biar riwayat selalu segar)
   * ===================================================================== */
  useEffect(() => {
    if (!session) return;
    let stopped = false;
    const tick = async () => {
      const active = ordersRef.current.filter(
        (o) => o.status === "ordered" && !o.otp && Date.now() - o.createdAt < 30 * 60 * 1000
      );
      if (active.length === 0) return;
      let changed = false;
      for (const o of active) {
        try {
          const r = await apiShopCheckMyOrder(session.user.id, o.orderId);
          if (r.status === "otp" && r.otp) changed = true;
        } catch {
          /* ignore */
        }
      }
      if (changed && !stopped) {
        await refreshWalletOrders(session.user.id);
      }
    };
    const id = setInterval(tick, 20000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  /* =====================================================================
   * CANCEL / REFUND (customer) — minimal 2 menit & tidak bisa jika OTP masuk
   * ===================================================================== */
  const requestCancel = async () => {
    if (!session || !cancelTarget) return;
    setCancelBusy(true);
    setCancelError(null);
    try {
      const res = await apiShopCancelOrder(session.user.id, cancelTarget.orderId);
      if (res.ok) {
        setCancelTarget(null);
        await refreshWalletOrders(session.user.id);
        showNotice(`Order dibatalkan — Rp ${formatRupiah(res.refunded || 0)} dikembalikan ke saldo kamu.`);
      } else {
        setCancelError(res.error || "Gagal membatalkan order.");
        if (res.otp) {
          await refreshWalletOrders(session.user.id);
        }
      }
    } catch (err: any) {
      setCancelError(err?.message || "Terjadi kesalahan. Coba lagi.");
    } finally {
      setCancelBusy(false);
    }
  };

  const checkSingleOrder = async (order: ShopOrder) => {
    if (!session) return;
    const r = await apiShopCheckMyOrder(session.user.id, order.orderId).catch(() => null);
    if (r?.status === "otp" && r.otp) {
      await refreshWalletOrders(session.user.id);
      showNotice("OTP sudah masuk — lihat di Riwayat.");
    } else if (r?.status === "otp") {
      await refreshWalletOrders(session.user.id);
    } else {
      showNotice("OTP belum masuk. Coba lagi beberapa menit kemudian.");
    }
  };

  /* =====================================================================
   * PANEL ADMIN (owner/cs)
   * ===================================================================== */
  const isAdmin = session && (session.user.role === "owner" || session.user.role === "cs");
  const isOwner = session?.user.role === "owner";

  const loadAdminData = async () => {
    if (!session) return;
    setAdminBusy(true);
    setAdminMsg(null);
    try {
      const isOwn = session.user.role === "owner";
      const [us, or] = await Promise.all([
        apiAdminListUsers(session.user.id),
        apiAdminOrders(session.user.id),
      ]);
      if (us.ok && us.users) setAdminUsers(us.users);
      if (or.ok && or.orders) setAdminOrdersData(or.orders);
      if (isOwn) {
        const [st, dp] = await Promise.all([
          apiAdminStats(session.user.id),
          apiAdminDeposits(session.user.id),
        ]);
        if (st.ok && st.stats) setAdminStatsData(st.stats);
        if (dp.ok && dp.deposits) setAdminDepositsData(dp.deposits);
        if (!st.ok) setAdminMsg(st.error || "Gagal memuat statistik.");
        if (!dp.ok) setAdminMsg(dp.error || "Gagal memuat deposit.");
      }
      if (!us.ok) setAdminMsg(us.error || "Gagal memuat data admin.");
    } catch (err: any) {
      setAdminMsg(err?.message || "Gagal memuat data admin.");
    } finally {
      setAdminBusy(false);
    }
  };

  const openAdmin = () => {
    setAdminHubOpen(true);
  };

  /* ---------- aksi admin ---------- */
  const adminAdjust = async (user: AdminUser, delta: number) => {
    if (!session) return;
    setAdminBusy(true);
    setAdminMsg(null);
    const res = await apiAdminAdjustBalance(session.user.id, user.id, delta).catch(() => null);
    if (res?.ok) {
      showNotice(`Saldo ${user.fullName || user.username} diubah: Rp ${formatRupiah(res.balance || 0)}`);
      await loadAdminData();
    } else {
      setAdminMsg(res?.error || "Gagal mengubah saldo.");
      setAdminBusy(false);
    }
  };

  const adminRefundOrder = async (order: AdminOrder) => {
    if (!session) return;
    setAdminBusy(true);
    setAdminMsg(null);
    const res = await apiAdminRefundOrder(session.user.id, order.id).catch(() => null);
    if (res?.ok) {
      showNotice(`Order ${order.orderId} direfund — Rp ${formatRupiah(res.refunded || 0)} kembali ke customer.`);
      await loadAdminData();
    } else {
      setAdminMsg(res?.error || "Gagal refund order.");
      setAdminBusy(false);
    }
  };

  const adminCreateStaff = async (input: { username: string; password: string; fullName: string }) => {
    if (!session || !isOwner) return;
    setAdminBusy(true);
    setAdminMsg(null);
    const res = await apiShopCreateStaff({
      actorId: session.user.id,
      username: input.username,
      password: input.password,
      fullName: input.fullName,
    }).catch(() => null);
    if (res?.ok) {
      showNotice(`Akun CS ${input.username} dibuat.`);
      await loadAdminData();
    } else {
      setAdminMsg(res?.error || "Gagal membuat akun CS.");
      setAdminBusy(false);
    }
  };

  const adminDeleteStaff = async (userId: string) => {
    if (!session || !isOwner) return;
    setAdminBusy(true);
    setAdminMsg(null);
    const res = await apiShopDeleteStaff(session.user.id, userId).catch(() => null);
    if (res?.ok) {
      showNotice("Akun CS dihapus.");
      await loadAdminData();
    } else {
      setAdminMsg(res?.error || "Gagal menghapus akun CS.");
      setAdminBusy(false);
    }
  };

  const adminToggleServer = async (serverKey: string, enabled: boolean) => {
    if (!session || !isOwner) return;
    setAdminBusy(true);
    setAdminMsg(null);
    const res = await apiShopSetServerEnabled(session.user.id, serverKey, enabled).catch(() => null);
    if (res?.ok) {
      setServerVisibility(res.servers || {});
      showNotice(`${enabled ? "Server dinyalakan" : "Server dimatikan"}: ${serverKey}`);
    } else {
      setAdminMsg(res?.error || "Gagal mengubah server.");
    }
    setAdminBusy(false);
  };

  /* =====================================================================
   * GATE: belum login -> landing page
   * ===================================================================== */
  if (!session) {
    return <ShopLanding onAuthed={applySession} />;
  }

  const statusCls = (status: string) => statusMeta(status).cls;
  const statusLabel = (status: string) => statusMeta(status).label;
  const role = roleMeta[session.user.role] || roleMeta.customer;

  return (
    <div className="min-h-screen relative overflow-hidden bg-zinc-950 text-white selection:bg-red-500/30">
      {/* ===== latar glow seperti landing ===== */}
      <motion.div
        className="pointer-events-none absolute -top-40 -left-32 w-[30rem] h-[30rem] rounded-full blur-3xl z-0"
        style={{ backgroundColor: "rgba(225,6,0,0.18)" }}
        animate={{ x: [0, 70, 0], y: [0, 40, 0], scale: [1, 1.15, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="pointer-events-none absolute top-1/3 -right-36 w-[34rem] h-[34rem] rounded-full blur-3xl z-0"
        style={{ backgroundColor: "rgba(0,230,118,0.12)" }}
        animate={{ x: [0, -60, 0], y: [0, -50, 0], scale: [1.1, 0.95, 1.1] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
      {depositSheetOpen && session && (
        <DepositSheet
          open={depositSheetOpen}
          userId={session.user.id}
          initialAmount={depositSheetAmount}
          onClose={() => setDepositSheetOpen(false)}
          onBalance={(balance) => {
            setWalletBalance(balance);
            refreshWalletOrders(session.user.id).catch(() => {});
          }}
        />
      )}
      {supportOpen && session && (
        <SupportSheet open={supportOpen} userId={session.user.id} onClose={() => setSupportOpen(false)} />
      )}
      {adminHubOpen && session && isAdmin && (
        <AdminHub
          user={session.user}
          onClose={() => setAdminHubOpen(false)}
          onUserUpdated={(u) => applySession(u)}
        />
      )}
      {/* ================= HEADER ================= */}
      <header className="border-b border-white/10 bg-[#0b0b0f]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center border border-white/25 flex-shrink-0 relative"
              style={{ background: "linear-gradient(140deg, #ff3d2e 0%, #e10600 45%, #7a0a05 100%)", boxShadow: "0 10px 24px -8px rgba(225,6,0,0.7), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -4px 8px rgba(0,0,0,0.3)" }}
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white drop-shadow" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h2m16 0h2M8 12a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4 4z" />
              </svg>
              <span className="absolute -right-0.5 -top-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#0b0b0f]" style={{ backgroundColor: ACCENT }} />
            </div>
            <div className="min-w-0">
              <motion.p
                className="text-[16px] font-black tracking-tight truncate"
                style={{
                  backgroundImage: "linear-gradient(92deg, #ffffff 5%, #00e676 45%, #ff5f56 90%)",
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
              <p className="text-[10px] text-zinc-400 tracking-[0.18em] uppercase truncate">Toko Nomor Online</p>
            </div>
            {session.user.role !== "customer" && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${role.cls} ml-1`}>{role.label}</span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {isAdmin && (
              <button
                onClick={openAdmin}
                className="px-3 py-2 rounded-xl text-sm font-semibold border border-white/15 text-zinc-200 hover:bg-white/5 flex items-center gap-2"
              >
                <Settings className="w-4 h-4" /> <span className="hidden sm:inline">Panel Admin</span>
              </button>
            )}
            <button
              onClick={() => setSupportOpen(true)}
              title="Hubungi CS"
              className="px-3 py-2 rounded-xl text-sm font-semibold border border-white/15 text-zinc-200 hover:bg-white/5 flex items-center gap-2"
            >
              <MessageCircle className="w-4 h-4" /> <span className="hidden sm:inline">Bantuan</span>
            </button>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-white/10 bg-white/5">
              <Wallet className="w-4 h-4" style={{ color: ACCENT }} />
              <span className="text-sm font-bold">Rp {formatRupiah(walletBalance ?? 0)}</span>
            </div>
            <button
              onClick={() => setDepositSheetOpen(true)}
              className="px-3.5 py-2 rounded-xl text-sm font-semibold shadow-lg transition-all hover:brightness-110 active:scale-[0.98] flex items-center gap-2"
              style={{ backgroundColor: ACCENT, color: DARK }}
            >
              <Wallet className="w-4 h-4" />
              <span className="hidden sm:inline">Isi Saldo</span>
            </button>
            <button
              onClick={handleLogout}
              title="Keluar"
              className="w-9 h-9 rounded-xl flex items-center justify-center border border-white/10 text-zinc-400 hover:text-white transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-6xl mx-auto px-5 py-6">
        {/* ================= HERO ================= */}
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 22 }}
          className="relative overflow-hidden rounded-3xl border border-white/10 p-6 md:p-8"
          style={{
            background: "linear-gradient(150deg, rgba(0,230,118,0.08), rgba(255,255,255,0.02) 45%, rgba(225,6,0,0.07))",
            boxShadow: "0 30px 70px -35px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          <div className="pointer-events-none absolute -top-28 -right-24 w-80 h-80 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(0,230,118,0.18), transparent 70%)" }} />
          <div className="pointer-events-none absolute -bottom-32 -left-20 w-80 h-80 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(225,6,0,0.16), transparent 70%)" }} />
          <div className="relative">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 mb-3">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                Aman & Aktif
              </span>
              <p className="text-[12px] uppercase tracking-[0.16em] text-zinc-500 font-bold">Halo, {session.user.fullName} 👋</p>
              <h1 className="text-3xl md:text-4xl font-extrabold mt-1.5 leading-tight" style={{ textShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
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
              </h1>
              <p className="text-zinc-400 text-sm mt-3 max-w-xl">
                Nomor virtual untuk verifikasi WhatsApp, Telegram, Facebook, dan lainnya. Isi saldo sekali —
                setiap pembelian dipotong otomatis dari saldo kamu.
              </p>
              <div className="flex flex-wrap gap-3 mt-5">
                <motion.a
                  href="#beli"
                  whileHover={{ y: -2, scale: 1.02 }}
                  whileTap={{ y: 1, scale: 0.96 }}
                  className="px-5 py-3 rounded-xl text-black text-sm font-bold flex items-center gap-2"
                  style={{ background: "linear-gradient(180deg,#7dffc4,#00e676 45%,#00b25a)", boxShadow: "0 12px 26px -10px rgba(0,230,118,0.7), inset 0 1px 0 rgba(255,255,255,0.6)" }}
                >
                  Beli Nomor <ArrowRightCircle className="w-4 h-4" />
                </motion.a>
                <motion.button
                  onClick={() => setDepositSheetOpen(true)}
                  whileHover={{ y: -1, scale: 1.01 }}
                  whileTap={{ y: 1, scale: 0.97 }}
                  className="px-5 py-3 rounded-xl text-white text-sm font-medium border border-white/20 flex items-center gap-2"
                >
                  <Wallet className="w-4 h-4" /> Isi Saldo
                </motion.button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: <Globe className="w-5 h-5" />, number: totalCountries == null ? "-" : String(totalCountries), label: "Negara (semua server)", tone: "green" as const },
                { icon: <ShoppingCart className="w-5 h-5" />, number: String(services.length || "-"), label: "Layanan tersedia", tone: "red" as const },
                { icon: <Wallet className="w-5 h-5" />, number: `Rp ${formatRupiah(walletBalance ?? 0)}`, label: "Saldo kamu", tone: "green" as const },
                { icon: <ShieldCheck className="w-5 h-5" />, number: "Aman", label: "Gagal = saldo balik", tone: "red" as const },
              ].map((c, i) => (
                <motion.div
                  key={c.label}
                  initial={{ opacity: 0, y: 14, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.1 + i * 0.07, type: "spring", stiffness: 260, damping: 20 }}
                  whileHover={{ y: -3, scale: 1.02 }}
                  className="rounded-2xl border border-white/10 p-4 relative overflow-hidden backdrop-blur"
                  style={{
                    background: c.tone === "green" ? "linear-gradient(150deg, rgba(0,230,118,0.10), rgba(255,255,255,0.02))" : "linear-gradient(150deg, rgba(225,6,0,0.14), rgba(255,255,255,0.02))",
                    boxShadow: c.tone === "green" ? "0 16px 40px -22px rgba(0,230,118,0.6), inset 0 1px 0 rgba(255,255,255,0.06)" : "0 16px 40px -22px rgba(225,6,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
                  }}
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2.5 border" style={c.tone === "green" ? { background: "rgba(0,230,118,0.14)", borderColor: "rgba(0,230,118,0.3)", color: ACCENT } : { background: "rgba(225,6,0,0.14)", borderColor: "rgba(225,6,0,0.3)", color: "#ff6b63" }}>
                    {c.icon}
                  </div>
                  <p className="text-lg font-black truncate" style={{ color: c.tone === "green" ? ACCENT : "#ffffff", textShadow: c.tone === "green" ? "0 0 20px rgba(0,230,118,0.35)" : "none" }}>
                    {c.number}
                  </p>
                  <p className="text-[11px] text-zinc-400 truncate mt-0.5">{c.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
          </div>
        </motion.div>

        {/* ================= KODE PROMO & UNDANG TEMAN ================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          {/* tukar kode promo / voucher */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            className="rounded-2xl border border-emerald-500/25 p-5"
            style={{ background: "linear-gradient(150deg, rgba(0,230,118,0.08), rgba(255,255,255,0.01))", boxShadow: "0 16px 40px -26px rgba(0,230,118,0.5)" }}
          >
            <p className="text-sm font-bold text-white flex items-center gap-2 mb-1">
              <Ticket className="w-4 h-4" style={{ color: ACCENT }} /> Punya Kode Promo / Voucher?
            </p>
            <p className="text-[12px] text-zinc-500 mb-3">Tukar kode di sini — saldo langsung masuk ke akun kamu.</p>
            <div className="flex gap-2">
              <input
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                placeholder="cth: KAKO10RB"
                className="flex-1 min-w-0 rounded-xl bg-zinc-800 border border-white/10 px-3.5 py-2.5 text-sm text-white uppercase placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
              />
              <button
                onClick={redeemCode}
                disabled={promoBusy}
                className="px-4 py-2.5 rounded-xl text-[13px] font-bold text-black disabled:opacity-60 flex items-center gap-1.5"
                style={{ background: "linear-gradient(180deg,#7dffc4,#00e676 45%,#00b25a)", boxShadow: "0 10px 22px -10px rgba(0,230,118,0.6)" }}
              >
                {promoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Tukar"}
              </button>
            </div>
            {promoMsg && (
              <p
                className={`mt-3 text-[12px] leading-relaxed rounded-xl px-3.5 py-2.5 border flex items-start gap-2 ${
                  promoMsg.kind === "ok"
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
                    : "bg-red-500/10 text-red-300 border-red-500/25"
                }`}
              >
                {promoMsg.kind === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <XCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                {promoMsg.text}
              </p>
            )}
          </motion.div>

          {/* undang teman */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ delay: 0.06 }}
            className="rounded-2xl border border-red-500/25 p-5"
            style={{ background: "linear-gradient(150deg, rgba(225,6,0,0.08), rgba(255,255,255,0.01))", boxShadow: "0 16px 40px -26px rgba(225,6,0,0.45)" }}
          >
            <p className="text-sm font-bold text-white flex items-center gap-2 mb-1">
              <Gift className="w-4 h-4" style={{ color: "#ff6b63" }} /> Ajak Teman — Dua-duanya Dapat Rp 5.000
            </p>
            <p className="text-[12px] text-zinc-500 mb-3">
              Bagikan kode undanganmu. Saat teman daftar & isi saldo pertamanya ≥ Rp 10.000, bonus masuk ke kalian berdua.
            </p>
            {refInfo && refInfo.refCode ? (
              <div className="flex items-center gap-2">
                <span className="px-4 py-2.5 rounded-xl border border-dashed border-red-500/40 bg-red-500/10 font-mono text-base font-black tracking-[0.2em] text-white">
                  {refInfo.refCode}
                </span>
                <button
                  onClick={() => {
                    handleCopy(refInfo.refCode);
                    setPromoMsg({ kind: "ok", text: `Kode undangan ${refInfo.refCode} disalin — bagikan ke temanmu!` });
                  }}
                  className="px-3 py-2 rounded-xl text-[12px] font-bold border border-white/15 text-zinc-200 hover:bg-white/5 flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" /> Salin
                </button>
                {refInfo.referralBonusAt ? (
                  <span className="text-[11px] text-emerald-300 font-semibold ml-auto flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Bonusmu sudah aktif
                  </span>
                ) : refInfo.referredBy ? (
                  <span className="text-[11px] text-amber-300 ml-auto">Kamu diajak teman — deposit pertama ≥ Rp 10.000 = bonus</span>
                ) : null}
              </div>
            ) : (
              <p className="text-[12px] text-zinc-500">Kode undanganmu otomatis dibuat — muat ulang halaman sebentar lagi untuk melihatnya.</p>
            )}
          </motion.div>
        </div>

        {/* ================= KARTU INFO ALUR ================= */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          {[
            { icon: <Zap className="w-5 h-5 text-red-500" />, title: "1. Isi Saldo", desc: "Bayar QR sekali, saldo masuk otomatis ke akun kamu. Tidak ada biaya tersembunyi." },
            { icon: <ShieldCheck className="w-5 h-5 text-red-500" />, title: "2. Pilih & Beli", desc: "Pilih server, negara, dan layanan. Harga dipotong dari saldo — harga yang tampil itulah yang dibayar." },
            { icon: <PhoneIncoming className="w-5 h-5 text-red-500" />, title: "3. OTP Masuk", desc: "Kode OTP dicek otomatis sampai masuk. Kalau order gagal, saldo dikembalikan otomatis." },
          ].map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ delay: i * 0.07 }}
              whileHover={{ y: -3, scale: 1.015 }}
              className="rounded-2xl border border-white/10 p-4 flex gap-3 relative overflow-hidden"
              style={{ background: "linear-gradient(150deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))", boxShadow: "0 16px 40px -24px rgba(0,0,0,0.9)" }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-red-500/25" style={{ background: "linear-gradient(140deg, rgba(225,6,0,0.30), rgba(225,6,0,0.08))" }}>
                {item.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="text-[12px] text-zinc-400 mt-1 leading-relaxed">{item.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* ================= ATURAN CANCEL/REFUND ================= */}
        <div className="mt-6 rounded-2xl border border-amber-500/20 p-4 flex items-start gap-3" style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.09), rgba(255,255,255,0.01))", boxShadow: "0 14px 34px -26px rgba(251,191,36,0.5)" }}>
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-amber-500/25 bg-amber-500/10">
            <Timer className="w-5 h-5 text-amber-400" />
          </div>
          <div className="text-[13px] text-zinc-300 leading-relaxed">
            <p className="font-semibold text-white text-sm mb-1 flex items-center gap-2">Aturan Batalkan & Refund</p>
            Order bisa dibatalkan/direfund <b className="text-white">minimal 2 menit</b> setelah pembelian, dan{" "}
            <b className="text-white">tidak bisa</b> jika kode OTP sudah masuk (nomor sudah terpakai). Refund dikembalikan otomatis ke saldo kamu.
          </div>
        </div>

        {/* ================= PILIH SERVER ================= */}
        <section id="beli" className="mt-8 scroll-mt-20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RED }} />
              Pilih Server
            </h2>
            <span className="text-[13px] text-zinc-400">Data real-time dari server</span>
          </div>
          <p className="text-[12px] text-zinc-400 mb-3">
            Bingung pilih yang mana? Pakai <b className="text-white">Server v1</b> — pilihan negara & layanan paling
            lengkap. Server v2–v4 adalah cadangan kalau stok di v1 habis.
          </p>
          {visibleServers.length === 0 ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-sm text-amber-200">
              Semua server sedang nonaktif oleh Owner. Hubungi admin untuk menyalakan server.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {visibleServers.map((s) => {
                const active = server?.id === s.id;
                return (
                  <motion.button
                    key={s.id}
                    onClick={() => setSelectedServerId(s.id)}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.97 }}
                    className={`rounded-2xl border text-left p-4 transition-colors relative overflow-hidden ${
                      active ? "border-transparent" : "border-white/10 bg-zinc-900/40 hover:border-white/20"
                    }`}
                    style={
                      active
                        ? {
                            background: "linear-gradient(150deg, rgba(225,6,0,0.20), rgba(225,6,0,0.04))",
                            boxShadow: "0 18px 45px -18px rgba(225,6,0,0.6), inset 0 0 0 1px rgba(225,6,0,0.6)",
                          }
                        : {}
                    }
                  >
                    {active && (
                      <span className="absolute -top-6 -right-6 w-16 h-16 rounded-full blur-2xl" style={{ background: "radial-gradient(circle, rgba(225,6,0,0.4), transparent 70%)" }} />
                    )}
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <span className="font-semibold text-white">{s.label}</span>
                      {s.badge && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0" style={{ backgroundColor: ACCENT, color: DARK }}>
                          {s.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-zinc-400 mb-2">{s.providerLabel}</p>
                    <p className="text-[12px] text-zinc-400 leading-relaxed">{s.description}</p>
                    {active && (
                      <span className="inline-flex items-center gap-1 mt-2 text-[11px] font-bold" style={{ color: ACCENT }}>
                        <CheckCircle2 className="w-3.5 h-3.5" /> Dipilih
                      </span>
                    )}
                  </motion.button>
                );
              })}
            </div>
          )}
        </section>

        {/* ================= DATA SERVER ================= */}
        {server && (
          <section className="mt-6">
            {dataFallback && !dataError && (
              <div className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-200 flex items-start gap-2">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  Server ini sedang memakai jalur cadangan otomatis supaya pembelian tetap berjalan normal.
                </span>
              </div>
            )}
            {dataError ? (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
                <div className="flex items-start gap-3">
                  <XCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-300">Server {server.label} belum terhubung</p>
                    <p className="text-[13px] text-red-200/80 mt-1 leading-relaxed">{dataError}</p>
                    <button
                      onClick={() => setReloadToken((v) => v + 1)}
                      className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-white/15 hover:bg-white/5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Muat Ulang Data
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Negara */}
                <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
                  <h3 className="text-base font-bold text-white flex items-center gap-2 mb-1">
                    <Globe className="w-4 h-4 text-red-500" /> Negara
                  </h3>
                  <p className="text-[12px] text-zinc-500 mb-3">
                    {loadingData
                      ? "memuat..."
                      : countryQuery.trim()
                      ? `${visibleCountries.length} dari ${countries.length} negara`
                      : `${countries.length} negara`}
                  </p>
                  {countries.length === 0 ? (
                    <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-6 justify-center">
                      <Loader2 className="w-4 h-4 animate-spin" /> Memuat negara...
                    </div>
                  ) : (
                    <>
                      <div className="relative mb-3">
                        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={countryQuery}
                          onChange={(e) => setCountryQuery(e.target.value)}
                          placeholder="Cari negara… (mis. indonesia, japan)"
                          className="w-full rounded-xl bg-zinc-800 border border-white/10 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                      {visibleCountries.length === 0 ? (
                        <div className="text-[13px] text-zinc-500 py-6 text-center">
                          Tidak ada negara yang cocok dengan “{countryQuery.trim()}”.
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
                          {visibleCountries.slice(0, MAX_COUNTRY_CHIPS).map((c) => {
                            const key = String(c.id ?? c.name);
                            const active = String(selectedCountryId) === key;
                            return (
                              <button
                                key={key}
                                onClick={() => setSelectedCountryId(c.id)}
                                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                                  active ? "text-white font-bold" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                                }`}
                                style={
                                  active
                                    ? { background: "linear-gradient(150deg,#ff3d2e,#e10600 60%,#8f0a04)", boxShadow: "0 8px 18px -8px rgba(225,6,0,0.8), inset 0 1px 0 rgba(255,255,255,0.25)" }
                                    : {}
                                }
                              >
                                {c.name}
                              </button>
                            );
                          })}
                          {visibleCountries.length > MAX_COUNTRY_CHIPS && (
                            <p className="w-full text-[11px] text-zinc-500 pt-1">
                              +{visibleCountries.length - MAX_COUNTRY_CHIPS} negara lagi — tulis di kolom
                              pencarian untuk mempersempit pilihan.
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Layanan */}
                <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
                  <h3 className="text-base font-bold text-white flex items-center gap-2 mb-1">
                    <ShoppingCart className="w-4 h-4 text-red-500" /> Layanan
                  </h3>
                  <p className="text-[12px] text-zinc-500 mb-3">
                    {loadingData
                      ? "memuat..."
                      : serviceQuery.trim()
                      ? `${visibleServices.length} dari ${services.length} layanan`
                      : `${services.length} layanan tersedia`}
                  </p>
                  {services.length === 0 ? (
                    loadingData ? (
                      <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-6 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Memuat layanan...
                      </div>
                    ) : (
                      <div className="text-[13px] text-zinc-500 py-6 text-center">
                        Belum ada layanan untuk negara ini — coba pilih negara lain.
                      </div>
                    )
                  ) : (
                    <>
                      <div className="relative mb-3">
                        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={serviceQuery}
                          onChange={(e) => setServiceQuery(e.target.value)}
                          placeholder="Cari layanan… (mis. whatsapp, telegram, otp)"
                          className="w-full rounded-xl bg-zinc-800 border border-white/10 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                      {visibleServices.length === 0 ? (
                        <div className="text-[13px] text-zinc-500 py-6 text-center">
                          Tidak ada layanan yang cocok dengan “{serviceQuery.trim()}”.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto pr-1">
                          {visibleServices.map((s) => {
                            const key = String(s.service ?? s.id);
                            const active = String(selectedServiceId) === key;
                            const isOut = s.stock === 0;
                            return (
                              <button
                                key={key}
                                disabled={isOut}
                                onClick={() => setSelectedServiceId(key)}
                                className={`rounded-xl px-3 py-2 text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                  active ? "bg-white/10 ring-1 ring-white/30" : "bg-zinc-800/80 hover:bg-zinc-700/80"
                                }`}
                              >
                                <p className="text-[13px] font-semibold text-white truncate">{s.name || key}</p>
                                <p className="text-[11px] mt-0.5">
                                  <span style={{ color: ACCENT }}>Rp {formatRupiah(s.sellPrice ?? computeSellPrice(s.price))}</span>
                                  <span className="text-zinc-500"> • stok {isOut ? "habis" : s.stock}</span>
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ================= RINGKASAN + BELI ================= */}
        {server && (
          <motion.div
            className="mt-8 relative overflow-hidden rounded-2xl border shadow-2xl"
            style={{ borderColor: "rgba(225,6,0,0.45)", background: "linear-gradient(160deg, rgba(225,6,0,0.12), #0b0b0f 45%)", boxShadow: "0 30px 80px -40px rgba(225,6,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)" }}
          >
            <motion.div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent, #ff5f56, #00e676, transparent)" }}
              animate={{ x: ["-100%", "100%"] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-white/10">
              <div className="p-5 text-center">
                <p className="text-[11px] uppercase tracking-widest text-zinc-400">Server</p>
                <p className="text-lg font-bold text-white mt-1">{server.label}</p>
                <p className="text-[12px] text-zinc-400">{server.providerLabel}</p>
              </div>
              <div className="p-5 text-center">
                <p className="text-[11px] uppercase tracking-widest text-zinc-400">Negara</p>
                <p className="text-lg font-bold text-white mt-1 truncate">
                  {countries.find((c) => String(c.id) === String(selectedCountryId))?.name || "-"}
                </p>
              </div>
              <div className="p-5 text-center">
                <p className="text-[11px] uppercase tracking-widest text-zinc-400">Layanan</p>
                <p className="text-lg font-bold text-white mt-1 truncate">{selectedService?.name || "-"}</p>
              </div>
              <div className="p-5 text-center bg-red-600/10">
                <p className="text-[11px] uppercase tracking-widest text-zinc-400">Total Bayar</p>
                <p className="text-2xl font-extrabold mt-1">Rp {formatRupiah(sellPrice)}</p>
                <p className="text-[12px] text-zinc-400 mt-1">jumlah yang kamu bayar</p>
              </div>
            </div>

            <div className="px-5 pb-5">
              <motion.button
                onClick={handleBuy}
                disabled={!selectedService || loadingData}
                whileTap={!selectedService ? undefined : { scale: 0.98, y: 1 }}
                whileHover={!selectedService ? undefined : { y: -2 }}
                className={`w-full py-4 rounded-xl text-base font-black transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  !selectedService ? "bg-zinc-700 text-zinc-500" : "text-black"
                }`}
                style={
                  selectedService
                    ? { background: "linear-gradient(180deg,#ffffff,#e4e4e4)", boxShadow: "0 20px 44px -16px rgba(255,255,255,0.5), inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -3px 8px rgba(0,0,0,0.12)" }
                    : {}
                }
              >
                <QrCode className="w-5 h-5" /> Beli — Potong Saldo Rp {formatRupiah(sellPrice)}
                <ArrowRight className="w-4 h-4" />
              </motion.button>
              <p className="text-[12px] text-zinc-400 text-center mt-2">
                Saldo kamu: <b style={{ color: ACCENT }}>Rp {formatRupiah(walletBalance ?? 0)}</b> — kalau kurang, isi saldo dulu. Gagal = saldo kembali otomatis.
              </p>
            </div>
          </motion.div>
        )}

        {/* ================= RIWAYAT ================= */}
        <section id="riwayat" className="mt-10 scroll-mt-20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-red-500" /> Riwayat Transaksi
            </h2>
            {ordersLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-500" />}
          </div>

          {orders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-8 text-center">
              <History className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-sm text-zinc-400">Belum ada transaksi.</p>
              <p className="text-[12px] text-zinc-500 mt-1">Isi saldo lalu beli nomor pertama kamu — semuanya tercatat di sini.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orders.map((item) => (
                <OrderRow
                  key={item.id}
                  item={item}
                  statusCls={statusCls}
                  statusLabel={statusLabel}
                  onCopy={handleCopy}
                  onCheckOtp={() => checkSingleOrder(item)}
                  onCancel={() => {
                    setCancelError(null);
                    setCancelTarget(item);
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ================= NOTICE TOAST ================= */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] w-[92%] max-w-md rounded-2xl border border-white/15 bg-zinc-900/95 backdrop-blur px-5 py-3.5 text-sm text-white text-center shadow-2xl"
          >
            <CheckCircle2 className="w-4 h-4 inline-block mr-1.5" style={{ color: ACCENT }} />
            {notice}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================= MODAL KONFIRMASI CANCEL ================= */}
      <AnimatePresence>
        {cancelTarget && (
          <ModalShell onClose={() => !cancelBusy && setCancelTarget(null)}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Ban className="w-5 h-5 text-amber-400" /> Batalkan & Refund
              </h3>
              <button onClick={() => !cancelBusy && setCancelTarget(null)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400">
                ✕
              </button>
            </div>
            <p className="text-[13px] text-zinc-300 leading-relaxed mb-2">
              Batalkan order <b className="text-white font-mono text-[12px]">{cancelTarget.orderId}</b>? Saldo
              <b style={{ color: ACCENT }}> Rp {formatRupiah(cancelTarget.sellPrice)}</b> akan dikembalikan ke saldo kamu.
            </p>
            <p className="text-[12px] text-zinc-500 mb-4">Berlaku karena OTP belum masuk dan order sudah berjalan lebih dari 2 menit.</p>
            {cancelError && (
              <p className="text-[13px] text-red-300 leading-relaxed mb-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{cancelError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={requestCancel}
                disabled={cancelBusy}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-amber-500 hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cancelBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
                {cancelBusy ? "Memproses..." : "Ya, Batalkan & Refund"}
              </button>
              <button onClick={() => setCancelTarget(null)} disabled={cancelBusy} className="px-5 py-3 rounded-xl text-sm font-semibold border border-white/10 text-zinc-300 hover:bg-white/5">
                Tutup
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ================= PANEL ADMIN ================= */}
      <AnimatePresence>
        {adminOpen && isAdmin && session && (
          <ModalShell wide onClose={() => !adminBusy && setAdminOpen(false)}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5" style={{ color: RED }} /> Panel Admin
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${role.cls}`}>{role.label}</span>
              </h3>
              <button onClick={() => !adminBusy && setAdminOpen(false)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400">
                ✕
              </button>
            </div>

            {/* tab bar */}
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                ...(isOwner
                  ? [
                      { id: "ringkasan" as const, label: "Ringkasan", icon: <BarChart3 className="w-4 h-4" /> },
                      { id: "customer" as const, label: "Customer", icon: <Users className="w-4 h-4" /> },
                      { id: "transaksi" as const, label: "Transaksi", icon: <History className="w-4 h-4" /> },
                      { id: "deposit" as const, label: "Deposit", icon: <QrCode className="w-4 h-4" /> },
                      { id: "staff" as const, label: "Staff CS", icon: <UserCog className="w-4 h-4" /> },
                      { id: "server" as const, label: "Server", icon: <Server className="w-4 h-4" /> },
                    ]
                  : [
                      { id: "customer" as const, label: "Customer", icon: <Users className="w-4 h-4" /> },
                      { id: "transaksi" as const, label: "Transaksi", icon: <History className="w-4 h-4" /> },
                    ]),
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setAdminTab(tab.id);
                    setAdminMsg(null);
                  }}
                  className={`px-3.5 py-2 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 transition-all ${
                    adminTab === tab.id ? "text-black" : "border border-white/10 text-zinc-300 hover:bg-white/5"
                  }`}
                  style={adminTab === tab.id ? { backgroundColor: ACCENT } : {}}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
              {adminBusy && <Loader2 className="w-4 h-4 animate-spin text-zinc-500 ml-auto self-center" />}
            </div>

            {adminMsg && (
              <p className="text-[13px] text-amber-300 leading-relaxed mb-3 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5">
                {adminMsg}
              </p>
            )}

            {/* tab: ringkasan (owner) */}
            {adminTab === "ringkasan" && isOwner && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard icon={<Users className="w-5 h-5" />} number={String(adminStatsData?.customerCount ?? "-")} label="Customer terdaftar" />
                <StatCard icon={<Wallet className="w-5 h-5" />} number={`Rp ${formatRupiah(adminStatsData?.depositTotal ?? 0)}`} label="Total deposit lunas" />
                <StatCard icon={<QrCode className="w-5 h-5" />} number={String(adminStatsData?.depositPending ?? "-")} label="Deposit menunggu" />
                <StatCard icon={<BarChart3 className="w-5 h-5" />} number={`Rp ${formatRupiah(adminStatsData?.soldTotal ?? 0)}`} label="Total transaksi berhasil" />
                <StatCard icon={<RefreshCw className="w-5 h-5" />} number={`Rp ${formatRupiah(adminStatsData?.refundTotal ?? 0)}`} label="Total refund" />
                <StatCard icon={<Wallet className="w-5 h-5" />} number={`Rp ${formatRupiah(adminStatsData?.totalBalance ?? 0)}`} label="Saldo customer sekarang" />
                <StatCard icon={<History className="w-5 h-5" />} number={String(adminStatsData?.orderCount ?? "-")} label="Total order (semua status)" />
                <StatCard icon={<Timer className="w-5 h-5" />} number={String(adminStatsData?.activeOrderCount ?? "-")} label="Order menunggu/OTP" />
                <StatCard icon={<UserCog className="w-5 h-5" />} number={String(adminStatsData?.staffCount ?? "-")} label="Staff CS" />
                <button onClick={() => { setAdminTab("customer"); }} className="col-span-2 sm:col-span-3 py-3 rounded-xl text-sm font-semibold border border-white/10 text-zinc-200 hover:bg-white/5 flex items-center justify-center gap-2">
                  <Users className="w-4 h-4" /> Lihat daftar akun & kelola saldo
                </button>
              </div>
            )}

            {/* tab: customer */}
            {adminTab === "customer" && (
              <CustomerAdminTabPanel
                users={adminUsers}
                busy={adminBusy}
                onReload={loadAdminData}
                onAdjust={adminAdjust}
              />
            )}

            {/* tab: transaksi */}
            {adminTab === "transaksi" && (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {adminOrdersData.length === 0 ? (
                  <p className="text-[13px] text-zinc-500 text-center py-8">Belum ada order.</p>
                ) : (
                  adminOrdersData.map((o) => {
                    const refundable = o.status === "ordered" && !o.otp;
                    return (
                      <div key={o.id} className="rounded-xl bg-zinc-900/70 border border-white/10 px-4 py-3 text-[13px]">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-white font-semibold">{o.username || o.fullName}</span>
                          <span className="text-zinc-400">{o.serverLabel || "Server"} • {o.serviceName}</span>
                          <span className="text-zinc-500">{o.countryName}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusCls(o.status)}`}>
                            {o.otp ? `OTP: ${o.otp}` : statusLabel(o.status)}
                          </span>
                          <span className="ml-auto text-white font-bold">Rp {formatRupiah(o.sellPrice)}</span>
                        </div>
                        <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
                          <span className="text-[11px] text-zinc-500 font-mono break-all">{o.orderId}</span>
                          {refundable ? (
                            <button
                              onClick={() => adminRefundOrder(o)}
                              disabled={adminBusy}
                              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 disabled:opacity-50"
                            >
                              <RefreshCw className="w-3 h-3 inline-block mr-1" /> Refund manual
                            </button>
                          ) : o.status === "ordered" && o.otp ? (
                            <span className="text-[11px] text-emerald-400">OTP sudah masuk — tidak bisa refund</span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* tab: deposit (owner) */}
            {adminTab === "deposit" && isOwner && (
              <AdminDepositTab deposits={adminDepositsData} />
            )}

            {/* tab: staff (owner) */}
            {adminTab === "staff" && isOwner && (
              <StaffAdminTab
                users={adminUsers}
                busy={adminBusy}
                onCreate={adminCreateStaff}
                onDelete={adminDeleteStaff}
              />
            )}

            {/* tab: server (owner) */}
            {adminTab === "server" && isOwner && (
              <div className="space-y-2">
                {SERVER_LIST.map((s) => {
                  const enabled = serverVisibility[s.id] !== false;
                  return (
                    <div key={s.id} className="rounded-xl bg-zinc-900/70 border border-white/10 px-4 py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{s.label} <span className="text-zinc-500 font-normal text-[12px]">({s.providerLabel})</span></p>
                        <p className="text-[11px] text-zinc-500 mt-0.5">{enabled ? "Tampil di halaman beli" : "Disembunyikan dari halaman beli"}</p>
                      </div>
                      <button
                        onClick={() => adminToggleServer(s.id, !enabled)}
                        disabled={adminBusy}
                        className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${enabled ? "" : "bg-zinc-700"}`}
                        style={enabled ? { backgroundColor: ACCENT } : {}}
                        title={enabled ? "Matikan server" : "Nyalakan server"}
                      >
                        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${enabled ? "left-6" : "left-1"}`} />
                      </button>
                    </div>
                  );
                })}
                <p className="text-[12px] text-zinc-500 leading-relaxed mt-2">
                  Server yang dimatikan tidak muncul di halaman beli customer. Menambah server baru perlu
                  pengaturan tambahan dari pengembang.
                </p>
              </div>
            )}
          </ModalShell>
        )}
      </AnimatePresence>

      {/* ================= SHEET PROSES BELI ================= */}
      <AnimatePresence>
        {payPhase !== "idle" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
            onClick={payPhase === "error" ? closePaySheet : undefined}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-t-3xl sm:rounded-3xl p-6 max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">Proses Pembelian</h3>
                <button onClick={closePaySheet} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400">
                  ✕
                </button>
              </div>

              <div className="flex justify-center mb-4">
                {payPhase === "error" ? (
                  <XCircle className="w-14 h-14 text-red-500" />
                ) : payPhase === "success" ? (
                  <CheckCircle2 className="w-14 h-14 text-emerald-400" />
                ) : (
                  <Loader2 className="w-14 h-14 text-white animate-spin" />
                )}
              </div>

              {payMessage && <p className="text-center text-sm text-white font-medium mb-1">{payMessage}</p>}
              {payError && (
                <p className="text-center text-[13px] text-red-300 leading-relaxed mb-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  {payError}
                </p>
              )}

              {payAmount > 0 && (
                <div className="flex justify-between items-center rounded-xl bg-white/5 px-4 py-3 mb-4">
                  <span className="text-[13px] text-zinc-300">Total dipotong dari saldo</span>
                  <span className="font-extrabold text-white">Rp {formatRupiah(payAmount)}</span>
                </div>
              )}

              {resultOtp && (
                <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center mb-4">
                  <p className="text-[12px] text-emerald-300 uppercase tracking-widest font-semibold mb-2">Kode OTP Kamu</p>
                  <p className="text-4xl font-black tracking-[0.35em] text-white font-mono select-all">{resultOtp}</p>
                  <button
                    onClick={() => handleCopy(resultOtp)}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-white text-black"
                  >
                    <Copy className="w-3.5 h-3.5" /> Salin Kode
                  </button>
                </div>
              )}

              {resultPhone && (
                <p className="text-center text-[13px] text-zinc-300 mb-3">
                  Nomor: <span className="font-mono text-white">{resultPhone}</span>
                </p>
              )}

              {resultOrderId && (
                <p className="text-center text-[12px] text-zinc-500 font-mono mb-3 break-all">Order: {resultOrderId}</p>
              )}

              {payPhase === "error" && resultOrderId && (
                <button
                  onClick={handleCheckOtp}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-white text-black hover:brightness-95"
                >
                  Cek OTP Lagi
                </button>
              )}
              {(payPhase === "success" || payPhase === "error") && (
                <button
                  onClick={closePaySheet}
                  className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold border border-white/10 text-zinc-300 hover:bg-white/5"
                >
                  Tutup
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ================= MODAL ISI SALDO ================= */}
      <AnimatePresence>
        {depositOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
            onClick={() => setDepositOpen(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-t-3xl sm:rounded-3xl p-6 max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Wallet className="w-5 h-5" style={{ color: ACCENT }} /> Isi Saldo
                </h3>
                <button
                  onClick={() => {
                    depositPolling.current = false;
                    setDepositOpen(false);
                  }}
                  className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400"
                >
                  ✕
                </button>
              </div>

              <p className="text-[13px] text-zinc-400 mb-4 leading-relaxed">
                Bayar via <b className="text-white">QRIS</b> — begitu lunas, saldo langsung masuk ke
                akun kamu secara otomatis. Pembelian nanti dipotong dari saldo ini.
              </p>

              <div className="grid grid-cols-3 gap-2 mb-4">
                {[10000, 25000, 50000, 100000, 250000, 500000].map((nominal) => (
                  <button
                    key={nominal}
                    onClick={() => setDepositAmount(nominal)}
                    className={`rounded-xl px-2 py-3 text-sm font-semibold transition-all border ${
                      depositAmount === nominal
                        ? "border-red-500 bg-red-600/10 text-white"
                        : "border-white/10 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    Rp {formatRupiah(nominal)}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 mb-4">
                <span className="text-[13px] text-zinc-400">Rp</span>
                <input
                  type="number"
                  min={5000}
                  step={1000}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(Math.max(5000, Number(e.target.value) || 0))}
                  className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-white text-sm focus:border-red-500 focus:outline-none"
                />
              </div>

              {depositStatus && (
                <p className="text-[13px] text-zinc-300 leading-relaxed mb-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                  {depositStatus}
                </p>
              )}
              {depositError && (
                <p className="text-[13px] text-red-300 leading-relaxed mb-3 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
                  {depositError}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  onClick={startDeposit}
                  disabled={depositBusy || depositAmount < 5000}
                  className="flex-1 py-3.5 rounded-xl text-sm font-bold bg-white text-black hover:brightness-95 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {depositBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Memproses...
                    </>
                  ) : (
                    <>
                      <QrCode className="w-4 h-4" /> Buat QR & Isi Saldo
                    </>
                  )}
                </button>
                {depositRef && !depositBusy && (
                  <button
                    onClick={checkDepositAgain}
                    className="px-4 py-3.5 rounded-xl text-sm font-semibold border border-white/15 text-zinc-200 hover:bg-white/5 flex items-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" /> Cek Lagi
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="border-t border-white/10 mt-12 py-6 text-center text-[12px] text-zinc-500">
        <p className="font-semibold text-white tracking-wide">KAKO NOKOS</p>
        <p className="mt-1">Harga yang tampil adalah harga yang kamu bayar. Pembayaran & isi saldo via QRIS.</p>
      </footer>
    </div>
  );
}

/* =====================================================================
 * SATU BARIS RIWAYAT (dengan tombol periksa OTP & batalkan)
 * ===================================================================== */
/* =====================================================================
 * HUBUNGI CS — chat dengan asisten otomatis, bisa dialihkan ke admin/CS
 * ===================================================================== */
function SupportSheet({
  open,
  userId,
  onClose,
}: {
  open: boolean;
  userId: string;
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
            style={{ background: `linear-gradient(140deg, ${RED} 0%, #7a0a05 100%)` }}
          >
            <Headset className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-white leading-tight">Hubungi CS</p>
            <p className="text-[11px] text-zinc-400 truncate">
              {staffMode
                ? "Terhubung ke admin/CS — balasan muncul di halaman ini"
                : "Dijawab otomatis oleh asisten · tulis “admin” untuk minta admin"}
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
                <Bot className="w-4 h-4" style={{ color: ACCENT }} /> Ada yang bisa dibantu?
              </p>
              <p className="text-[12px] text-zinc-400 mt-1">
                Tulis pertanyaan atau laporanmu di bawah. Dijawab otomatis oleh asisten; kalau perlu admin, tulis{" "}
                <b className="text-white">admin</b>.
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
                      {staff ? <Headset className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
                      {staff ? m.authorName || "Admin/CS" : "Asisten KAKO NOKOS"}
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

function OrderRow({
  item,
  statusCls,
  statusLabel,
  onCopy,
  onCheckOtp,
  onCancel,
}: {
  item: ShopOrder;
  statusCls: (s: string) => string;
  statusLabel: (s: string) => string;
  onCopy: (text: string) => void;
  onCheckOtp: () => void;
  onCancel: () => void;
}) {
  const waiting = item.status === "ordered" && !item.otp;
  const canCancel = waiting && Date.now() - item.createdAt >= CANCEL_MIN_SECONDS * 1000;

  return (
    <div className="rounded-xl bg-zinc-900/60 border border-white/10 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-white font-medium">
          {item.serverLabel || "Server"} • {item.serviceName}
        </span>
        <span className="text-zinc-400 text-[13px]">{item.countryName}</span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusCls(item.status)}`}>
          {statusLabel(item.status)}
        </span>
        <span className="ml-auto text-white font-bold">Rp {formatRupiah(item.sellPrice)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px]">
        <span className="text-zinc-500 font-mono break-all">{item.orderId}</span>
        <span className="text-zinc-500">{new Date(item.createdAt).toLocaleString("id-ID")}</span>
      </div>

      {item.otp ? (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-[11px] text-emerald-400 font-semibold">
            ⚠️ OTP sudah masuk — order tidak bisa dibatalkan/direfund.
          </span>
          <button
            onClick={() => onCopy(item.otp!)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-white text-black inline-flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> Salin OTP {item.otp}
          </button>
        </div>
      ) : waiting ? (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button
            onClick={onCheckOtp}
            className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/15 text-zinc-200 hover:bg-white/5 inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Periksa OTP
          </button>
          {canCancel ? (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25 inline-flex items-center gap-1"
            >
              <Ban className="w-3 h-3" /> Batalkan & Refund
            </button>
          ) : (
            <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1">
              <Timer className="w-3 h-3" />
              <CountdownText targetMs={item.createdAt + CANCEL_MIN_SECONDS * 1000} />
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CountdownText({ targetMs }: { targetMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, targetMs - now);
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (diff <= 0) return <>Bisa dibatalkan sekarang</>;
  return <>Bisa dibatalkan dalam {m}:{String(s).padStart(2, "0")}</>;
}

/* =====================================================================
 * MODAL SHELL
 * ===================================================================== */
function ModalShell({
  children,
  onClose,
  wide,
}: {
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} bg-zinc-900 border border-white/10 rounded-t-3xl sm:rounded-3xl p-6 max-h-[88vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/* =====================================================================
 * TAB CUSTOMER (panel admin)
 * ===================================================================== */
function CustomerAdminTab({
  users,
  busy,
  onReload,
  onAdjust,
}: {
  users: AdminUser[];
  busy: boolean;
  onReload: () => void;
  onAdjust: (user: AdminUser, delta: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const customers = users.filter((u) => u.role === "customer");
  const filtered = query.trim()
    ? customers.filter((u) => `${u.fullName} ${u.username}`.toLowerCase().includes(query.trim().toLowerCase()))
    : customers;

  return (
    <div>
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cari customer (nama / email)…"
          className="w-full rounded-xl bg-zinc-800 border border-white/10 pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
        />
      </div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] text-zinc-500">{filtered.length} dari {customers.length} customer</p>
        <button onClick={onReload} disabled={busy} className="text-[12px] font-semibold text-zinc-300 hover:text-white inline-flex items-center gap-1">
          <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} /> Muat ulang
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="text-[13px] text-zinc-500 text-center py-8">Belum ada customer.</p>
      ) : (
        <div className="space-y-2 max-h-[48vh] overflow-y-auto pr-1">
          {filtered.map((u) => {
            const draftVal = draft[u.id] || "";
            const amount = Number(draftVal) || 0;
            return (
              <div key={u.id} className="rounded-xl bg-zinc-900/70 border border-white/10 px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-white font-semibold">{u.fullName}</span>
                  <span className="text-zinc-500 text-[12px]">{u.username}</span>
                  <span className="ml-auto text-[12px] text-zinc-400">
                    Saldo: <b style={{ color: ACCENT }}>Rp {formatRupiah(u.balance)}</b>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <input
                    type="number"
                    min={0}
                    value={draftVal}
                    onChange={(e) => setDraft((p) => ({ ...p, [u.id]: e.target.value }))}
                    placeholder="Nominal"
                    className="w-28 rounded-lg bg-zinc-800 border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder:text-zinc-600 focus:border-red-500 focus:outline-none"
                  />
                  <button
                    onClick={() => amount > 0 && onAdjust(u, amount)}
                    disabled={busy || amount <= 0}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    style={{ backgroundColor: ACCENT, color: DARK }}
                  >
                    <Plus className="w-3 h-3" /> Isi Saldo
                  </button>
                  <button
                    onClick={() => amount > 0 && onAdjust(u, -amount)}
                    disabled={busy || amount <= 0}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-amber-500/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    <Minus className="w-3 h-3" /> Kurangi
                  </button>
                  {u.balance === 0 && (
                    <span className="text-[11px] text-zinc-600 ml-auto">belum pernah isi saldo</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* =====================================================================
 * TAB STAFF CS (panel admin, owner)
 * ===================================================================== */
function StaffAdminTab({
  users,
  busy,
  onCreate,
  onDelete,
}: {
  users: AdminUser[];
  busy: boolean;
  onCreate: (input: { username: string; password: string; fullName: string }) => void;
  onDelete: (userId: string) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const staff = users.filter((u) => u.role === "cs");

  const submit = () => {
    if (!username.trim() || !password || password.length < 4) return;
    onCreate({ username: username.trim().toLowerCase(), password, fullName: fullName.trim() || "Customer Service" });
    setFullName("");
    setUsername("");
    setPassword("");
  };

  return (
    <div>
      <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-4 mb-4">
        <p className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
          <UserCog className="w-4 h-4 text-red-500" /> Buat Akun CS Baru
        </p>
        <label className="block mb-2">
          <span className="text-[12px] text-zinc-400 mb-1 block">Nama CS</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="mis. CS Budi"
            className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
          />
        </label>
        <label className="block mb-2">
          <span className="text-[12px] text-zinc-400 mb-1 block">Username / Email</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="cs@kako.app"
            className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
          />
        </label>
        <label className="block mb-3">
          <span className="text-[12px] text-zinc-400 mb-1 block">Password</span>
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimal 4 karakter"
            className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
          />
        </label>
        <button
          onClick={submit}
          disabled={busy || !username.trim() || password.length < 4}
          className="w-full py-2.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ backgroundColor: ACCENT, color: DARK }}
        >
          <UserPlus className="w-4 h-4" /> Buat Akun CS
        </button>
      </div>

      {staff.length === 0 ? (
        <p className="text-[13px] text-zinc-500 text-center py-6">Belum ada akun CS.</p>
      ) : (
        <div className="space-y-2">
          {staff.map((u) => (
            <div key={u.id} className="rounded-xl bg-zinc-900/70 border border-white/10 px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">{u.fullName}</p>
                <p className="text-[12px] text-zinc-500 truncate">{u.username}</p>
              </div>
              <button
                onClick={() => onDelete(u.id)}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20 inline-flex items-center gap-1 disabled:opacity-50"
              >
                <Trash2 className="w-3 h-3" /> Hapus
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =====================================================================
 * LANDING PAGE (sebelum login) + modal masuk/daftar
 * ===================================================================== */
function LandingPage({ onAuthed }: { onAuthed: (user: ShopUser) => void }) {
  const [authMode, setAuthMode] = useState<"login" | "register" | "owner">("login");
  const [authOpen, setAuthOpen] = useState(false);
  const [totalCountries, setTotalCountries] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lists = await Promise.all(
        (["kirimkode", "kirimkode_alt"] as ProviderId[]).map((id) => apiListCountries(id).catch(() => [] as Country[]))
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

  const openAuth = (mode: "login" | "register" | "owner") => {
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
              { icon: <Wallet className="w-6 h-6 text-red-500" />, step: "01", title: "Daftar & Isi Saldo", desc: "Buat akun gratis (email + password), lalu isi saldo lewat QRIS. Saldo masuk otomatis begitu bayaran lunas." },
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
        <p className="mt-1">Toko nomor virtual online — harga tampil = harga bayar. Pembayaran via QRIS.</p>
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
 * MODAL AUTH: Masuk | Daftar | Owner
 * ===================================================================== */
function AuthModal({
  initialMode,
  onClose,
  onAuthed,
}: {
  initialMode: "login" | "register" | "owner";
  onClose: () => void;
  onAuthed: (user: ShopUser) => void;
}) {
  const [mode, setMode] = useState<"login" | "register" | "owner">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      } else if (mode === "owner") {
        const reg = await apiShopRegisterOwner({ email, password, fullName, code });
        if (!reg.ok) {
          setError(reg.error || "Gagal membuat akun Owner.");
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
            {mode === "login" ? "Masuk" : mode === "owner" ? "Daftar Owner" : "Daftar Akun"}
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400">
            ✕
          </button>
        </div>

        {/* pilihan mode */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {([
            { id: "login" as const, label: "Masuk" },
            { id: "register" as const, label: "Daftar" },
            { id: "owner" as const, label: "Owner/CS" },
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
          {mode === "owner" && "Pendaftaran khusus pemilik toko (butuh Kode Owner dari admin/developer)."}
        </p>

        {mode !== "login" && (
          <label className="block mb-3">
            <span className="text-[12px] text-zinc-400 mb-1 block">Nama {mode === "owner" ? "Owner" : "(opsional)"}</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={mode === "owner" ? "Nama pemilik toko" : "Nama kamu"}
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
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "login" ? "Password kamu" : "Minimal 4 karakter"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none"
          />
        </label>
        {mode === "owner" && (
          <label className="block mb-4">
            <span className="text-[12px] text-zinc-400 mb-1 block flex items-center gap-1">
              <KeyRound className="w-3 h-3" /> Kode Owner
            </span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Kode rahasia dari pemilik"
              className="w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-zinc-500 focus:border-red-500 focus:outline-none font-mono"
            />
            <span className="text-[11px] text-zinc-600 mt-1 block">
              Belum punya kode? Hubungi developer toko ini. Tab ini bukan untuk customer.
            </span>
          </label>
        )}

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
          ) : mode === "owner" ? (
            <>
              <UserCog className="w-4 h-4" /> Buat Akun Owner
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

function StatCard({ icon, number, label }: { icon: ReactNode; number: string; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(0,230,118,0.10)" }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xl font-bold text-white truncate">{number}</p>
        <p className="text-[11px] text-zinc-400 truncate">{label}</p>
      </div>
    </div>
  );
}
