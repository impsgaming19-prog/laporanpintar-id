import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BarChart3,
  Users,
  ReceiptText,
  QrCode,
  UserCog,
  Server as ServerIcon,
  ShieldCheck,
  Wallet,
  Search,
  Plus,
  Minus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  KeyRound,
  Save,
  Crown,
  Headset,
  X,
  AlertTriangle,
  TrendingUp,
} from "lucide-react";
import {
  apiAdminAdjustBalance,
  apiAdminDeposits,
  apiAdminListUsers,
  apiAdminOrders,
  apiAdminRefundOrder,
  apiAdminStats,
  apiOwnerUpdateLogin,
  apiShopCreateStaff,
  apiShopDeleteStaff,
  apiShopGetConfig,
  apiShopGetSettings,
  apiShopSetConfig,
  apiShopSetServerEnabled,
  type AdminDeposit,
  type AdminOrder,
  type AdminStats,
  type AdminUser,
  type ShopUser,
} from "@/lib/convexApi";
import { OwnerInsights } from "./ownerInsights";

/* ---------- brand ---------- */
const RED = "#e10600";
const DARK = "#0b0b0f";
const ACCENT = "#00e676";

const fmtRp = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

const fmtDT = (ms: number | null | undefined) => {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const STATUS_META: Record<string, { label: string; cls: string; dot: string }> = {
  pending: { label: "Menunggu", cls: "bg-amber-500/10 text-amber-300 border-amber-500/30", dot: "#fbbf24" },
  active: { label: "Aktif · cek OTP", cls: "bg-sky-500/10 text-sky-300 border-sky-500/30", dot: "#38bdf8" },
  otp: { label: "OTP masuk", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", dot: "#00e676" },
  done: { label: "Selesai", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", dot: "#00e676" },
  cancelled: { label: "Dibatalkan", cls: "bg-zinc-500/10 text-zinc-400 border-white/10", dot: "#a1a1aa" },
  refunded: { label: "Refund", cls: "bg-red-500/10 text-red-300 border-red-500/30", dot: "#e10600" },
  failed: { label: "Gagal", cls: "bg-red-500/10 text-red-300 border-red-500/30", dot: "#e10600" },
  error: { label: "Error", cls: "bg-red-500/10 text-red-300 border-red-500/30", dot: "#e10600" },
};

const statusMeta = (s: string) =>
  STATUS_META[s] || { label: s || "—", cls: "bg-white/5 text-zinc-300 border-white/10", dot: "#a1a1aa" };

const REFUNDABLE = (s: string) =>
  !["done", "otp", "cancelled", "refunded", "failed", "error"].includes(s);

const SERVER_ROWS = [
  { id: "jasav1", label: "JasaOTP v1", provider: "KirimKode", badge: "Populer", desc: "Negara, layanan, stok & harga langsung dari API KirimKode." },
  { id: "jasav2", label: "JasaOTP v2", provider: "Ditznesia", badge: null, desc: "Data live dari API Ditznesia v1." },
  { id: "jasav3", label: "JasaOTP v3", provider: "Ditznesia API v2", badge: null, desc: "Pilihan nomor mengikuti stok server Ditznesia v2." },
  { id: "jasav4", label: "JasaOTP v4", provider: "Ditznesia API v2", badge: "Baru", desc: "Server tambahan Ditznesia v2 (aktif bila kunci terisi)." },
];

type HubTab = "ringkasan" | "customer" | "transaksi" | "deposit" | "staff" | "server" | "laporan" | "akun";

function Chip({ children, cls }: { children: ReactNode; cls?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold border ${cls || "bg-white/5 text-zinc-300 border-white/10"}`}>
      {children}
    </span>
  );
}

function StatCard({ icon, value, label, accent = false }: { icon: ReactNode; value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 flex items-center gap-3 transition-transform hover:-translate-y-0.5">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
        style={accent
          ? { background: "rgba(0,230,118,0.12)", borderColor: "rgba(0,230,118,0.25)", color: ACCENT }
          : { background: "rgba(225,6,0,0.10)", borderColor: "rgba(225,6,0,0.22)", color: "#ff6b63" }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-lg font-black text-white truncate">{value}</p>
        <p className="text-[11px] text-zinc-400 truncate">{label}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="text-[12px] text-zinc-400 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl bg-zinc-800 border border-white/10 px-4 py-2.5 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none";

export function AdminHub({
  user,
  onClose,
  onUserUpdated,
}: {
  user: ShopUser;
  onClose: () => void;
  onUserUpdated: (u: ShopUser) => void;
}) {
  const isOwner = user.role === "owner";
  const actorId = user.id;

  const [tab, setTab] = useState<HubTab>(isOwner ? "ringkasan" : "customer");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [serverMap, setServerMap] = useState<Record<string, boolean>>({});
  const [feeStr, setFeeStr] = useState<string>("");

  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("all");

  /* confirm + small forms */
  const [editAmt, setEditAmt] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRefund, setConfirmRefund] = useState<string | null>(null);

  /* staff form */
  const [sf, setSf] = useState({ fullName: "", username: "", password: "" });
  const [sfShow, setSfShow] = useState(false);

  /* akun owner */
  const [af, setAf] = useState({ fullName: user.fullName, username: user.username, curPass: "", newPass: "", newPass2: "" });
  const [afShow, setAfShow] = useState(false);

  const flash = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    window.setTimeout(() => setMsg(null), 6000);
  };

  const reload = async () => {
    setLoading(true);
    try {
      const [us, or] = await Promise.all([apiAdminListUsers(actorId), apiAdminOrders(actorId)]);
      if (us.ok && us.users) setUsers(us.users);
      if (or.ok && or.orders) setOrders(or.orders);
      if (!us.ok) flash("err", us.error || "Gagal memuat customer.");
      if (!or.ok) flash("err", or.error || "Gagal memuat transaksi.");
      if (isOwner) {
        const [st, dp, sv, gc] = await Promise.all([
          apiAdminStats(actorId),
          apiAdminDeposits(actorId),
          apiShopGetSettings().catch(() => ({ ok: false as const })),
          apiShopGetConfig().catch(() => ({ ok: false as const })),
        ]);
        if (st.ok && st.stats) setStats(st.stats);
        if (dp.ok && dp.deposits) setDeposits(dp.deposits);
        if (sv.ok && sv.servers) setServerMap(sv.servers);
        if (gc.ok && gc.config) setFeeStr(String(gc.config.feePct ?? 0));
        if (!st.ok) flash("err", st.error || "Gagal memuat statistik.");
        if (!dp.ok) flash("err", dp.error || "Gagal memuat deposit.");
      }
    } catch (err: any) {
      flash("err", err?.message || "Gagal memuat data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- derived ---------- */
  const customers = useMemo(() => users.filter((u) => u.role === "customer"), [users]);
  const staff = useMemo(() => users.filter((u) => u.role === "cs"), [users]);

  const byUser = useMemo(() => {
    const m: Record<string, { count: number; total: number; lastAt: number }> = {};
    for (const o of orders) {
      const r = (m[o.userId] ||= { count: 0, total: 0, lastAt: 0 });
      r.count += 1;
      if (!["cancelled", "refunded", "failed", "error"].includes(o.status)) r.total += o.sellPrice || 0;
      r.lastAt = Math.max(r.lastAt, o.createdAt || 0);
    }
    return m;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders
      .filter((o) => (statusF === "all" ? true : o.status === statusF))
      .filter((o) =>
        term
          ? (o.username || "").toLowerCase().includes(term) ||
            (o.fullName || "").toLowerCase().includes(term) ||
            (o.serviceName || "").toLowerCase().includes(term) ||
            (o.countryName || "").toLowerCase().includes(term) ||
            (o.orderId || "").toLowerCase().includes(term)
          : true
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [orders, q, statusF]);

  const filteredCustomers = useMemo(() => {
    const term = q.trim().toLowerCase();
    return customers.filter((u) =>
      term
        ? (u.username || "").toLowerCase().includes(term) ||
          (u.fullName || "").toLowerCase().includes(term)
        : true
    );
  }, [customers, q]);

  const depositPaid = deposits.filter((d) => d.status === "paid");
  const depositPaidTotal = depositPaid.reduce((s, d) => s + (d.amount || 0), 0);
  const depositPendingTotal = deposits
    .filter((d) => d.status !== "paid")
    .reduce((s, d) => s + (d.amount || 0), 0);

  const soldStatuses = ["ordered", "active", "otp", "done"];
  const orderStats = useMemo(() => {
    let sold = 0;
    let refunded = 0;
    for (const o of orders) {
      if (soldStatuses.includes(o.status)) sold += o.sellPrice || 0;
      else if (o.status === "refunded") refunded += o.sellPrice || 0;
    }
    return { sold, refunded };
  }, [orders]);

  /* ---------- actions ---------- */
  const applyAdjust = async (u: AdminUser, delta: number) => {
    if (delta === 0) return;
    const res = await apiAdminAdjustBalance(actorId, u.id, delta).catch(() => null);
    if (res?.ok) {
      flash("ok", `Saldo ${u.fullName || u.username} → ${fmtRp(res.balance || 0)}`);
      reload();
    } else {
      flash("err", res?.error || "Gagal mengubah saldo.");
    }
  };

  const doRefund = async (o: AdminOrder) => {
    setConfirmRefund(null);
    const res = await apiAdminRefundOrder(actorId, o.id).catch(() => null);
    if (res?.ok) {
      flash("ok", `Order ${o.orderId} di-refund — ${fmtRp(res.refunded || 0)} kembali ke customer.`);
      reload();
    } else {
      flash("err", res?.error || "Gagal refund order.");
    }
  };

  const createStaff = async () => {
    if (!sf.fullName.trim() || !sf.username.trim() || sf.password.length < 4) {
      flash("err", "Lengkapi nama, email, dan password (min. 4 karakter).");
      return;
    }
    const res = await apiShopCreateStaff({
      actorId,
      username: sf.username.trim().toLowerCase(),
      password: sf.password,
      fullName: sf.fullName.trim(),
    }).catch(() => null);
    if (res?.ok) {
      flash("ok", `Akun CS ${sf.username.trim()} berhasil dibuat.`);
      setSf({ fullName: "", username: "", password: "" });
      reload();
    } else {
      flash("err", res?.error || "Gagal membuat akun CS.");
    }
  };

  const deleteStaff = async (uid: string, email: string) => {
    setConfirmDelete(null);
    const res = await apiShopDeleteStaff(actorId, uid).catch(() => null);
    if (res?.ok) {
      flash("ok", `Akun CS ${email} dihapus.`);
      reload();
    } else {
      flash("err", res?.error || "Gagal menghapus akun CS.");
    }
  };

  const toggleServer = async (id: string, enabled: boolean) => {
    const res = await apiShopSetServerEnabled(actorId, id, enabled).catch(() => null);
    if (res?.ok) {
      if (res.servers) setServerMap(res.servers);
      flash("ok", `Server ${enabled ? "dinyalakan" : "dimatikan"} — ${SERVER_ROWS.find((s) => s.id === id)?.label || id}.`);
    } else {
      flash("err", res?.error || "Gagal mengubah server.");
    }
  };

  const saveFee = async () => {
    const v = Math.round((Number(String(feeStr).replace(",", ".")) || 0) * 100) / 100;
    if (!Number.isFinite(v) || v < 0 || v > 10) {
      flash("err", "Fee harus angka antara 0–10 persen (contoh: 0,7).");
      return;
    }
    const res = await apiShopSetConfig(actorId, v).catch(() => null);
    if (res?.ok) {
      setFeeStr(String(res.feePct ?? v));
      flash("ok", `Fee Paymentku disimpan ${res.feePct ?? v}%. Untung bersih di bawah sudah dihitung ulang.`);
    } else {
      flash("err", res?.error || "Gagal menyimpan fee.");
    }
  };

  const saveOwnerAccount = async () => {
    if (!af.curPass) {
      flash("err", "Masukkan password lama untuk verifikasi.");
      return;
    }
    if (af.newPass && af.newPass !== af.newPass2) {
      flash("err", "Password baru tidak sama di kolom ulangi.");
      return;
    }
    if (af.newPass && af.newPass.length < 4) {
      flash("err", "Password baru minimal 4 karakter.");
      return;
    }
    const res = await apiOwnerUpdateLogin({
      userId: actorId,
      currentPassword: af.curPass,
      newUsername: af.username !== user.username ? af.username.trim() : undefined,
      newPassword: af.newPass || undefined,
      newFullName: af.fullName !== user.fullName ? af.fullName.trim() : undefined,
    }).catch(() => null);
    if (res?.ok) {
      flash("ok", "Akun Owner diperbarui. Login berikutnya pakai data baru.");
      setAf((p) => ({ ...p, curPass: "", newPass: "", newPass2: "" }));
      onUserUpdated({ ...user, username: af.username.trim(), fullName: af.fullName.trim() });
      if (af.newPass) {
        // password berubah → sesi lama tetap jalan (id sama), tidak ada yang perlu di-login ulang
      }
    } else {
      flash("err", res?.error || "Gagal memperbarui akun. Cek password lama.");
    }
  };

  const tabs: { id: HubTab; label: string; icon: ReactNode; ownerOnly?: boolean }[] = [
    { id: "ringkasan", label: "Ringkasan", icon: <BarChart3 className="w-4 h-4" />, ownerOnly: true },
    { id: "customer", label: "Customer", icon: <Users className="w-4 h-4" /> },
    { id: "transaksi", label: "Transaksi", icon: <ReceiptText className="w-4 h-4" /> },
    { id: "deposit", label: "Deposit", icon: <QrCode className="w-4 h-4" />, ownerOnly: true },
    { id: "staff", label: "Staff CS", icon: <Headset className="w-4 h-4" />, ownerOnly: true },
    { id: "server", label: "Server", icon: <ServerIcon className="w-4 h-4" />, ownerOnly: true },
    { id: "laporan", label: "Laporan & Monitoring", icon: <TrendingUp className="w-4 h-4" />, ownerOnly: true },
    { id: "akun", label: "Akun Owner", icon: <UserCog className="w-4 h-4" />, ownerOnly: true },
  ];
  const visibleTabs = tabs.filter((t) => isOwner || !t.ownerOnly);

  const passField = (val: string, set: (v: string) => void, ph: string, cls = "") => (
    <div className="relative">
      <input
        type={afShow ? "text" : "password"}
        value={val}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        autoComplete="off"
        className={`${inputCls} pr-11 ${cls}`}
      />
      <button
        type="button"
        onClick={() => setAfShow((v) => !v)}
        tabIndex={-1}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5"
        aria-label="Lihat/sembunyikan password"
      >
        {afShow ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );

  /* ---------- hitung untung bersih (setelah fee Paymentku) ---------- */
  const feePctNum = Math.min(10, Math.max(0, Number(String(feeStr).replace(",", ".")) || 0));
  const grossProfitNum =
    stats?.profitGross ??
    orders.reduce(
      (s, o) => (soldStatuses.includes(o.status) ? s + ((o.sellPrice || 0) - (o.providerPrice || 0)) : s),
      0
    );
  const feeEst = Math.round((depositPaidTotal * feePctNum) / 100);
  const netProfitNum = Math.max(0, grossProfitNum - feeEst);

  return (
    <>
      <div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
        <div
          className="w-full max-w-5xl h-[94vh] sm:h-[88vh] bg-zinc-950 border border-white/10 rounded-t-3xl sm:rounded-3xl flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ===== header ===== */}
          <div className="px-5 pt-5 pb-4 border-b border-white/10 shrink-0" style={{ background: "linear-gradient(135deg, rgba(225,6,0,0.14), rgba(11,11,15,0) 60%)" }}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 border border-white/20"
                  style={{ background: "linear-gradient(140deg,#ff3d2e,#e10600 55%,#7a0a05)", boxShadow: "0 10px 26px -8px rgba(225,6,0,0.7), inset 0 1px 0 rgba(255,255,255,0.3)" }}
                >
                  {isOwner ? <Crown className="w-5 h-5 text-white" /> : <Headset className="w-5 h-5 text-white" />}
                </div>
                <div className="min-w-0">
                  <p className="font-black text-lg text-white truncate flex items-center gap-2">
                    Panel Admin
                    <Chip cls={isOwner ? "bg-red-500/15 text-red-300 border-red-500/30" : "bg-sky-500/15 text-sky-300 border-sky-500/30"}>
                      {isOwner ? "OWNER" : "CS"}
                    </Chip>
                  </p>
                  <p className="text-[12px] text-zinc-400 truncate">
                    {user.fullName} · {user.username}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={reload}
                  disabled={loading}
                  className="w-9 h-9 rounded-xl border border-white/10 flex items-center justify-center text-zinc-300 hover:bg-white/5 disabled:opacity-50"
                  title="Muat ulang data"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-300"
                  title="Tutup"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* tabs */}
            <div className="flex gap-1.5 mt-4 overflow-x-auto pb-0.5 -mx-1 px-1">
              {visibleTabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    setMsg(null);
                  }}
                  className={`px-3.5 py-2 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 whitespace-nowrap transition-all shrink-0 ${
                    tab === t.id ? "text-black" : "border border-white/10 text-zinc-300 hover:bg-white/5"
                  }`}
                  style={tab === t.id ? { background: ACCENT, boxShadow: "0 6px 18px -6px rgba(0,230,118,0.6)" } : {}}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            {msg && (
              <div
                className={`mt-3 text-[12.5px] rounded-xl px-4 py-2.5 border flex items-center gap-2 ${
                  msg.kind === "ok"
                    ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/25"
                    : "bg-red-500/10 text-red-300 border-red-500/25"
                }`}
              >
                {msg.kind === "ok" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                {msg.text}
              </div>
            )}
          </div>

          {/* ===== body ===== */}
          <div className="flex-1 overflow-y-auto px-5 py-5">
            {/* ---- CS info ---- */}
            {!isOwner && (
              <div className="mb-4 rounded-2xl border border-sky-500/25 p-4 text-[13px] text-zinc-300 leading-relaxed flex gap-3 items-start" style={{ background: "linear-gradient(135deg, rgba(56,189,248,0.08), transparent)" }}>
                <Headset className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
                <div>
                  <b className="text-white">Akses CS</b> — kamu bisa melihat seluruh <b>Customer</b>, <b>ubah saldo</b>, dan <b>refund transaksi</b> (sebelum OTP masuk) untuk melayani. Menu Ringkasan, Deposit, Staff, Server, dan Akun Owner khusus <b>Owner</b>.
                </div>
              </div>
            )}

            {/* ---- RINGKASAN ---- */}
            {tab === "ringkasan" && isOwner && stats && (
              <div className="space-y-5">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard icon={<Users className="w-5 h-5" />} value={String(stats.customerCount ?? 0)} label="Customer terdaftar" />
                  <StatCard icon={<Wallet className="w-5 h-5" />} value={fmtRp(stats.totalBalance ?? 0)} label="Total saldo customer" accent />
                  <StatCard icon={<QrCode className="w-5 h-5" />} value={fmtRp(depositPaidTotal || stats.depositTotal || 0)} label="Total deposit lunas" />
                  <StatCard icon={<ReceiptText className="w-5 h-5" />} value={fmtRp(orderStats.sold || stats.soldTotal || 0)} label="Total penjualan (jual)" accent />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard icon={<BarChart3 className="w-5 h-5" />} value={String(stats.activeOrderCount ?? 0)} label="Order aktif (cek OTP)" />
                  <StatCard icon={<ReceiptText className="w-5 h-5" />} value={String(stats.orderCount ?? 0)} label="Total order" />
                  <StatCard icon={<ShieldCheck className="w-5 h-5" />} value={fmtRp(stats.refundTotal ?? orderStats.refunded)} label="Total refund" />
                  <StatCard icon={<Crown className="w-5 h-5" />} value={`± ${fmtRp(Math.round((orderStats.sold || 0) * 0.3))}`} label="Untungmu (±30% dari jual)" accent />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard icon={<Headset className="w-5 h-5" />} value={String(stats.staffCount ?? 0)} label="Akun CS" />
                  <StatCard icon={<Users className="w-5 h-5" />} value={String(stats.ownerCount ?? 0)} label="Owner" />
                  <StatCard icon={<QrCode className="w-5 h-5" />} value={String(stats.depositPending ?? 0)} label="Deposit pending" />
                  <StatCard icon={<BarChart3 className="w-5 h-5" />} value={fmtRp(depositPendingTotal)} label="Nominal deposit pending" />
                </div>

                <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4 space-y-3">
                  <p className="text-[13px] text-zinc-400 leading-relaxed">
                    <b className="text-white">Catatan margin:</b> harga jual = harga provider ÷ 0,7 — setiap Rp 100 yang dibayar
                    customer, ±Rp 30 adalah untungmu (sisanya biaya nomor ke provider). Estimasi dihitung dari penjualan berstatus
                    ordered/aktif/OTP/selesai.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="text-[11px] text-zinc-500 mb-1 block">Fee Paymentku (persen dari deposit masuk)</span>
                      <div className="flex items-center gap-2">
                        <input
                          value={feeStr}
                          onChange={(e) => setFeeStr(e.target.value)}
                          placeholder="cth: 0,7"
                          inputMode="decimal"
                          className="w-28 rounded-xl bg-zinc-800 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          onClick={saveFee}
                          disabled={loading}
                          className="px-3.5 py-2 rounded-xl text-[12px] font-bold text-black disabled:opacity-50"
                          style={{ background: ACCENT }}
                        >
                          Simpan fee
                        </button>
                      </div>
                    </label>
                    <span className="text-[11px] text-zinc-500 pb-2">
                      Isi persentase potongan Paymentku (misal 0,7) supaya estimasi untung bersih di bawah akurat.
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t border-white/5">
                    <StatCard icon={<Crown className="w-5 h-5" />} value={fmtRp(grossProfitNum)} label="Untung kotor (margin order)" />
                    <StatCard icon={<QrCode className="w-5 h-5" />} value={`− ${fmtRp(feeEst)}`} label={`Estimasi fee Paymentku (${feePctNum}% × deposit)`} />
                    <StatCard icon={<Wallet className="w-5 h-5" />} value={fmtRp(netProfitNum)} label="Untung bersih (setelah fee)" accent />
                    <StatCard icon={<ReceiptText className="w-5 h-5" />} value={fmtRp(stats?.refundTotal ?? orderStats.refunded)} label="Total refund (pengurang)" />
                  </div>
                </div>

                {/* aktivitas customer terakhir */}
                {customers.length > 0 && (
                  <div>
                    <p className="text-[13px] font-bold text-white mb-2 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4" style={{ color: ACCENT }} /> Customer paling aktif
                    </p>
                    <div className="space-y-2">
                      {[...customers]
                        .map((u) => ({ u, by: byUser[u.id] }))
                        .filter((x) => x.by)
                        .sort((a, b) => (b.by?.total || 0) - (a.by?.total || 0))
                        .slice(0, 5)
                        .map(({ u, by }) => (
                          <div key={u.id} className="flex items-center gap-3 rounded-xl bg-zinc-900/60 border border-white/10 px-4 py-2.5">
                            <span className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-black bg-red-600/20 text-red-300 border border-red-500/25 flex-shrink-0">
                              {(u.fullName || u.username || "?").slice(0, 1).toUpperCase()}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] text-white font-semibold truncate">{u.fullName || "—"}</p>
                              <p className="text-[11px] text-zinc-500 truncate">{u.username}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-[13px] font-bold" style={{ color: ACCENT }}>{fmtRp(by?.total || 0)}</p>
                              <p className="text-[11px] text-zinc-500">{by?.count || 0} order</p>
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ---- CUSTOMER ---- */}
            {tab === "customer" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[220px]">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Cari nama / email customer…"
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                  <Chip cls="bg-white/5 text-zinc-300 border-white/10">{filteredCustomers.length} customer</Chip>
                </div>

                {filteredCustomers.length === 0 && (
                  <div className="text-center py-12 text-[13px] text-zinc-500">Belum ada customer terdaftar.</div>
                )}

                <div className="space-y-2">
                  {filteredCustomers.map((u) => {
                    const by = byUser[u.id];
                    return (
                      <div key={u.id} className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="w-9 h-9 rounded-full flex items-center justify-center font-black text-sm bg-red-600/20 text-red-300 border border-red-500/25 flex-shrink-0">
                            {(u.fullName || u.username || "?").slice(0, 1).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-bold text-white truncate flex items-center gap-2">
                              {u.fullName || "Tanpa nama"}
                              <span className="text-[11px] font-bold text-emerald-300">Saldo {fmtRp(u.balance || 0)}</span>
                            </p>
                            <p className="text-[12px] text-zinc-500 truncate">{u.username}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[12px] font-bold text-zinc-200">{by ? fmtRp(by.total) : fmtRp(0)}</p>
                            <p className="text-[11px] text-zinc-500">{by?.count || 0} order</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px] text-zinc-500">
                          <span>Dibuat: {fmtDT(u.createdAt)}</span>
                          {u.createdBy && <span>oleh {u.createdBy}</span>}
                          <span>Login terakhir: {fmtDT(u.lastLoginAt)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                            <span className="text-[11px] text-zinc-500">Ubah saldo:</span>
                            {[10000, 25000, 50000, 100000].map((v) => (
                              <button
                                key={v}
                                onClick={() => applyAdjust(u, v)}
                                disabled={loading}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50"
                              >
                                +{Math.round(v / 1000)}k
                              </button>
                            ))}
                            {[10000, 25000, 50000].map((v) => (
                              <button
                                key={v}
                                onClick={() => applyAdjust(u, -v)}
                                disabled={loading}
                                className="px-2.5 py-1 rounded-lg text-[11px] font-bold border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50"
                              >
                                −{Math.round(v / 1000)}k
                              </button>
                            ))}
                            <div className="flex items-center gap-1.5 ml-1">
                              <input
                                type="number"
                                placeholder="Nominal"
                                value={editAmt[u.id] || ""}
                                onChange={(e) => setEditAmt((m) => ({ ...m, [u.id]: e.target.value }))}
                                className="w-28 rounded-lg bg-zinc-800 border border-white/10 px-3 py-1.5 text-[12px] text-white placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
                              />
                              <button
                                onClick={() => {
                                  const v = Math.round(Number(editAmt[u.id] || 0));
                                  if (v) applyAdjust(u, v);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-black"
                                style={{ background: ACCENT }}
                              >
                                + Terapkan
                              </button>
                              <button
                                onClick={() => {
                                  const v = Math.round(Number(editAmt[u.id] || 0));
                                  if (v) applyAdjust(u, -v);
                                }}
                                className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-white/10 text-zinc-300 hover:bg-white/5"
                              >
                                − Kurangi
                              </button>
                            </div>
                          </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---- TRANSAKSI ---- */}
            {tab === "transaksi" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Cari customer / layanan / negara / ID…"
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                  <select
                    value={statusF}
                    onChange={(e) => setStatusF(e.target.value)}
                    className={inputCls}
                    style={{ width: "auto" }}
                  >
                    <option value="all">Semua status</option>
                    {Object.entries(STATUS_META).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>

                {filteredOrders.length === 0 && (
                  <div className="text-center py-12 text-[13px] text-zinc-500">Tidak ada transaksi yang cocok.</div>
                )}

                <div className="space-y-2">
                  {filteredOrders.map((o) => {
                    const st = statusMeta(o.status);
                    return (
                      <div key={o.id} className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: st.dot }} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] text-white font-semibold truncate">
                              {o.fullName || o.username || "—"} · {o.serviceName || o.orderId || "Layanan"}
                              {o.countryName ? ` (${o.countryName})` : ""}
                            </p>
                            <p className="text-[11px] text-zinc-500 truncate">
                              {o.providerLabel || o.provider} · ID {o.orderId} · {fmtDT(o.createdAt)}
                            </p>
                          </div>
                          <Chip cls={st.cls}>{st.label}</Chip>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[12px]">
                          <span className="text-zinc-400">
                            Harga jual: <b className="text-white">{fmtRp(o.sellPrice || 0)}</b>
                          </span>
                          <span className="text-zinc-500">(provider {fmtRp(o.providerPrice || 0)})</span>
                          {o.otp && (
                            <span className="font-mono font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg px-2 py-0.5">
                              OTP: {o.otp}
                            </span>
                          )}
                          {o.error && <span className="text-red-300/80 truncate max-w-full">{o.error}</span>}
                        </div>
                        {REFUNDABLE(o.status) && (
                          <div className="mt-2.5">
                            {confirmRefund === o.id ? (
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] text-zinc-300">Refund {fmtRp(o.sellPrice || 0)} ke customer?</span>
                                <button
                                  onClick={() => doRefund(o)}
                                  disabled={loading}
                                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-black disabled:opacity-50"
                                  style={{ background: ACCENT }}
                                >
                                  Ya, refund
                                </button>
                                <button
                                  onClick={() => setConfirmRefund(null)}
                                  className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/10 text-zinc-300"
                                >
                                  Batal
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmRefund(o.id)}
                                disabled={loading}
                                className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-amber-500/30 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50"
                              >
                                Refund manual
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---- DEPOSIT ---- */}
            {tab === "deposit" && isOwner && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <StatCard icon={<QrCode className="w-5 h-5" />} value={fmtRp(depositPaidTotal)} label="Deposit lunas" accent />
                  <StatCard icon={<QrCode className="w-5 h-5" />} value={fmtRp(depositPendingTotal)} label="Deposit pending" />
                  <StatCard icon={<Users className="w-5 h-5" />} value={String(depositPaid.length)} label="Jumlah deposit masuk" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Cari nama / ref…"
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                </div>
                {deposits.length === 0 && (
                  <div className="text-center py-12 text-[13px] text-zinc-500">Belum ada deposit customer.</div>
                )}
                <div className="space-y-2">
                  {deposits
                    .filter((d) => {
                      const t = q.trim().toLowerCase();
                      return t
                        ? (d.username || "").toLowerCase().includes(t) ||
                            (d.fullName || "").toLowerCase().includes(t) ||
                            (d.referenceId || "").toLowerCase().includes(t)
                        : true;
                    })
                    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                    .map((d) => {
                      const paid = d.status === "paid";
                      return (
                        <div key={d.id} className="rounded-2xl border border-white/10 bg-zinc-900/50 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${paid ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>
                            {paid ? <CheckCircle2 className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-white truncate">{d.fullName || d.username}</p>
                            <p className="text-[11px] text-zinc-500 truncate">
                              {d.referenceId} · dibuat {fmtDT(d.createdAt)}
                            </p>
                          </div>
                          <Chip cls={paid ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-amber-500/10 text-amber-300 border-amber-500/30"}>
                            {paid ? "Lunas" : "Pending"}
                          </Chip>
                          <span className="text-[14px] font-black whitespace-nowrap" style={{ color: paid ? ACCENT : "#fbbf24" }}>
                            {fmtRp(d.amount || 0)}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ---- STAFF ---- */}
            {tab === "staff" && isOwner && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
                  <p className="font-bold text-white flex items-center gap-2 mb-1">
                    <UserCog className="w-4 h-4 text-sky-400" /> Buat Akun CS
                  </p>
                  <p className="text-[12px] text-zinc-500 mb-4">
                    CS bisa melihat customer & transaksi untuk melayani, tapi tidak bisa ubah server, hapus staff, atau lihat menu Owner.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Field label="Nama CS">
                      <input value={sf.fullName} onChange={(e) => setSf({ ...sf, fullName: e.target.value })} placeholder="cth: CS Andi" className={inputCls} />
                    </Field>
                    <Field label="Email (untuk login)">
                      <input value={sf.username} onChange={(e) => setSf({ ...sf, username: e.target.value })} placeholder="cs@tokomu.com" className={inputCls} />
                    </Field>
                    <Field label="Password (min. 4)">
                      <div className="relative">
                        <input
                          type={sfShow ? "text" : "password"}
                          value={sf.password}
                          onChange={(e) => setSf({ ...sf, password: e.target.value })}
                          placeholder="Password CS"
                          className={`${inputCls} pr-11`}
                        />
                        <button type="button" onClick={() => setSfShow((v) => !v)} tabIndex={-1}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-white">
                          {sfShow ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </Field>
                  </div>
                  <button
                    onClick={createStaff}
                    disabled={loading}
                    className="mt-2 px-5 py-2.5 rounded-xl text-sm font-bold text-black flex items-center gap-2 disabled:opacity-50"
                    style={{ background: ACCENT, boxShadow: "0 8px 20px -8px rgba(0,230,118,0.6)" }}
                  >
                    <Plus className="w-4 h-4" /> Buat Akun CS
                  </button>
                </div>

                <div>
                  <p className="text-[13px] font-bold text-white mb-2 flex items-center gap-2">
                    <Headset className="w-4 h-4 text-sky-400" /> Staff CS aktif ({staff.length})
                  </p>
                  {staff.length === 0 && (
                    <div className="text-center py-8 rounded-2xl border border-white/10 text-[13px] text-zinc-500">
                      Belum ada akun CS. Buat satu di atas.
                    </div>
                  )}
                  <div className="space-y-2">
                    {staff.map((s) => (
                      <div key={s.id} className="rounded-2xl border border-white/10 bg-zinc-900/50 px-4 py-3 flex items-center gap-3">
                        <span className="w-9 h-9 rounded-full flex items-center justify-center font-black text-sm bg-sky-600/20 text-sky-300 border border-sky-500/25 flex-shrink-0">
                          {(s.fullName || s.username || "?").slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-white truncate">{s.fullName || "—"}</p>
                          <p className="text-[11px] text-zinc-500 truncate">{s.username} · login terakhir {fmtDT(s.lastLoginAt)}</p>
                        </div>
                        <Chip cls="bg-sky-500/15 text-sky-300 border-sky-500/30">CS</Chip>
                        {confirmDelete === s.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => deleteStaff(s.id, s.username)}
                              disabled={loading}
                              className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-black disabled:opacity-50"
                              style={{ background: ACCENT }}
                            >
                              Ya, hapus
                            </button>
                            <button onClick={() => setConfirmDelete(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/10 text-zinc-300">
                              Batal
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(s.id)}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20 flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" /> Hapus
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ---- SERVER ---- */}
            {tab === "server" && isOwner && (
              <div className="space-y-3">
                <p className="text-[13px] text-zinc-400 leading-relaxed">
                  Nyalakan/matikan server yang tampil di halaman Beli customer — tanpa perlu ubah kode. Provider baru tetap
                  butuh kunci API-nya diisi di pengaturan Keys.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {SERVER_ROWS.map((s) => {
                    const enabled = serverMap[s.id] !== false;
                    return (
                      <div key={s.id} className="rounded-2xl border border-white/10 p-4" style={{ background: "linear-gradient(150deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))" }}>
                        <div className="flex items-center gap-2">
                          <ServerIcon className="w-4 h-4 text-red-500" />
                          <p className="font-bold text-white">{s.label}</p>
                          {s.badge && <Chip cls="bg-red-500/15 text-red-300 border-red-500/30">{s.badge}</Chip>}
                          <Chip cls={enabled ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-zinc-500/10 text-zinc-400 border-white/10"}>
                            {enabled ? "Tampil" : "Disembunyikan"}
                          </Chip>
                        </div>
                        <p className="text-[12px] text-zinc-500 mt-1.5 leading-relaxed">{s.desc}</p>
                        <p className="text-[11px] text-zinc-600 mt-1">Provider: {s.provider}</p>
                        <button
                          onClick={() => toggleServer(s.id, !enabled)}
                          disabled={loading}
                          className={`mt-3 px-4 py-2 rounded-xl text-[12px] font-bold border transition-all disabled:opacity-50 ${
                            enabled
                              ? "border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20"
                              : "border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20"
                          }`}
                        >
                          {enabled ? "Matikan dari halaman beli" : "Tampilkan di halaman beli"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ---- LAPORAN & MONITORING ---- */}
            {tab === "laporan" && isOwner && <OwnerInsights actorId={actorId} orders={orders} deposits={deposits} />}

            {/* ---- AKUN OWNER ---- */}
            {tab === "akun" && isOwner && (
              <div className="max-w-xl">
                <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
                  <p className="font-bold text-white flex items-center gap-2 mb-1">
                    <KeyRound className="w-4 h-4" style={{ color: ACCENT }} /> Kelola Akun Owner
                  </p>
                  <p className="text-[12px] text-zinc-500 mb-4">
                    Ubah nama, email login, atau password akun Owner. Password lama wajib diisi untuk verifikasi.
                  </p>
                  <Field label="Nama tampilan (OWNER)">
                    <input value={af.fullName} onChange={(e) => setAf({ ...af, fullName: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Email (untuk login)">
                    <input value={af.username} onChange={(e) => setAf({ ...af, username: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Password lama (verifikasi)">
                    {passField(af.curPass, (v) => setAf({ ...af, curPass: v }), "Password lama")}
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 sm:gap-3">
                    <Field label="Password baru (opsional)">
                      {passField(af.newPass, (v) => setAf({ ...af, newPass: v }), "Password baru")}
                    </Field>
                    <Field label="Ulangi password baru">
                      {passField(af.newPass2, (v) => setAf({ ...af, newPass2: v }), "Ulangi password")}
                    </Field>
                  </div>
                  <button
                    onClick={saveOwnerAccount}
                    disabled={loading}
                    className="mt-1 px-5 py-2.5 rounded-xl text-sm font-bold text-black flex items-center gap-2 disabled:opacity-50"
                    style={{ background: ACCENT, boxShadow: "0 8px 20px -8px rgba(0,230,118,0.6)" }}
                  >
                    <Save className="w-4 h-4" /> Simpan Perubahan
                  </button>
                </div>

                <div className="mt-4 rounded-2xl border border-emerald-500/20 p-4 text-[13px] text-zinc-300 leading-relaxed flex gap-3 items-start" style={{ background: "linear-gradient(135deg, rgba(0,230,118,0.07), transparent)" }}>
                  <ShieldCheck className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <b className="text-white">Punya kamu (Owner):</b> ubah saldo siapa pun, refund manual, buat/hapus CS,
                    nyalakan/matikan server, lihat seluruh deposit & transaksi semua customer, dan kelola akun Owner di tab ini.
                    Semua aksi tercatat di riwayat masing-masing akun.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
