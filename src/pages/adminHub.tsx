import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  Ticket,
  Gift,
  Landmark,
  Smartphone,
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
  apiPromoCreate,
  apiPromoDelete,
  apiPromoList,
  apiShopSetConfig,
  apiShopSetServerEnabled,
  apiAdminPaymentConfig,
  apiAdminSetPaymentkuEnabled,
  apiGetImageUploadUrl,
  apiAdminSavePaymentMethod,
  apiAdminTogglePaymentMethod,
  apiAdminDeletePaymentMethod,
  apiAdminDepositSettle,
  apiAdminDepositReject,
  type AdminDeposit,
  type AdminOrder,
  type AdminStats,
  type AdminUser,
  type PayMethod,
  type PayMethodType,
  type PromoEntry,
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
  { id: "jasav1", label: "Server v1", provider: "Server utama", badge: "Populer", desc: "Pilihan negara & layanan paling lengkap. Data live dari server." },
  { id: "jasav2", label: "Server v2", provider: "Cadangan", badge: null, desc: "Dipakai kalau stok di Server v1 sedang habis." },
  { id: "jasav3", label: "Server v3", provider: "Cadangan", badge: null, desc: "Server cadangan tambahan." },
  { id: "jasav4", label: "Server v4", provider: "Cadangan", badge: "Baru", desc: "Jalur cadangan terakhir. Bisa dinyalakan/dimatikan seperti server lain." },
];

