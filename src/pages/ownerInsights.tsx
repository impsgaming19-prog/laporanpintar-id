import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  Server as ServerIcon,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  apiProviderMonitor,
  type AdminDeposit,
  type AdminOrder,
  type ProviderStatusRow,
} from "@/lib/convexApi";

/* ---------- brand ---------- */
const RED = "#e10600";
const ACCENT = "#00e676";

const fmtRp = (n: number) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");

const fmtDT = (ms: number | null | undefined) => {
  if (!ms) return "—";
  try {
    return new Date(ms).toLocaleString("id-ID", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
};

const SOLD = ["ordered", "active", "otp", "done"];

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Stat({ icon, value, label, accent = false }: { icon: ReactNode; value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 flex items-center gap-3">
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border"
        style={
          accent
            ? { background: "rgba(0,230,118,0.12)", borderColor: "rgba(0,230,118,0.25)", color: ACCENT }
            : { background: "rgba(225,6,0,0.10)", borderColor: "rgba(225,6,0,0.22)", color: "#ff6b63" }
        }
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

/** Unduh file CSV (pemisah ; agar rapi dibuka di Excel Indonesia). */
function downloadCsv(filename: string, rows: (string | number)[][]) {
  const content =
    "\uFEFF" +
    rows
      .map((r) =>
        r
          .map((c) => {
            const s = String(c ?? "");
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(";")
      )
      .join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function OwnerInsights({
  actorId,
  orders,
  deposits,
}: {
  actorId: string;
  orders: AdminOrder[];
  deposits: AdminDeposit[];
}) {
  const [range, setRange] = useState(14);
  const [prov, setProv] = useState<{ providers: ProviderStatusRow[]; checkedAt: number | null }>({
    providers: [],
    checkedAt: null,
  });
  const [provLoading, setProvLoading] = useState(false);
  const [provMsg, setProvMsg] = useState<string | null>(null);

  const loadProviders = async () => {
    setProvLoading(true);
    setProvMsg(null);
    try {
      const res = await apiProviderMonitor(actorId);
      if (res.ok && res.providers) {
        setProv({ providers: res.providers, checkedAt: res.checkedAt || Date.now() });
      } else {
        setProvMsg(res.error || "Gagal memuat saldo provider.");
      }
    } catch (err: any) {
      setProvMsg(err?.message || "Gagal memuat saldo provider.");
    } finally {
      setProvLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);

  /* ---------- grafik penjualan harian ---------- */
  const buckets = useMemo(() => {
    const now = new Date();
    const days: { key: string; label: string; sales: number; profit: number; count: number }[] = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({
        key: dayKey(d.getTime()),
        label: d.toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
        sales: 0,
        profit: 0,
        count: 0,
      });
    }
    const map = new Map(days.map((d) => [d.key, d]));
    for (const o of orders) {
      const b = map.get(dayKey(o.createdAt || 0));
      if (!b || !SOLD.includes(o.status)) continue;
      b.sales += o.sellPrice || 0;
      b.profit += (o.sellPrice || 0) - (o.providerPrice || 0);
      b.count += 1;
    }
    return days;
  }, [orders, range]);

  const totals = useMemo(() => {
    let sales = 0;
    let profit = 0;
    let count = 0;
    for (const b of buckets) {
      sales += b.sales;
      profit += b.profit;
      count += b.count;
    }
    return { sales, profit, count };
  }, [buckets]);

  const maxSales = Math.max(1, ...buckets.map((b) => b.sales));

  /* ---------- alarm ---------- */
  const nowMs = Date.now();
  const waitingLong = useMemo(
    () =>
      orders
        .filter((o) => o.status === "ordered" && o.createdAt && nowMs - o.createdAt > 5 * 60 * 1000)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [orders, nowMs]
  );
  const refund24 = useMemo(() => {
    const cutoff = nowMs - 24 * 60 * 60 * 1000;
    const list = orders.filter((o) => o.status === "refunded" && o.createdAt && o.createdAt >= cutoff);
    return { count: list.length, total: list.reduce((s, o) => s + (o.sellPrice || 0), 0) };
  }, [orders, nowMs]);

  /* ---------- export CSV ---------- */
  const exportOrders = () => {
    downloadCsv(`kakonokos-transaksi-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Waktu", "Customer", "Email", "Layanan", "Negara", "Provider", "ID Order", "Harga jual", "Harga provider", "Status", "OTP", "Catatan"],
      ...[...orders]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((o) => [
          fmtDT(o.createdAt),
          o.fullName || "",
          o.username || "",
          o.serviceName || "",
          o.countryName || "",
          o.providerLabel || o.provider || "",
          o.orderId || "",
          o.sellPrice || 0,
          o.providerPrice || 0,
          o.status || "",
          o.otp || "",
          o.error || "",
        ]),
    ]);
  };

  const exportDeposits = () => {
    downloadCsv(`kakonokos-deposit-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Waktu", "Customer", "Email", "Referensi", "Nominal", "Status", "Waktu lunas"],
      ...[...deposits]
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map((d) => [
          fmtDT(d.createdAt),
          d.fullName || "",
          d.username || "",
          d.referenceId || "",
          d.amount || 0,
          d.status === "paid" ? "Lunas" : d.status,
          d.paidAt ? fmtDT(d.paidAt) : "",
        ]),
    ]);
  };

  const lowBal = prov.providers.filter((p) => p.configured && p.balance != null && p.balance < 20000);
  const noKey = prov.providers.filter((p) => !p.configured);

  return (
    <div className="space-y-5">
      {/* ringkasan rentang */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-zinc-900/60 p-1">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-3 py-1.5 rounded-lg text-[12px] font-bold transition-all ${
                range === d ? "text-black" : "text-zinc-400 hover:text-white"
              }`}
              style={range === d ? { background: ACCENT } : {}}
            >
              {d} hari
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={exportOrders}
            className="px-3.5 py-2 rounded-xl text-[12px] font-bold border border-emerald-500/30 text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export Transaksi
          </button>
          <button
            onClick={exportDeposits}
            className="px-3.5 py-2 rounded-xl text-[12px] font-bold border border-red-500/30 text-red-300 bg-red-500/10 hover:bg-red-500/20 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> Export Deposit
          </button>
        </div>
      </div>

      {/* statistik rentang */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<TrendingUp className="w-5 h-5" />} value={fmtRp(totals.sales)} label={`Penjualan ${range} hari`} accent />
        <Stat icon={<Wallet className="w-5 h-5" />} value={fmtRp(totals.profit)} label={`Untung kotor ${range} hari`} />
        <Stat icon={<CheckCircle2 className="w-5 h-5" />} value={String(totals.count)} label="Order sukses" />
        <Stat icon={<AlertTriangle className="w-5 h-5" />} value={fmtRp(refund24.total)} label={`Refund 24 jam (${refund24.count})`} />
      </div>

      {/* grafik batang */}
      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
        <p className="text-[13px] font-bold text-white mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" style={{ color: ACCENT }} /> Penjualan & untung per hari (Rp ribu)
        </p>
        <div className="flex items-end gap-1 h-36">
          {buckets.map((b) => {
            const hSales = Math.round((b.sales / maxSales) * 100);
            const hProfit = b.sales > 0 ? Math.max(4, Math.round((b.profit / maxSales) * 100)) : 0;
            const isToday = b.key === dayKey(Date.now());
            return (
              <div
                key={b.key}
                className="flex-1 flex flex-col items-center justify-end gap-1 h-full min-w-0 group"
                title={`${b.label}: jual ${fmtRp(b.sales)} · untung ${fmtRp(b.profit)} · ${b.count} order`}
              >
                <div className="w-full max-w-[26px] flex flex-col items-center justify-end gap-0.5 rounded-md overflow-hidden" style={{ height: "100%" }}>
                  <div
                    className="w-full rounded-sm"
                    style={{
                      height: `${Math.max(b.sales > 0 ? 3 : 0, hProfit)}%`,
                      background: "linear-gradient(180deg,#00e676,#00a855)",
                      opacity: 0.95,
                    }}
                  />
                  <div
                    className="w-full rounded-sm"
                    style={{
                      height: `${b.sales > 0 ? Math.max(hSales, 3) : 0}%`,
                      background: isToday
                        ? "linear-gradient(180deg,#ff6b63,#e10600)"
                        : "linear-gradient(180deg,#b91c1c66,#7a0a0566)",
                    }}
                  />
                </div>
                <span className="text-[9px] text-zinc-500 whitespace-nowrap">{b.label}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 mt-3 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#e10600" }} /> Penjualan
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: "#00e676" }} /> Untung kotor
          </span>
        </div>
      </div>

      {/* alarm order bermasalah */}
      {(waitingLong.length > 0 || refund24.count > 0) && (
        <div className="rounded-2xl border border-red-500/25 bg-red-500/5 p-4 space-y-2">
          <p className="text-[13px] font-bold text-red-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" style={{ color: RED }} /> Perlu perhatian
          </p>
          {waitingLong.length > 0 && (
            <p className="text-[12px] text-red-200/80 leading-relaxed">
              <b>{waitingLong.length} order</b> masih menunggu OTP lebih dari 5 menit (mungkin nomor tidak jalan). Cek tab
              Transaksi → filter status <b>ordered</b> → kalau sudah lama, lakukan refund manual.
              {waitingLong.slice(0, 3).map((o) => (
                <span key={o.id} className="block truncate opacity-80">
                  · {o.fullName || o.username} — {o.serviceName} ({o.countryName}) · {fmtDT(o.createdAt)}
                </span>
              ))}
            </p>
          )}
          {refund24.count > 0 && (
            <p className="text-[12px] text-red-200/70">
              {refund24.count} refund dalam 24 jam terakhir (total {fmtRp(refund24.total)}). Lihat detail di tab Transaksi.
            </p>
          )}
        </div>
      )}

      {/* monitor saldo provider */}
      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p className="text-[13px] font-bold text-white flex items-center gap-2">
            <ServerIcon className="w-4 h-4" style={{ color: RED }} /> Saldo provider (modal kamu)
          </p>
          <div className="flex items-center gap-2">
            {prov.checkedAt && <span className="text-[11px] text-zinc-500">Dicek {fmtDT(prov.checkedAt)}</span>}
            <button
              onClick={loadProviders}
              disabled={provLoading}
              className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center text-zinc-300 hover:bg-white/5 disabled:opacity-50"
              title="Cek ulang saldo provider"
            >
              <RefreshCw className={`w-4 h-4 ${provLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        {provMsg && <p className="text-[12px] text-red-300 mb-2">{provMsg}</p>}
        {prov.providers.length === 0 && !provLoading && (
          <p className="text-[12px] text-zinc-500">Belum ada data — tekan tombol refresh.</p>
        )}
        <div className="space-y-2">
          {prov.providers.map((p) => (
            <div key={p.key} className="rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <ServerIcon className="w-4 h-4 text-zinc-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white">{p.label}</p>
                <p className="text-[11px] text-zinc-500">
                  {p.configured ? (p.balance == null ? "Saldo provider (gagal dibaca)" : "Saldo provider") : "Kunci API belum diisi di Keys/Environment"}
                </p>
              </div>
              {!p.configured && <span className="text-[11px] text-zinc-500">belum aktif</span>}
              {p.configured && p.balance == null && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 whitespace-nowrap">
                  Saldo tidak terbaca
                </span>
              )}
              {p.configured && p.balance != null && (
                <span
                  className="text-[15px] font-black whitespace-nowrap"
                  style={{ color: p.balance < 10000 ? "#ff6b63" : p.balance < 50000 ? "#fbbf24" : ACCENT }}
                >
                  {fmtRp(p.balance)}
                </span>
              )}
              {p.configured && p.balance == null && p.error && (
                <p className="w-full text-[11px] text-amber-200/75 leading-relaxed">{p.error}</p>
              )}
            </div>
          ))}
        </div>
        {lowBal.length > 0 && (
          <p className="mt-2 text-[12px] text-amber-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Saldo {lowBal.map((p) => p.label).join(", ")} menipis — isi dulu biar order tidak gagal saat toko ramai.
          </p>
        )}
        {noKey.length > 0 && (
          <p className="mt-2 text-[11px] text-zinc-600">
            Provider tanpa kunci ({noKey.map((p) => p.label).join(", ")}) tidak akan muncul di halaman beli.
          </p>
        )}
      </div>

      {/* ringkasan order lama */}
      <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4 flex flex-wrap items-center gap-3">
        <Clock className="w-5 h-5 text-zinc-400 shrink-0" />
        <p className="text-[12px] text-zinc-400 leading-relaxed min-w-0 flex-1">
          <b className="text-white">Tips:</b> export CSV untuk pembukuan, cek grafik tiap pagi untuk lihat tren penjualan, dan jaga
          saldo provider tetap cukup. Order yang gagal di-refund otomatis oleh sistem (±10 menit tanpa OTP) — pantau kolom alarm di atas.
        </p>
      </div>
    </div>
  );
}
