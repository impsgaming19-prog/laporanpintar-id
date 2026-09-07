import { useState } from "react";
import { QrCode, Wallet, Timer, Search, RefreshCw, Plus, Minus } from "lucide-react";
import { formatRupiah, type AdminDeposit, type AdminUser } from "@/lib/convexApi";

const ACCENT = "#00e676";

export function formatTime(ts?: number | null): string {
  if (!ts) return "belum pernah";
  try {
    return new Date(ts).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "-";
  }
}

export function createdByLabel(value?: string): string {
  if (!value) return "-";
  if (value === "self-register") return "daftar sendiri";
  if (value === "owner") return "Owner";
  if (value === "owner-signup") return "pendaftaran Owner";
  return value;
}

/* =====================================================================
 * TAB CUSTOMER (panel admin) — dengan info siapa yang daftar & akses terakhir
 * ===================================================================== */
export function CustomerAdminTab({
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
                <p className="text-[11px] text-zinc-600 mt-1">
                  Dibuat: {createdByLabel(u.createdBy)} • Terdaftar: {formatTime(u.createdAt)} • Akses terakhir:{" "}
                  {formatTime(u.lastLoginAt)}
                </p>
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
                    style={{ backgroundColor: ACCENT, color: "#0b0b0f" }}
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
 * TAB DEPOSIT (panel admin, owner) — total & riwayat isi saldo QR
 * ===================================================================== */
export function AdminDepositTab({ deposits }: { deposits: AdminDeposit[] }) {
  const paid = deposits.filter((d) => d.status === "paid");
  const paidTotal = paid.reduce((s, d) => s + Math.floor(d.amount || 0), 0);
  const pending = deposits.filter((d) => d.status === "pending").length;

  const chip = (icon: React.ReactNode, num: string, label: string) => (
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 p-3 flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "rgba(0,230,118,0.10)" }}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-lg font-bold text-white truncate">{num}</p>
        <p className="text-[10px] text-zinc-400 truncate">{label}</p>
      </div>
    </div>
  );

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {chip(<QrCode className="w-4 h-4" />, `Rp ${formatRupiah(paidTotal)}`, "Deposit lunas")}
        {chip(<Wallet className="w-4 h-4" />, String(paid.length), "Transaksi lunas")}
        {chip(<Timer className="w-4 h-4" />, String(pending), "Menunggu bayar")}
      </div>
      {deposits.length === 0 ? (
        <p className="text-[13px] text-zinc-500 text-center py-8">Belum ada deposit customer.</p>
      ) : (
        <div className="space-y-2 max-h-[48vh] overflow-y-auto pr-1">
          {deposits.map((d) => (
            <div key={d.id} className="rounded-xl bg-zinc-900/70 border border-white/10 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-white font-semibold">{d.fullName || d.username}</span>
                <span className="text-zinc-500 text-[12px]">{d.username}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                    d.status === "paid"
                      ? "bg-emerald-500/15 text-emerald-400"
                      : d.status === "expired"
                      ? "bg-zinc-700/40 text-zinc-400"
                      : "bg-amber-500/15 text-amber-400"
                  }`}
                >
                  {d.status === "paid" ? "Lunas" : d.status === "expired" ? "Kadaluarsa" : "Menunggu bayar"}
                </span>
                <span className="ml-auto text-white font-bold">Rp {formatRupiah(d.amount)}</span>
              </div>
              <div className="text-[11px] text-zinc-500 mt-1 break-all font-mono">Ref: {d.referenceId}</div>
              <div className="text-[11px] text-zinc-600 mt-0.5">
                Dibuat: {formatTime(d.createdAt)} {d.status === "paid" ? `• Lunas: ${formatTime(d.paidAt)}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
