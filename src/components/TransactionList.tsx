import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Search, ArrowUpRight, ArrowDownRight, Trash2, Edit3, TrendingUp, TrendingDown, Wallet,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useData, useTheme } from "@/contexts/AppContext";
import type { Transaction } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import Button from "@/components/ui/Button";

interface Props {
  onEdit: (tx: Transaction) => void;
  onAdd?: () => void;
}

export default function TransactionList({ onEdit, onAdd }: Props) {
  const { transactions, deleteTransaction } = useData();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filtered = useMemo(() => {
    let txs = [...transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    if (typeFilter !== "all") txs = txs.filter((t) => t.type === typeFilter);
    if (dateFrom) txs = txs.filter((t) => t.date >= dateFrom);
    if (dateTo) txs = txs.filter((t) => t.date <= dateTo);
    if (search.trim()) {
      const q = search.toLowerCase();
      txs = txs.filter((t) => t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
    }
    return txs;
  }, [transactions, typeFilter, search, dateFrom, dateTo]);

  const totals = useMemo(() => {
    const income = filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { income, expense, balance: income - expense };
  }, [filtered]);

  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";
  const textMuted = isDark ? "text-zinc-500" : "text-zinc-400";

  const inputCls = isDark
    ? "bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-zinc-500"
    : "bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder:text-zinc-400";

  const filterTabs = [
    { id: "all" as const, label: "Semua" },
    { id: "income" as const, label: "Pemasukan" },
    { id: "expense" as const, label: "Pengeluaran" },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-5 pt-5 pb-32 space-y-4 overflow-hidden">

      {/* Header */}
      <div>
        <h1 className={`text-[22px] font-bold tracking-tight ${textPrimary}`}>
          Transaksi
        </h1>
        <p className={`text-[13px] mt-0.5 ${textSecondary}`}>
          {filtered.length} transaksi ditemukan
        </p>
      </div>

      {/* Add Button */}
      <Button className="w-full" size="lg" onClick={onAdd}>+ Tambah Transaksi</Button>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-2.5">
        <MiniStatCard icon={<TrendingUp className="w-5 h-5" />} label="Pemasukan" value={totals.income} color="emerald" isDark={isDark} />
        <MiniStatCard icon={<TrendingDown className="w-5 h-5" />} label="Pengeluaran" value={totals.expense} color="red" isDark={isDark} />
        <MiniStatCard icon={<Wallet className="w-5 h-5" />} label="Saldo" value={totals.balance} color="blue" isDark={isDark} />
      </div>

      {/* Filters */}
      <div className={`rounded-2xl border p-4 ${card} space-y-3`}>
        {/* Type filter tabs */}
        <div className="flex gap-2">
          {filterTabs.map((tab) => (
            <button key={tab.id} onClick={() => setTypeFilter(tab.id)}
              className={`flex-1 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all cursor-pointer text-center ${
                typeFilter === tab.id
                  ? tab.id === "income" ? "bg-emerald-500 text-white"
                    : tab.id === "expense" ? "bg-red-500 text-white"
                    : isDark ? "bg-white text-zinc-900" : "bg-zinc-900 text-white"
                  : isDark ? "bg-white/[0.04] text-zinc-400 border border-white/[0.06]" : "bg-zinc-50 text-zinc-500 border border-zinc-200"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Date range */}
        <div className="space-y-2">
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${inputCls}`}>
            <span className={`text-[12px] flex-shrink-0 ${textMuted}`}>📅</span>
            <span className={`text-[11px] flex-shrink-0 ${textMuted}`}>Dari</span>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className={`flex-1 min-w-0 bg-transparent text-[13px] outline-none ${isDark ? "text-white" : "text-zinc-900"}`} />
          </div>
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${inputCls}`}>
            <span className={`text-[12px] flex-shrink-0 ${textMuted}`}>📅</span>
            <span className={`text-[11px] flex-shrink-0 ${textMuted}`}>Sampai</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className={`flex-1 min-w-0 bg-transparent text-[13px] outline-none ${isDark ? "text-white" : "text-zinc-900"}`} />
          </div>
        </div>

        {/* Search */}
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${inputCls}`}>
          <Search className={`w-4 h-4 flex-shrink-0 ${textMuted}`} />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari..."
            className={`flex-1 min-w-0 bg-transparent text-[14px] outline-none ${isDark ? "text-white placeholder:text-zinc-500" : "text-zinc-900 placeholder:text-zinc-400"}`} />
        </div>
      </div>

      {/* Transaction List */}
      {filtered.length === 0 ? (
        <div className={`text-center py-16 rounded-2xl border ${card}`}>
          <p className={`text-[14px] ${textMuted}`}>Tidak ada transaksi ditemukan</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((tx) => (
            <div key={tx.id}
              className={`rounded-2xl border p-4 ${card} transition-colors`}>
              <div className="flex items-start gap-3">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  tx.type === "income"
                    ? isDark ? "bg-emerald-500/15" : "bg-emerald-50"
                    : isDark ? "bg-red-500/15" : "bg-red-50"
                }`}>
                  {tx.type === "income"
                    ? <ArrowUpRight className="w-5 h-5 text-emerald-500" />
                    : <ArrowDownRight className="w-5 h-5 text-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-[15px] font-semibold truncate ${textPrimary}`}>{tx.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-medium ${
                          isDark ? "bg-white/[0.06] text-zinc-400" : "bg-zinc-100 text-zinc-500"
                        }`}>{tx.category}</span>
                        <span className={`text-[12px] ${textMuted}`}>
                          {format(parseISO(tx.date), "dd MMM yyyy", { locale: idLocale })}
                        </span>
                      </div>
                    </div>
                    <span className={`text-[15px] font-bold tabular-nums whitespace-nowrap ${tx.type === "income" ? "text-emerald-500" : "text-red-500"}`}>
                      {tx.type === "income" ? "+" : "-"}{formatCurrency(tx.amount)}
                    </span>
                  </div>
                </div>
              </div>
              {/* Image thumbnail */}
              {tx.image && (
                <div className="mt-3">
                  <img src={tx.image} alt="Struk" className="w-full h-32 object-cover rounded-xl" />
                </div>
              )}
              {/* Actions */}
              <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-dashed"
                style={{ borderColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)" }}>
                <button onClick={() => onEdit(tx)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-colors
                    ${isDark ? "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20" : "bg-blue-50 text-blue-600 hover:bg-blue-100"}`}>
                  <Edit3 className="w-3.5 h-3.5" /> Edit
                </button>
                <button onClick={() => deleteTransaction(tx.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium cursor-pointer transition-colors
                    ${isDark ? "bg-red-500/10 text-red-400 hover:bg-red-500/20" : "bg-red-50 text-red-500 hover:bg-red-100"}`}>
                  <Trash2 className="w-3.5 h-3.5" /> Hapus
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* Mini Stat Card */
function MiniStatCard({ icon, label, value, color, isDark }: {
  icon: React.ReactNode; label: string; value: number;
  color: "emerald" | "red" | "blue"; isDark: boolean;
}) {
  const palette = {
    emerald: { bg: isDark ? "bg-emerald-500/10" : "bg-emerald-50", icon: "text-emerald-500", value: "text-emerald-500" },
    red:     { bg: isDark ? "bg-red-500/10" : "bg-red-50",     icon: "text-red-500",     value: "text-red-500" },
    blue:    { bg: isDark ? "bg-blue-500/10" : "bg-blue-50",    icon: "text-blue-500",    value: "text-blue-500" },
  };
  const p = palette[color];
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";

  return (
    <div className={`rounded-2xl border p-3 text-center overflow-hidden ${isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm"}`}>
      <div className={`w-9 h-9 rounded-xl mx-auto mb-1.5 flex items-center justify-center ${p.bg}`}>
        <div className={p.icon}>{icon}</div>
      </div>
      <p className={`text-[10px] mb-0.5 truncate ${textSecondary}`}>{label}</p>
      <p className={`text-[11px] font-bold tabular-nums break-all leading-tight ${p.value}`}>{formatCurrency(value)}</p>
    </div>
  );
}
