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
  Menu,
  ChevronDown,
  Globe,
  Users,
  Send,
  ArrowRightCircle,
  QrCode,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Copy,
} from "lucide-react";

import {
  apiCreatePayment,
  apiCheckPayment,
  apiCreateNumberOrder,
  apiGetOrderStatus,
  apiListCountries,
  apiListServices,
  computeSellPrice,
  formatRupiah,
  type Country,
  type ProviderId,
  type Service,
} from "@/lib/convexApi";

/* ---------- brand colors ---------- */
const RED = "#e10600";
const DARK = "#0b0b0f";
const WHITE = "#ffffff";
const ACCENT = "#00e676";

/* ---------- server data ---------- */
const SERVER_LIST: {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  description: string;
  badge: string | null;
}[] = [
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

type HistoryItem = {
  id: string;
  server: string;
  country: string;
  service: string;
  price: number;
  status: string;
  waktu: string;
  orderId?: string;
  otp?: string;
};

type PayPhase =
  | "idle"
  | "creating"
  | "waitingPayment"
  | "ordering"
  | "waitingOtp"
  | "success"
  | "error";

export default function NokosShopPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedServerId, setSelectedServerId] = useState(SERVER_LIST[0].id);
  const server = SERVER_LIST.find((s) => s.id === selectedServerId) || SERVER_LIST[0];

  /* ---------- data live dari server provider ---------- */
  const [countries, setCountries] = useState<Country[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedCountryId, setSelectedCountryId] = useState<number | string | null>(null);
  const [selectedServiceId, setSelectedServiceId] = useState<number | string | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  // Dipakai tombol "Muat Ulang Data" supaya efek pemuatan data benar-benar jalan lagi.
  const [reloadToken, setReloadToken] = useState(0);
  const [depositOpen, setDepositOpen] = useState(false);

  const [history, setHistory] = useState<HistoryItem[]>([]);

  /* ---------- checkout / deposit modal state ---------- */
  const [payPhase, setPayPhase] = useState<PayPhase>("idle");
  const [payMessage, setPayMessage] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payReference, setPayReference] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [resultOtp, setResultOtp] = useState<string | null>(null);
  const [resultOrderId, setResultOrderId] = useState<string | null>(null);
  const [resultPhone, setResultPhone] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedService = useMemo(() => {
    if (selectedServiceId == null) return null;
    return services.find((s) => String(s.service ?? s.id) === String(selectedServiceId)) || null;
  }, [services, selectedServiceId]);

  const sellPrice = useMemo(() => {
    if (!selectedService) return 0;
    return computeSellPrice(selectedService.price);
  }, [selectedService]);

  /* ---------- ambil negara per server ---------- */
  useEffect(() => {
    let cancelled = false;
    setCountries([]);
    setServices([]);
    setSelectedCountryId(null);
    setSelectedServiceId(null);
    setDataError(null);

    const load = async () => {
      setLoadingData(true);
      try {
        const list = await apiListCountries(server.provider);
        if (cancelled) return;
        if (list.length === 0) {
          setDataError("Server tidak mengembalikan daftar negara (kosong).");
          return;
        }
        setCountries(list);
        const first = list.find((c) => c.id != null) || list[0];
        setSelectedCountryId(first.id);
      } catch (err: any) {
        if (!cancelled) {
          setDataError(err?.message || "Gagal terhubung ke server provider.");
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      stopPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, reloadToken]);

  /* ---------- ambil layanan saat negara berubah ---------- */
  useEffect(() => {
    if (selectedCountryId == null) return;
    let cancelled = false;
    setServices([]);
    setSelectedServiceId(null);
    setLoadingData(true);

    const load = async () => {
      try {
        const list = await apiListServices(server.provider, selectedCountryId);
        if (cancelled) return;
        setServices(list);
        if (list.length > 0) {
          const first = list[0];
          setSelectedServiceId(first.service ?? first.id);
        }
      } catch (err: any) {
        if (!cancelled) setDataError(err?.message || "Gagal mengambil daftar layanan.");
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedCountryId, server.id]);

  /* ---------- polling helper ---------- */
  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pushHistory = (item: Omit<HistoryItem, "id" | "waktu">) => {
    setHistory((prev) => [
      { ...item, id: item.orderId || `t-${Date.now()}`, waktu: new Date().toLocaleString("id-ID") },
      ...prev.slice(0, 19),
    ]);
  };

  const closePaySheet = () => {
    stopPoll();
    setPayPhase("idle");
    setPayMessage(null);
    setPayError(null);
    setPayReference(null);
    setPayUrl(null);
    setResultOtp(null);
    setResultOrderId(null);
    setResultPhone(null);
  };

  /* =====================================================================
   * ALUR BELI NOMOR
   * 1) invoice Paymentku QRIS sebesar harga final
   * 2) tunggu lunas (auto-polling)
   * 3) pesan nomor ke server provider (potong saldo owner di provider)
   * 4) polling OTP sampai masuk
   * ===================================================================== */
  const handleBuy = async () => {
    if (!selectedService) {
      setPayError("Pilih layanan dulu.");
      return;
    }
    setPayPhase("creating");
    setPayError(null);
    setPayMessage("Membuat invoice pembayaran QR...");
    setPayAmount(sellPrice);

    try {
      const inv = await apiCreatePayment({
        amount: sellPrice,
        description: `${server.label} • ${selectedService.name || "Nomor OTP"}`,
      });
      if (!inv.ok || !inv.payUrl || !inv.referenceId) {
        setPayPhase("error");
        setPayError(inv.error || "Gagal membuat invoice pembayaran.");
        return;
      }
      setPayReference(inv.referenceId);
      setPayUrl(inv.payUrl);
      setPayPhase("waitingPayment");
      setPayMessage("Menunggu pembayaran QR. Buka link QR lalu bayar, status dicek otomatis...");

      // Buka halaman QR (popup kalau diizinkan browser)
      try {
        window.open(inv.payUrl, "_blank", "noopener");
      } catch {
        /* popup diblokir — user bisa klik tombol */
      }

      // Polling status pembayaran
      let paid = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const st = await apiCheckPayment(inv.referenceId).catch(() => null);
        if (st?.ok && st.paid) {
          paid = true;
          break;
        }
      }
      if (!paid) {
        setPayPhase("error");
        setPayError(
          "Pembayaran belum terkonfirmasi. Kalau sudah bayar, klik 'Cek Pembayaran' di bawah."
        );
        return;
      }

      setPayPhase("ordering");
      setPayMessage("Pembayaran diterima. Memesan nomor dari server provider...");

      const order = await apiCreateNumberOrder({
        provider: server.provider,
        country: selectedCountryId!,
        service: selectedService.service ?? selectedService.id!,
        providerPrice: selectedService.price,
      });
      if (!order.ok || !order.orderId) {
        setPayPhase("error");
        setPayError(
          order.error ||
            "Pembayaran sukses tapi server provider gagal memesan nomor. Hubungi admin untuk diproses manual."
        );
        return;
      }

      setResultOrderId(order.orderId);
      pushHistory({
        orderId: order.orderId,
        server: server.label,
        country: countries.find((c) => String(c.id) === String(selectedCountryId))?.name || "",
        service: selectedService.name || "",
        price: sellPrice,
        status: "Menunggu OTP",
      });

      setPayPhase("waitingOtp");
      setPayMessage("Nomor dipesan. Menunggu OTP masuk...");

      // Polling OTP dari provider
      let otp: string | null = null;
      let phone: string | null = null;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const st = await apiGetOrderStatus(server.provider, order.orderId).catch(() => null);
        if (st?.code != null && st.code !== "") {
          otp = String(st.code);
          break;
        }
        const raw = (st?.raw as any)?.data as any;
        if (raw && (raw.phone || raw.phone_number || raw.number)) {
          phone = String(raw.phone || raw.phone_number || raw.number);
        }
      }

      setResultOtp(otp);
      if (phone) setResultPhone(phone);
      setPayPhase(otp ? "success" : "error");
      if (otp) {
        setPayMessage("OTP masuk! Salin kode dan selesaikan verifikasi akun kamu.");
        pushHistory({
          orderId: order.orderId,
          server: server.label,
          country: countries.find((c) => String(c.id) === String(selectedCountryId))?.name || "",
          service: selectedService.name || "",
          price: sellPrice,
          status: "Berhasil",
          otp,
        });
      } else {
        setPayError(
          `Order ${order.orderId} dibuat tapi OTP belum masuk. Cek lagi sebentar lewat tombol "Cek OTP".`
        );
      }
    } catch (err: any) {
      setPayPhase("error");
      setPayError(err?.message || "Terjadi kesalahan saat proses pembelian.");
    }
  };

  const handleCheckPaymentAgain = async () => {
    if (!payReference) return;
    setPayMessage("Mengecek pembayaran...");
    const st = await apiCheckPayment(payReference).catch(() => null);
    if (st?.ok && st.paid) {
      setPayMessage("Pembayaran lunas. Silakan klik 'Pesan Nomor Sekarang'.");
      setPayPhase("ordering");
    } else {
      setPayError("Belum terdeteksi lunas. Pastikan QR sudah dibayar, lalu coba lagi.");
    }
  };

  const handleRetryOrder = async () => {
    if (!selectedService || selectedCountryId == null || !payReference) return;
    setPayError(null);

    // Jangan pesan nomor ke provider sebelum pembayaran benar-benar lunas
    // (saldo owner di provider tidak boleh kepotong untuk order yang belum dibayar).
    setPayMessage("Memverifikasi pembayaran dulu...");
    const check = await apiCheckPayment(payReference).catch(() => null);
    if (!check?.ok || !check.paid) {
      setPayPhase("error");
      setPayError("Pembayaran belum terdeteksi lunas. Pastikan QR sudah dibayar, lalu coba lagi.");
      return;
    }

    setPayPhase("ordering");
    setPayMessage("Memesan nomor dari server provider...");
    try {
      const order = await apiCreateNumberOrder({
        provider: server.provider,
        country: selectedCountryId,
        service: selectedService.service ?? selectedService.id!,
        providerPrice: selectedService.price,
      });
      if (!order.ok || !order.orderId) {
        setPayPhase("error");
        setPayError(order.error || "Server provider gagal memesan nomor.");
        return;
      }
      setResultOrderId(order.orderId);
      pushHistory({
        orderId: order.orderId,
        server: server.label,
        country: countries.find((c) => String(c.id) === String(selectedCountryId))?.name || "",
        service: selectedService.name || "",
        price: sellPrice,
        status: "Menunggu OTP",
      });
      setPayPhase("waitingOtp");
      setPayMessage("Nomor dipesan. Menunggu OTP masuk...");
    } catch (err: any) {
      setPayPhase("error");
      setPayError(err?.message || "Gagal memesan nomor.");
    }
  };

  const handleCheckOtp = async () => {
    if (!resultOrderId) return;
    setPayMessage("Mengecek OTP...");
    const st = await apiGetOrderStatus(server.provider, resultOrderId).catch(() => null);
    if (st?.code != null && st.code !== "") {
      setResultOtp(String(st.code));
      setPayPhase("success");
      setPayMessage("OTP masuk! Salin kode dan selesaikan verifikasi akun kamu.");
    } else {
      setPayError("OTP belum masuk. Nomor aktif ±20 menit; coba lagi beberapa saat.");
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard tidak tersedia */
    }
  };

  /* =====================================================================
   * ALUR DEPOSIT (uang masuk ke akun owner via QR Paymentku)
   * ===================================================================== */
  const [depositAmount, setDepositAmount] = useState(10000);
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositDone, setDepositDone] = useState(false);
  const [depositRef, setDepositRef] = useState<string | null>(null);

  const startDeposit = async () => {
    setDepositBusy(true);
    setDepositDone(false);
    setDepositRef(null);
    try {
      const inv = await apiCreatePayment({
        amount: depositAmount,
        description: "Deposit saldo KAKO NOKOS",
      });
      if (!inv.ok || !inv.payUrl || !inv.referenceId) {
        alert(inv.error || "Gagal membuat QR deposit.");
        return;
      }
      setDepositRef(inv.referenceId);
      try {
        window.open(inv.payUrl, "_blank", "noopener");
      } catch {
        /* ignore */
      }
      alert(
        "Kode QR deposit sudah dibuka di tab baru. Setelah bayar, konfirmasi ke admin (uang masuk ke akun owner dan saldo kamu diisi manual)."
      );
    } catch (err: any) {
      alert(err?.message || "Gagal membuat QR deposit.");
    } finally {
      setDepositBusy(false);
    }
  };

  const handleDeposit = () => {
    setDepositOpen(true);
  };

  const statusClass = (status: string) => {
    if (status === "Berhasil") return "bg-emerald-500/15 text-emerald-400";
    if (status === "Menunggu OTP" || status === "Pending") return "bg-amber-500/15 text-amber-400";
    return "bg-red-500/15 text-red-400";
  };

  const copyKeyHint = (provider: ProviderId) => {
    if (provider === "kirimkode") return "NOKOS_KIRIMKODE_API_KEY";
    if (provider === "ditznesia") return "NOKOS_DITZNESIA_API_KEY";
    return "NOKOS_DITZNESIA_API2_KEY";
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white selection:bg-red-500/30">
      {/* ================= HEADER ================= */}
      <header className="border-b border-white/10 bg-[#0b0b0f]/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between gap-3">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="lg:hidden w-10 h-10 rounded-xl flex items-center justify-center border border-white/10"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-red-600 flex items-center justify-center shadow-lg shadow-red-600/30 flex-shrink-0">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h2m16 0h2M8 12a4 4 0 0 1 4-4 4 4 0 0 1 4 4 4 4 0 0 1-4 4 4 4 0 0 1-4-4 4 4 0 0 1 4 4z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-extrabold tracking-tight truncate" style={{ color: WHITE }}>
                KAKO NOKOS
              </p>
              <p className="text-[11px] text-zinc-400 tracking-wide truncate">Toko Nomor Online</p>
            </div>
          </div>

          <nav className="hidden lg:flex items-center gap-6 text-sm">
            <a href="#beli" className="flex items-center gap-1.5 text-white font-medium">
              <ShoppingCart className="w-4 h-4" /> Beli Nomor
            </a>
            <button onClick={() => { setDepositAmount(10000); handleDeposit(); }} className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors">
              <Wallet className="w-4 h-4" /> Deposit
            </button>
            <a href="#cara" className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors">
              <ChevronDown className="w-4 h-4" /> Cara Kerja
            </a>
            <a href="#riwayat" className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors">
              <History className="w-4 h-4" /> Riwayat
            </a>
          </nav>

          <button
            onClick={handleDeposit}
            className="px-4 py-2 rounded-xl text-sm font-semibold shadow-lg transition-all hover:brightness-110 active:scale-[0.98] flex items-center gap-2 flex-shrink-0"
            style={{ backgroundColor: ACCENT, color: DARK }}
          >
            <Wallet className="w-4 h-4" />
            <span className="hidden sm:inline">Deposit</span>
          </button>
        </div>

        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden border-t border-white/10"
            >
              <div className="flex flex-col gap-1 p-4">
                <a href="#beli" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-white bg-white/5">
                  <ShoppingCart className="w-4 h-4" /> Beli Nomor
                </a>
                <button onClick={() => { setMobileMenuOpen(false); handleDeposit(); }} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-zinc-300 hover:bg-white/5 text-left">
                  <Wallet className="w-4 h-4" /> Deposit
                </button>
                <a href="#cara" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-zinc-300 hover:bg-white/5">
                  <ChevronDown className="w-4 h-4" /> Cara Kerja
                </a>
                <a href="#riwayat" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-zinc-300 hover:bg-white/5">
                  <History className="w-4 h-4" /> Riwayat
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="max-w-6xl mx-auto px-5 py-6">
        {/* ================= HERO ================= */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 md:p-8"
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-[13px] uppercase tracking-widest text-red-500 font-semibold">Platform Nomor Virtual</p>
              <h1 className="text-3xl md:text-4xl font-extrabold mt-2 leading-tight">
                Verifikasi Akun <span style={{ color: ACCENT }}>Tanpa Ribet</span>
              </h1>
              <p className="text-zinc-400 text-sm mt-3 max-w-xl">
                Nomor virtual untuk verifikasi WhatsApp, Telegram, Facebook, dan lainnya. Server,
                negara, layanan, stok, dan harga ditampilkan langsung dari API provider — bukan
                pajangan.
              </p>
              <div className="flex flex-wrap gap-3 mt-5">
                <a href="#beli" className="px-5 py-3 rounded-xl text-black text-sm font-bold shadow-lg flex items-center gap-2" style={{ backgroundColor: ACCENT }}>
                  Beli Nomor <ArrowRightCircle className="w-4 h-4" />
                </a>
                <button onClick={handleDeposit} className="px-5 py-3 rounded-xl text-white text-sm font-medium border border-white/20 flex items-center gap-2">
                  <Wallet className="w-4 h-4" /> Deposit
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={<Globe className="w-5 h-5" />} number={String(countries.length || "-")} label="Negara (live)" />
              <StatCard icon={<Send className="w-5 h-5" />} number={String(services.length || "-")} label="Layanan (live)" />
              <StatCard icon={<Users className="w-5 h-5" />} number="QRIS" label="Pembayaran" />
              <StatCard icon={<Zap className="w-5 h-5" />} number="+30%" label="Sudah final" />
            </div>
          </div>
        </motion.div>

        {/* ================= KARTU INFO ALUR ================= */}
        <div id="cara" className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 scroll-mt-20">
          {[
            { icon: <Zap className="w-5 h-5 text-red-500" />, title: "Server Pilihan", desc: "KirimKode, Ditznesia, dan Ditznesia API v2. Data tiap server diambil live dari API-nya masing-masing." },
            { icon: <ShieldCheck className="w-5 h-5 text-red-500" />, title: "Bayar QR, Nomor Masuk", desc: "Pembayaran via QR Paymentku. Setelah lunas, nomor langsung dipesan dari server (saldo owner di website provider)." },
            { icon: <PhoneIncoming className="w-5 h-5 text-red-500" />, title: "OTP Masuk Otomatis", desc: "Kode OTP dicek otomatis sampai masuk dan ditampilkan di halaman ini." },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 flex gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(225,6,0,0.18)" }}>
                {item.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="text-[12px] text-zinc-400 mt-1 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* ================= PILIH SERVER ================= */}
        <section id="beli" className="mt-8 scroll-mt-20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: RED }} />
              Pilih Server
            </h2>
            <span className="text-[13px] text-zinc-400">Data live dari API provider</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SERVER_LIST.map((s) => {
              const active = selectedServerId === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedServerId(s.id)}
                  className={`rounded-2xl border text-left p-4 transition-all ${
                    active
                      ? "border-red-600 bg-red-600/10 shadow-lg shadow-red-600/15"
                      : "border-white/10 bg-zinc-900/40 hover:border-white/20"
                  }`}
                >
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
                </button>
              );
            })}
          </div>
        </section>

        {/* ================= DATA SERVER ================= */}
        <section className="mt-6">
          {dataError ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
              <div className="flex items-start gap-3">
                <XCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-300">Server {server.label} belum terhubung</p>
                  <p className="text-[13px] text-red-200/80 mt-1 leading-relaxed">{dataError}</p>
                  <p className="text-[13px] text-zinc-300 mt-3">
                    Kemungkinan penyebab: (1) backend toko belum aktif, atau (2) pemilik toko belum mengisi
                    kunci API di <b>Settings → Environment</b> dengan nama{" "}
                    <code className="text-red-300 font-mono bg-white/5 px-1.5 py-0.5 rounded">{copyKeyHint(server.provider)}</code>{" "}
                    (kunci dari dashboard {server.providerLabel}). Hubungi admin untuk mengaktifkan server ini.
                  </p>
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
                  <Globe className="w-4 h-4 text-red-500" /> Negara ({server.providerLabel})
                </h3>
                <p className="text-[12px] text-zinc-500 mb-3">Dari API server — {loadingData ? "memuat..." : `${countries.length} negara`}</p>
                {countries.length === 0 ? (
                  <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> Memuat negara...
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto pr-1">
                    {countries.map((c) => {
                      const key = String(c.id ?? c.name);
                      const active = String(selectedCountryId) === key;
                      return (
                        <button
                          key={key}
                          onClick={() => setSelectedCountryId(c.id)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex-shrink-0 ${
                            active ? "text-white shadow-md" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                          }`}
                          style={active ? { backgroundColor: RED } : {}}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Layanan */}
              <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
                <h3 className="text-base font-bold text-white flex items-center gap-2 mb-1">
                  <ShoppingCart className="w-4 h-4 text-red-500" /> Layanan
                </h3>
                <p className="text-[12px] text-zinc-500 mb-3">
                  {loadingData ? "memuat..." : `${services.length} layanan tersedia`}
                </p>
                {services.length === 0 ? (
                  <div className="flex items-center gap-2 text-[13px] text-zinc-500 py-6 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> Memuat layanan...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-44 overflow-y-auto pr-1">
                    {services.map((s) => {
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
                            <span style={{ color: ACCENT }}>Rp {formatRupiah(computeSellPrice(s.price))}</span>
                            <span className="text-zinc-500"> • stok {isOut ? "habis" : s.stock}</span>
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* ================= RINGKASAN + BELI ================= */}
        <motion.div
          className="mt-8 rounded-2xl overflow-hidden border shadow-xl shadow-red-600/20"
          style={{ backgroundColor: DARK, borderColor: RED }}
        >
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
              <p className="text-[11px] uppercase tracking-widest text-zinc-400">Harga Final</p>
              <p className="text-2xl font-extrabold mt-1">Rp {formatRupiah(sellPrice)}</p>
              <p className="text-[12px] text-zinc-400 mt-1">harga server + 30% (sudah final)</p>
            </div>
          </div>

          <div className="px-5 pb-5">
            <button
              onClick={handleBuy}
              disabled={!selectedService || loadingData || payPhase === "creating"}
              className={`w-full py-4 rounded-xl text-base font-bold shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                !selectedService
                  ? "bg-zinc-700 text-zinc-500"
                  : "bg-white text-black hover:brightness-95 active:scale-[0.99]"
              }`}
            >
              {payPhase === "creating" ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Membuat invoice...
                </>
              ) : (
                <>
                  <QrCode className="w-5 h-5" /> Beli & Bayar QR
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
            <p className="text-[12px] text-zinc-400 text-center mt-2">
              Bayar via QR Paymentku → setelah lunas nomor langsung dipesan dari server {server.providerLabel}.
            </p>
          </div>
        </motion.div>

        {/* ================= RIWAYAT ================= */}
        <section id="riwayat" className="mt-10 scroll-mt-20">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-red-500" /> Transaksi Sesi Ini
            </h2>
          </div>

          {history.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/40 p-8 text-center">
              <History className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
              <p className="text-sm text-zinc-400">Belum ada transaksi di sesi ini.</p>
              <p className="text-[12px] text-zinc-500 mt-1">Pilih server dan lakukan pembelian untuk melihat hasilnya di sini.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.id} className="grid grid-cols-1 sm:grid-cols-5 gap-2 px-4 py-3 rounded-xl bg-zinc-900/60 items-center text-sm">
                  <span className="text-white font-medium">{item.server} • {item.service}</span>
                  <span className="text-zinc-400 text-[13px]">{item.country}</span>
                  <span className="text-zinc-500 text-[12px] font-mono truncate">
                    {item.otp ? `OTP: ${item.otp}` : item.orderId || "-"}
                  </span>
                  <span>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${statusClass(item.status)}`}>
                      {item.status}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="text-white font-semibold">Rp {formatRupiah(item.price)}</span>
                    <br />
                    <span className="text-zinc-500 text-[11px]">{item.waktu}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ================= SHEET CHECKOUT / DEPOSIT ================= */}
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

              {/* Alur: 4 langkah */}
              <div className="grid grid-cols-4 gap-1 mb-5">
                {[
                  { label: "Invoice", state: ["creating", "waitingPayment"] },
                  { label: "Bayar QR", state: ["waitingPayment"] },
                  { label: "Order", state: ["ordering", "waitingOtp"] },
                  { label: "OTP", state: ["success"] },
                ].map((step) => {
                  const isActive = (step.state as string[]).includes(payPhase);
                  const isPast = ["creating", "waitingPayment"].includes(payPhase) && step.label === "Invoice";
                  const isDone =
                    (["ordering", "waitingOtp", "success", "error"].includes(payPhase) && ["Invoice", "Bayar QR"].includes(step.label)) ||
                    (["waitingOtp", "success", "error"].includes(payPhase) && step.label === "Order");
                  return (
                    <div key={step.label} className="flex flex-col items-center gap-1">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                          isPast || isDone
                            ? "bg-emerald-500 text-black"
                            : isActive
                            ? "bg-white text-black"
                            : "bg-zinc-800 text-zinc-500"
                        }`}
                      >
                        {isPast || isDone ? "✓" : "•"}
                      </div>
                      <span className="text-[10px] text-zinc-500">{step.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Status icon */}
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

              {/* Ringkasan */}
              {payAmount > 0 && (
                <div className="flex justify-between items-center rounded-xl bg-white/5 px-4 py-3 mb-4">
                  <span className="text-[13px] text-zinc-300">Total yang dibayar</span>
                  <span className="font-extrabold text-white">Rp {formatRupiah(payAmount)}</span>
                </div>
              )}

              {/* QR link */}
              {payUrl && (
                <div className="space-y-2 mb-4">
                  <a
                    href={payUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-black"
                    style={{ backgroundColor: ACCENT }}
                  >
                    <QrCode className="w-5 h-5" /> Buka / Scan QR Pembayaran
                  </a>
                  <button
                    onClick={() => handleCopy(payUrl)}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold border border-white/10 text-zinc-300 hover:bg-white/5"
                  >
                    <Copy className="w-3.5 h-3.5" /> Salin link QR
                  </button>
                </div>
              )}

              {/* OTP hasil */}
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

              {resultOrderId && (
                <p className="text-center text-[12px] text-zinc-500 font-mono mb-3 break-all">Order: {resultOrderId}</p>
              )}

              {/* Tombol aksi per kondisi */}
              {payPhase === "waitingPayment" && (
                <button
                  onClick={handleCheckPaymentAgain}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-white text-black hover:brightness-95"
                >
                  Saya Sudah Bayar — Cek Status
                </button>
              )}
              {payPhase === "error" && payReference && !resultOrderId && (
                <button
                  onClick={handleRetryOrder}
                  className="w-full py-3 rounded-xl text-sm font-bold bg-white text-black hover:brightness-95"
                >
                  Pembayaran Sudah Lunas — Pesan Nomor Sekarang
                </button>
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

      {/* ================= MODAL DEPOSIT ================= */}
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
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-t-3xl sm:rounded-3xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Wallet className="w-5 h-5" style={{ color: ACCENT }} /> Deposit Saldo
                </h3>
                <button onClick={() => setDepositOpen(false)} className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400">
                  ✕
                </button>
              </div>

              <p className="text-[13px] text-zinc-400 mb-4 leading-relaxed">
                Pilih nominal deposit. Pembayaran via <b className="text-white">QR Paymentku</b> — dana masuk ke
                akun owner, lalu saldo toko kamu diisi oleh admin.
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

              {depositDone ? (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3 text-center text-sm text-emerald-300">
                  ✅ QR dibuat. Selesaikan pembayaran lalu konfirmasi ke admin. (Ref: {depositRef})
                </div>
              ) : (
                <button
                  onClick={startDeposit}
                  disabled={depositBusy || depositAmount < 5000}
                  className="w-full py-3.5 rounded-xl text-sm font-bold bg-white text-black hover:brightness-95 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {depositBusy ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Membuat QR...
                    </>
                  ) : (
                    <>
                      <QrCode className="w-4 h-4" /> Buat QR Pembayaran
                    </>
                  )}
                </button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <footer className="border-t border-white/10 mt-12 py-6 text-center text-[12px] text-zinc-500">
        <p className="font-semibold text-white tracking-wide">KAKO NOKOS</p>
        <p className="mt-1">Harga final = harga server + 30%. Pembayaran QR via Paymentku.</p>
      </footer>
    </div>
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