type HubTab = "ringkasan" | "customer" | "transaksi" | "deposit" | "pembayaran" | "staff" | "promo" | "server" | "laporan" | "akun";

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
  const [promos, setPromos] = useState<PromoEntry[]>([]);
  const [pf, setPf] = useState({ code: "", nominal: "", kuota: "" });
  const [promoDel, setPromoDel] = useState<string | null>(null);

  /* metode pembayaran */
  const [paykuEnabled, setPaykuEnabled] = useState(true);
  const [payMethods, setPayMethods] = useState<PayMethod[]>([]);
  const [showPayForm, setShowPayForm] = useState(false);
  const [pfm, setPfm] = useState<{
    id: string;
    type: PayMethodType;
    label: string;
    accountName: string;
    accountNo: string;
    imageUrl: string;
    imageStorageId: string;
  }>({ id: "", type: "qr", label: "", accountName: "", accountNo: "", imageUrl: "", imageStorageId: "" });
  const [payPreview, setPayPreview] = useState("");
  const [payImageBusy, setPayImageBusy] = useState(false);
  const payFileRef = useRef<HTMLInputElement | null>(null);
  const [confirmSettle, setConfirmSettle] = useState<string | null>(null);
  const [confirmRejectDep, setConfirmRejectDep] = useState<string | null>(null);

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
        const [st, dp, sv, gc, pc] = await Promise.all([
          apiAdminStats(actorId),
          apiAdminDeposits(actorId),
          apiShopGetSettings().catch(() => ({ ok: false as const })),
          apiShopGetConfig().catch(() => ({ ok: false as const })),
          apiAdminPaymentConfig(actorId).catch(() => ({ ok: false as const })),
        ]);
        if (st.ok && st.stats) setStats(st.stats);
        if (dp.ok && dp.deposits) setDeposits(dp.deposits);
        if (sv.ok && sv.servers) setServerMap(sv.servers);
        if (gc.ok && gc.config) setFeeStr(String(gc.config.feePct ?? 0));
        if (pc.ok) {
          if (pc.paykuEnabled != null) setPaykuEnabled(pc.paykuEnabled);
          if (pc.methods) setPayMethods(pc.methods);
        }
        if (!st.ok) flash("err", st.error || "Gagal memuat statistik.");
        if (!dp.ok) flash("err", dp.error || "Gagal memuat deposit.");
        const pl = await apiPromoList(actorId).catch(() => ({ ok: false as const }));
        if (pl.ok && pl.promos) setPromos(pl.promos);
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

  /* ---------- metode pembayaran ---------- */
  const togglePayku = async (enabled: boolean) => {
    setLoading(true);
    const res = await apiAdminSetPaymentkuEnabled(actorId, enabled).catch(() => null);
    if (res?.ok) {
      setPaykuEnabled(enabled);
      flash("ok", `QR Paymentku ${enabled ? "ditampilkan" : "disembunyikan"} di halaman Isi Saldo customer.`);
    } else {
      flash("err", res?.error || "Gagal mengubah Paymentku.");
    }
    setLoading(false);
  };

  const uploadPayImage = async (file: File) => {
    if (!file) return;
    setPayImageBusy(true);
    try {
      const res = await apiGetImageUploadUrl(actorId).catch(() => null);
      if (!res?.ok || !res.uploadUrl) {
        flash("err", "Gagal menyiapkan upload. Coba lagi.");
        return;
      }
      const up = await fetch(res.uploadUrl, { method: "PUT", body: file });
      if (!up.ok) {
        flash("err", "Gagal mengunggah gambar. Coba lagi.");
        return;
      }
      const data = await up.json().catch(() => null);
      const storageId = data?.storageId;
      if (!storageId) {
        flash("err", "Respons upload tidak valid. Coba lagi.");
        return;
      }
      setPfm((p) => ({ ...p, imageStorageId: storageId, imageUrl: "" }));
      setPayPreview(URL.createObjectURL(file));
      flash("ok", "Gambar QR terunggah. Tekan Simpan Metode.");
    } catch {
      flash("err", "Upload gagal. Coba lagi.");
    }
    setPayImageBusy(false);
  };

  const savePayMethod = async () => {
    if (!pfm.label.trim()) {
      flash("err", "Nama metode wajib diisi.");
      return;
    }
    if (pfm.type !== "qr" && (!pfm.accountName.trim() || !pfm.accountNo.trim())) {
      flash("err", "Lengkapi nama pemilik dan nomor/tujuan.");
      return;
    }
    setLoading(true);
    const res = await apiAdminSavePaymentMethod(actorId, {
      id: pfm.id || undefined,
      type: pfm.type,
      label: pfm.label.trim(),
      accountName: pfm.accountName.trim(),
      accountNo: pfm.accountNo.trim(),
      imageUrl: pfm.imageUrl.trim() || undefined,
      imageStorageId: pfm.imageStorageId || undefined,
    }).catch(() => null);
    if (res?.ok) {
      if (res.methods) setPayMethods(res.methods);
      flash("ok", pfm.id ? `Metode ${pfm.label} diperbarui.` : `Metode ${pfm.label} ditambahkan — sekarang tampil di halaman Isi Saldo.`);
      setShowPayForm(false);
      setPayPreview("");
      setPfm({ id: "", type: "qr", label: "", accountName: "", accountNo: "", imageUrl: "", imageStorageId: "" });
    } else {
      flash("err", res?.error || "Gagal menyimpan metode.");
    }
    setLoading(false);
  };

  const editPayMethod = (m: PayMethod) => {
    setPfm({
      id: m.id,
      type: m.type,
      label: m.label,
      accountName: m.accountName,
      accountNo: m.accountNo,
      imageUrl: m.imageUrl || "",
      imageStorageId: m.imageStorageId || "",
    });
    setPayPreview("");
    setShowPayForm(true);
  };

  const togglePayMethod = async (m: PayMethod, enabled: boolean) => {
    setLoading(true);
    const res = await apiAdminTogglePaymentMethod(actorId, m.id, enabled).catch(() => null);
    if (res?.ok) {
      if (res.methods) setPayMethods(res.methods);
      flash("ok", `${m.label} ${enabled ? "ditampilkan" : "disembunyikan"}.`);
    } else {
      flash("err", res?.error || "Gagal mengubah metode.");
    }
    setLoading(false);
  };

  const deletePayMethod = async (m: PayMethod) => {
    if (!window.confirm(`Hapus metode "${m.label}"? Deposit lama tetap tersimpan di riwayat.`)) return;
    setLoading(true);
    const res = await apiAdminDeletePaymentMethod(actorId, m.id).catch(() => null);
    if (res?.ok) {
      if (res.methods) setPayMethods(res.methods);
      flash("ok", `Metode ${m.label} dihapus.`);
    } else {
      flash("err", res?.error || "Gagal menghapus metode.");
    }
    setLoading(false);
  };

  /* ---------- approve / tolak deposit manual ---------- */
  const approveDeposit = async (d: AdminDeposit) => {
    setConfirmSettle(null);
    setLoading(true);
    const res = await apiAdminDepositSettle(actorId, d.referenceId).catch(() => null);
    if (res?.ok) {
      flash("ok", `Deposit ${d.referenceId} diterima — saldo ${d.fullName || d.username} +${fmtRp(d.amount || 0)} (${fmtRp(res.balance || 0)}).`);
      reload();
    } else {
      flash("err", res?.error || "Gagal menyetujui deposit.");
      setLoading(false);
    }
  };

  const rejectDeposit = async (d: AdminDeposit) => {
    setConfirmRejectDep(null);
    setLoading(true);
    const res = await apiAdminDepositReject(actorId, d.referenceId).catch(() => null);
    if (res?.ok) {
      flash("ok", `Deposit ${d.referenceId} ditolak.`);
      reload();
    } else {
      flash("err", res?.error || "Gagal menolak deposit.");
      setLoading(false);
    }
  };

  const createPromo = async () => {
    const code = pf.code.trim().toUpperCase();
    const nominal = Math.round(Number(pf.nominal));
    const kuota = Math.max(1, Math.round(Number(pf.kuota)) || 1);
    if (code.length < 4 || code.length > 16 || /[^A-Z0-9]/.test(code)) {
      flash("err", "Kode 4–16 huruf/angka tanpa spasi (cth: KAKO10RB).");
      return;
    }
    if (!Number.isFinite(nominal) || nominal < 1000) {
      flash("err", "Nominal minimal Rp 1.000.");
      return;
    }
    const res = await apiPromoCreate(actorId, code, nominal, kuota).catch(() => null);
    if (res?.ok) {
      flash("ok", `Kode ${code} dibuat (Rp ${fmtRp(nominal)} × ${kuota} pemakaian). Bagikan ke customer!`);
      setPf({ code: "", nominal: "", kuota: "" });
      reload();
    } else {
      flash("err", res?.error || "Gagal membuat kode.");
    }
  };

  const deletePromo = async (code: string) => {
    setPromoDel(null);
    const res = await apiPromoDelete(actorId, code).catch(() => null);
    if (res?.ok) {
      flash("ok", `Kode ${code} dihapus.`);
      reload();
    } else {
      flash("err", res?.error || "Gagal menghapus kode.");
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
    { id: "pembayaran", label: "Pembayaran", icon: <Wallet className="w-4 h-4" />, ownerOnly: true },
    { id: "staff", label: "Staff CS", icon: <Headset className="w-4 h-4" />, ownerOnly: true },
    { id: "promo", label: "Kode Promo", icon: <Ticket className="w-4 h-4" />, ownerOnly: true },
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
                  <StatCard
                    icon={<Crown className="w-5 h-5" />}
                    value={`± ${fmtRp(stats.profitGross ?? Math.round((orderStats.sold || 0) * 0.3))}`}
                    label="Untungmu (±30% dari jual)"
                    accent
                  />
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
                              {o.serverLabel ? `${o.serverLabel} · ` : ""}
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
                          {o.number && (
                            <span className="font-mono text-[11px] text-zinc-300 bg-white/5 border border-white/10 rounded-lg px-2 py-0.5">
                              {o.number}
                            </span>
                          )}
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
                      const manualPending = d.status === "pending" && d.channel === "manual";
                      const rejected = d.status === "rejected";
                      const isVoucher = d.status === "voucher" || d.channel === "voucher";
                      const chChip = isVoucher
                        ? { label: "Voucher", cls: "bg-violet-500/10 text-violet-300 border-violet-500/30" }
                        : d.methodLabel
                          ? { label: d.methodLabel, cls: "bg-sky-500/10 text-sky-300 border-sky-500/30" }
                          : d.channel === "manual"
                            ? { label: "Isi Manual", cls: "bg-sky-500/10 text-sky-300 border-sky-500/30" }
                            : { label: "QR Paymentku", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" };
                      const stChip = paid
                        ? { label: "Lunas", cls: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" }
                        : rejected
                          ? { label: "Ditolak", cls: "bg-red-500/10 text-red-300 border-red-500/30" }
                          : manualPending
                            ? { label: "Menunggu konfirmasi", cls: "bg-amber-500/10 text-amber-300 border-amber-500/30" }
                            : { label: "Pending", cls: "bg-amber-500/10 text-amber-300 border-amber-500/30" };
                      return (
                        <div key={d.id} className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${paid ? "bg-emerald-500/15 text-emerald-300" : rejected ? "bg-red-500/10 text-red-300" : "bg-amber-500/10 text-amber-300"}`}>
                              {paid ? <CheckCircle2 className="w-4 h-4" /> : rejected ? <XCircle className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[13px] font-semibold text-white truncate">{d.fullName || d.username}</p>
                              <p className="text-[11px] text-zinc-500 truncate">
                                {d.referenceId} · {fmtDT(d.createdAt)}
                              </p>
                            </div>
                            <Chip cls={chChip.cls}>{chChip.label}</Chip>
                            <Chip cls={stChip.cls}>{stChip.label}</Chip>
                            <span className="text-[14px] font-black whitespace-nowrap" style={{ color: paid ? ACCENT : rejected ? "#f87171" : "#fbbf24" }}>
                              {fmtRp(d.amount || 0)}
                            </span>
                          </div>
                          {d.methodDetail && (
                            <p className="text-[11px] text-zinc-400 mt-1.5 break-words">
                              📋 {d.methodDetail}
                            </p>
                          )}
                          {d.note && (
                            <p className="text-[11px] text-zinc-500 mt-1 italic">Catatan customer: {d.note}</p>
                          )}
                          {manualPending && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              {confirmSettle === d.referenceId ? (
                                <>
                                  <span className="text-[12px] text-zinc-300">Yakin sudah menerima pembayarannya? Saldo {fmtRp(d.amount || 0)} langsung masuk ke {d.fullName || d.username}.</span>
                                  <button onClick={() => approveDeposit(d)} disabled={loading} className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-black disabled:opacity-50" style={{ background: ACCENT }}>
                                    Ya, terima
                                  </button>
                                  <button onClick={() => setConfirmSettle(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/10 text-zinc-300">
                                    Batal
                                  </button>
                                </>
                              ) : confirmRejectDep === d.referenceId ? (
                                <>
                                  <span className="text-[12px] text-zinc-300">Tolak deposit ini?</span>
                                  <button onClick={() => rejectDeposit(d)} disabled={loading} className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-red-500 text-white disabled:opacity-50">
                                    Ya, tolak
                                  </button>
                                  <button onClick={() => setConfirmRejectDep(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/10 text-zinc-300">
                                    Batal
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    onClick={() => setConfirmSettle(d.referenceId)}
                                    disabled={loading}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-black flex items-center gap-1 disabled:opacity-50"
                                    style={{ background: ACCENT, boxShadow: "0 6px 16px -6px rgba(0,230,118,0.5)" }}
                                  >
                                    <CheckCircle2 className="w-3 h-3" /> Terima (masukkan saldo)
                                  </button>
                                  <button
                                    onClick={() => setConfirmRejectDep(d.referenceId)}
                                    disabled={loading}
                                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-50"
                                  >
                                    <XCircle className="w-3 h-3 inline-block mr-1" /> Tolak
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* ---- PEMBAYARAN (metode isi saldo customer) ---- */}
            {tab === "pembayaran" && isOwner && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5 space-y-4">
                  <div>
                    <p className="text-[14px] font-bold text-white mb-1 flex items-center gap-2">
                      <QrCode className="w-4 h-4" style={{ color: ACCENT }} /> Pembayaran di halaman Isi Saldo customer
                    </p>
                    <p className="text-[12px] text-zinc-400 leading-relaxed">
                      Customer memilih cara bayar: <b className="text-white">QR Paymentku</b> (otomatis, saldo masuk begitu
                      lunas) atau <b className="text-white">Isi Manual</b> (QR/Bank/E-Wallet — kamu cek dulu transfernya di tab
                      Deposit, lalu tekan <b className="text-white">Terima</b> supaya saldo masuk). Di sini kamu atur mana yang
                      tampil; logika Paymentku tidak diubah.
                    </p>
                  </div>

                  {/* Paymentku toggle */}
                  <div className="rounded-xl bg-zinc-900/70 border border-white/10 px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                        <QrCode className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold text-white">QRIS Paymentku (otomatis)</p>
                        <p className="text-[11px] text-zinc-500">
                          {paykuEnabled ? "Tampil di halaman Isi Saldo — saldo masuk otomatis saat pembayaran lunas." : "Disembunyikan dari customer. Kalau mau dipakai lagi, nyalakan di sini."}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => togglePayku(!paykuEnabled)}
                      disabled={loading}
                      className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-50 shrink-0 ${paykuEnabled ? "" : "bg-zinc-700"}`}
                      style={paykuEnabled ? { backgroundColor: ACCENT } : {}}
                      title={paykuEnabled ? "Sembunyikan Paymentku" : "Tampilkan Paymentku"}
                    >
                      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${paykuEnabled ? "left-6" : "left-1"}`} />
                    </button>
                  </div>
                </div>

                {/* Metode isi manual */}
                <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <div>
                      <p className="text-[14px] font-bold text-white flex items-center gap-2">
                        <Wallet className="w-4 h-4" style={{ color: ACCENT }} /> Metode Isi Manual ({payMethods.filter((m) => m.enabled).length} aktif)
                      </p>
                      <p className="text-[12px] text-zinc-400 mt-1">
                        QR / Bank / E-Wallet. Customer transfer ke nomor ini lalu kirim konfirmasi; kamu cocokkan di tab Deposit.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setPfm({ id: "", type: "qr", label: "", accountName: "", accountNo: "", imageUrl: "", imageStorageId: "" });
                        setPayPreview("");
                        setShowPayForm(!showPayForm);
                      }}
                      className="px-3.5 py-2 rounded-xl text-[12px] font-bold text-black flex items-center gap-1.5"
                      style={{ background: ACCENT }}
                    >
                      <Plus className="w-4 h-4" /> {showPayForm ? "Tutup" : "Tambah Metode"}
                    </button>
                  </div>

                  {showPayForm && (
                    <div className="rounded-xl border border-white/10 bg-zinc-900/70 p-4 mt-3 space-y-3">
                      <p className="text-[12px] font-bold text-white">{pfm.id ? "Edit Metode" : "Metode Baru"}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label="Jenis">
                          <select value={pfm.type} onChange={(e) => setPfm({ ...pfm, type: e.target.value as PayMethodType })} className={inputCls}>
                            <option value="qr">QR (QRIS/personal)</option>
                            <option value="bank">Transfer Bank</option>
                            <option value="ewallet">E-Wallet (DANA/OVO/GoPay/dll)</option>
                          </select>
                        </Field>
                        <Field label="Nama metode (cth: BCA / DANA / QRIS)">
                          <input value={pfm.label} onChange={(e) => setPfm({ ...pfm, label: e.target.value })} placeholder="cth: BCA" className={inputCls} />
                        </Field>
                        <Field label="Nomor/tujuan (no. rekening / ID / isi QR)">
                          <input value={pfm.accountNo} onChange={(e) => setPfm({ ...pfm, accountNo: e.target.value })} placeholder="cth: 1234567890" className={inputCls} />
                        </Field>
                        <Field label="Nama pemilik (a.n.)">
                          <input value={pfm.accountName} onChange={(e) => setPfm({ ...pfm, accountName: e.target.value })} placeholder="cth: KAKO NOKOS" className={inputCls} />
                        </Field>
                        <Field label="Gambar QR (unggah dari HP/PC atau link)">
                          <input value={pfm.imageUrl} onChange={(e) => setPfm({ ...pfm, imageUrl: e.target.value })} placeholder="https://...png (opsional kalau pakai tombol unggah)" className={inputCls} />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input
                              ref={payFileRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void uploadPayImage(f);
                                e.target.value = "";
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => payFileRef.current?.click()}
                              disabled={payImageBusy || loading}
                              className="px-3 py-2 rounded-lg text-[11.5px] font-bold border border-emerald-500/40 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50"
                            >
                              {payImageBusy ? "Mengunggah..." : "⬆ Unggah Gambar QR"}
                            </button>
                            {(payPreview || pfm.imageUrl) && (
                              <>
                                <img src={payPreview || pfm.imageUrl} alt="QR preview" className="w-14 h-14 object-contain rounded-lg bg-white p-0.5 border border-white/10" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setPayPreview("");
                                    setPfm((p) => ({ ...p, imageStorageId: "", imageUrl: "" }));
                                  }}
                                  className="text-[11px] text-red-300 border border-red-500/30 bg-red-500/10 rounded-lg px-2 py-1.5 hover:bg-red-500/20"
                                >
                                  Hapus gambar
                                </button>
                              </>
                            )}
                          </div>
                        </Field>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={savePayMethod} disabled={loading} className="px-4 py-2 rounded-xl text-[12px] font-bold text-black disabled:opacity-50" style={{ background: ACCENT }}>
                          <Save className="w-3.5 h-3.5 inline-block mr-1" /> Simpan Metode
                        </button>
                        <button onClick={() => setShowPayForm(false)} className="px-4 py-2 rounded-xl text-[12px] font-bold border border-white/10 text-zinc-300">
                          Batal
                        </button>
                      </div>
                    </div>
                  )}

                  {payMethods.length === 0 && !showPayForm && (
                    <div className="text-center py-8 text-[13px] text-zinc-500 mt-2">
                      Belum ada metode isi manual. Tambahkan QR/Bank/E-Wallet supaya customer punya pilihan bayar manual.
                    </div>
                  )}

                  <div className="space-y-2 mt-3">
                    {payMethods.map((m) => {
                      const enabled = m.enabled;
                      return (
                        <div key={m.id} className="rounded-xl bg-zinc-900/70 border border-white/10 px-4 py-3 flex flex-wrap items-center gap-3">
                          <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 border ${enabled ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/25" : "bg-white/5 text-zinc-500 border-white/10"}`}>
                            {m.type === "bank" ? <Landmark className="w-4 h-4" /> : m.type === "ewallet" ? <Smartphone className="w-4 h-4" /> : <QrCode className="w-4 h-4" />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className={`text-[13px] font-bold truncate ${enabled ? "text-white" : "text-zinc-400"}`}>
                              {m.label} <span className="text-[10px] font-semibold text-zinc-500">({m.type === "bank" ? "Transfer Bank" : m.type === "ewallet" ? "E-Wallet" : "QR"})</span>
                            </p>
                            <p className="text-[11px] text-zinc-500 truncate">
                              {m.accountNo} · a.n. {m.accountName}
                            </p>
                          </div>
                          <Chip cls={enabled ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-white/5 text-zinc-500 border-white/10"}>
                            {enabled ? "Tampil" : "Disembunyikan"}
                          </Chip>
                          <button onClick={() => editPayMethod(m)} disabled={loading} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-white/5 disabled:opacity-50" title="Edit">
                            <Save className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => togglePayMethod(m, !enabled)}
                            disabled={loading}
                            className={`relative w-12 h-7 rounded-full transition-colors disabled:opacity-50 ${enabled ? "" : "bg-zinc-700"}`}
                            style={enabled ? { backgroundColor: ACCENT } : {}}
                            title={enabled ? "Sembunyikan" : "Tampilkan"}
                          >
                            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all ${enabled ? "left-6" : "left-1"}`} />
                          </button>
                          <button onClick={() => deletePayMethod(m)} disabled={loading} className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-500/10 disabled:opacity-50" title="Hapus">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
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

            {/* ---- KODE PROMO ---- */}
            {tab === "promo" && isOwner && (
              <div className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-5">
                  <p className="font-bold text-white flex items-center gap-2 mb-1">
                    <Ticket className="w-4 h-4" style={{ color: ACCENT }} /> Buat Kode Promo / Voucher
                  </p>
                  <p className="text-[12px] text-zinc-500 mb-4">
                    Customer menukar kode ini di halaman toko → saldo langsung masuk ke akunnya. Cocok untuk kupon,
                    kompensasi, giveaway, atau bonus referral manual.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Field label="Kode (cth: KAKO10RB)">
                      <input
                        value={pf.code}
                        onChange={(e) => setPf({ ...pf, code: e.target.value.toUpperCase() })}
                        placeholder="KAKO10RB"
                        className={`${inputCls} uppercase`}
                      />
                    </Field>
                    <Field label="Nominal saldo (Rp)">
                      <input
                        value={pf.nominal}
                        onChange={(e) => setPf({ ...pf, nominal: e.target.value })}
                        inputMode="numeric"
                        placeholder="10000"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Kuota pemakaian">
                      <input
                        value={pf.kuota}
                        onChange={(e) => setPf({ ...pf, kuota: e.target.value })}
                        inputMode="numeric"
                        placeholder="10"
                        className={inputCls}
                      />
                    </Field>
                    <div className="flex items-end">
                      <button
                        onClick={createPromo}
                        disabled={loading}
                        className="px-5 py-2.5 rounded-xl text-sm font-bold text-black flex items-center gap-2 disabled:opacity-50"
                        style={{ background: ACCENT, boxShadow: "0 8px 20px -8px rgba(0,230,118,0.6)" }}
                      >
                        <Plus className="w-4 h-4" /> Buat Kode
                      </button>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-[13px] font-bold text-white mb-2 flex items-center gap-2">
                    <Gift className="w-4 h-4" style={{ color: ACCENT }} /> Kode aktif ({promos.length})
                  </p>
                  {promos.length === 0 && (
                    <div className="text-center py-8 rounded-2xl border border-white/10 text-[13px] text-zinc-500">
                      Belum ada kode promo. Buat satu di atas.
                    </div>
                  )}
                  <div className="space-y-2">
                    {promos.map((p) => {
                      const left = Math.max(0, p.kuota - p.used);
                      return (
                        <div key={p.code} className="rounded-2xl border border-white/10 bg-zinc-900/50 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <span className="px-3 py-1.5 rounded-lg font-mono text-[13px] font-black tracking-wider bg-emerald-500/10 text-emerald-300 border border-emerald-500/25">
                            {p.code}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-white">
                              {fmtRp(p.nominal)} <span className="text-zinc-500 font-normal">per penukaran</span>
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              Dipakai {p.used}/{p.kuota} · sisa {left} · dibuat {fmtDT(p.createdAt)}
                            </p>
                          </div>
                          <Chip cls={left > 0 ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-zinc-500/10 text-zinc-400 border-white/10"}>
                            {left > 0 ? "Aktif" : "Habis"}
                          </Chip>
                          {promoDel === p.code ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => deletePromo(p.code)}
                                disabled={loading}
                                className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-black disabled:opacity-50"
                                style={{ background: ACCENT }}
                              >
                                Ya, hapus
                              </button>
                              <button onClick={() => setPromoDel(null)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-white/10 text-zinc-300">
                                Batal
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setPromoDel(p.code)}
                              className="px-3 py-1.5 rounded-lg text-[11px] font-bold border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20 flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> Hapus
                            </button>
                          )}
                        </div>
                      );
                    })}
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
