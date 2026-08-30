import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp, TrendingDown, Wallet, PiggyBank, ArrowUpRight, ArrowDownRight,
  Calendar, Download, Trash2, ChevronRight,
} from "lucide-react";
import { format, parseISO, isWithinInterval, startOfMonth, endOfMonth, isToday, startOfWeek, endOfWeek, subMonths, subWeeks, subDays } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useAuth, useData, useTheme } from "@/contexts/AppContext";
import type { Transaction, ViewMode } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import TransactionForm from "@/components/TransactionForm";
import TransactionList from "@/components/TransactionList";
import Button from "@/components/ui/Button";
import { exportToCSV } from "@/lib/export";

interface DashboardPageProps { currentView: ViewMode; onNavigate: (view: ViewMode) => void; }

export default function DashboardPage({ currentView, onNavigate }: DashboardPageProps) {
  const { user } = useAuth();
  const { transactions, deleteTransaction } = useData();
  const { theme } = useTheme();
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month" | "year">("month");
  const isDark = theme === "dark";
  const now = new Date();
  const monthStart = useMemo(() => startOfMonth(now), []);
  const monthEnd = useMemo(() => endOfMonth(now), []);

  // Trend date range
  const [trendFrom, setTrendFrom] = useState(() => {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return format(d, "yyyy-MM-dd");
  });
  const [trendTo, setTrendTo] = useState(() => format(now, "yyyy-MM-dd"));

  const filtered = useMemo(() => {
    if (dateFilter === "all") return transactions;
    return transactions.filter((tx) => {
      const d = parseISO(tx.date);
      switch (dateFilter) {
        case "today": return isToday(d);
        case "week": return isWithinInterval(d, { start: startOfWeek(now), end: endOfWeek(now) });
        case "month": return isWithinInterval(d, { start: monthStart, end: monthEnd });
        case "year": return d.getFullYear() === now.getFullYear();
        default: return true;
      }
    });
  }, [transactions, dateFilter, monthStart, monthEnd]);

  const calcStats = (txs: Transaction[]) => {
    const income = txs.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = txs.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { income, expense, balance: income - expense };
  };

  const stats = calcStats(filtered);
  const todayStats = calcStats(transactions.filter((t) => isToday(parseISO(t.date))));
  const monthTx = useMemo(() => transactions.filter((tx) => isWithinInterval(parseISO(tx.date), { start: monthStart, end: monthEnd })), [transactions, monthStart, monthEnd]);
  const monthStats = calcStats(monthTx);
  const savingsRate = monthStats.income > 0 ? ((monthStats.balance / monthStats.income) * 100).toFixed(1) : "0";
  const recentTx = useMemo(() => [...filtered].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 5), [filtered]);
  const monthLabel = format(now, "MMMM yyyy", { locale: idLocale });

  // Previous period comparisons
  const prevMonthStart = useMemo(() => startOfMonth(subMonths(now, 1)), []);
  const prevMonthEnd = useMemo(() => endOfMonth(subMonths(now, 1)), []);
  const prevMonthStats = useMemo(() => {
    const prevTx = transactions.filter((tx) => isWithinInterval(parseISO(tx.date), { start: prevMonthStart, end: prevMonthEnd }));
    return calcStats(prevTx);
  }, [transactions, prevMonthStart, prevMonthEnd]);

  const prevWeekStats = useMemo(() => {
    const prevStart = startOfWeek(subWeeks(now, 1));
    const prevEnd = endOfWeek(subWeeks(now, 1));
    const prevTx = transactions.filter((tx) => isWithinInterval(parseISO(tx.date), { start: prevStart, end: prevEnd }));
    return calcStats(prevTx);
  }, [transactions]);

  const prevDayStats = useMemo(() => {
    const prevDay = subDays(now, 1);
    const prevTx = transactions.filter((tx) => {
      const d = parseISO(tx.date);
      return d.getFullYear() === prevDay.getFullYear() && d.getMonth() === prevDay.getMonth() && d.getDate() === prevDay.getDate();
    });
    return calcStats(prevTx);
  }, [transactions]);

  // Trend data for selected date range
  const trendTx = useMemo(() => {
    const from = parseISO(trendFrom);
    const to = parseISO(trendTo);
    to.setHours(23, 59, 59);
    return transactions.filter((tx) => {
      const d = parseISO(tx.date);
      return isWithinInterval(d, { start: from, end: to });
    });
  }, [transactions, trendFrom, trendTo]);

  const trendStats = calcStats(trendTx);

  // Group by day for trend chart
  const trendChartData = useMemo(() => {
    const from = parseISO(trendFrom);
    const to = parseISO(trendTo);
    to.setHours(23, 59, 59);
    const days: { date: Date; label: string; income: number; expense: number }[] = [];
    const d = new Date(from);
    while (d <= to) {
      const dayStr = format(d, "yyyy-MM-dd");
      const dayTx = trendTx.filter((tx) => tx.date === dayStr);
      days.push({
        date: new Date(d),
        label: format(d, "dd MMM", { locale: idLocale }),
        income: dayTx.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0),
        expense: dayTx.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0),
      });
      d.setDate(d.getDate() + 1);
    }
    return days;
  }, [trendTx, trendFrom, trendTo]);

  const donutData = useMemo(() => {
    const map = new Map<string, number>();
    filtered.filter((t) => t.type === "expense").forEach((t) => map.set(t.category, (map.get(t.category) || 0) + t.amount));
    return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";
  const textMuted = isDark ? "text-zinc-500" : "text-zinc-400";

  const inputCls = isDark
    ? "bg-white/[0.04] border border-white/[0.08] text-white"
    : "bg-zinc-50 border border-zinc-200 text-zinc-900";

  const filterButtons = [
    { id: "all" as const, label: "Semua" },
    { id: "today" as const, label: "Hari Ini" },
    { id: "week" as const, label: "Minggu Ini" },
    { id: "month" as const, label: "Bulan Ini" },
    { id: "year" as const, label: "Tahun Ini" },
  ];

  return (
    <AnimatePresence mode="wait">
      <motion.div key={currentView} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
        className="max-w-lg mx-auto px-5 pt-5 pb-32">

        {currentView === "dashboard" && (
          <div className="space-y-5">
            {/* Greeting */}
            <div className="mb-1">
              <h1 className={`text-[22px] font-bold tracking-tight ${textPrimary}`}>
                Halo, {user?.fullName} 👋
              </h1>
              <p className={`text-[13px] mt-1 ${textSecondary}`}>
                {format(now, "EEEE, d MMMM yyyy", { locale: idLocale })} • {format(now, "HH:mm")} WIB
              </p>
            </div>

            {/* Date Filter */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {filterButtons.map((f) => (
                <button key={f.id} onClick={() => setDateFilter(f.id)}
                  className={`px-4 py-2 rounded-xl text-[12px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    dateFilter === f.id
                      ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/25"
                      : isDark ? "bg-white/[0.04] text-zinc-400 border border-white/[0.06] hover:bg-white/[0.08]" : "bg-white text-zinc-500 border border-zinc-200 hover:bg-zinc-50"
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Pemasukan" value={stats.income} color="emerald" isDark={isDark} />
              <StatCard icon={<TrendingDown className="w-5 h-5" />} label="Pengeluaran" value={stats.expense} color="red" isDark={isDark} />
              <StatCard icon={<Wallet className="w-5 h-5" />} label="Saldo" value={stats.balance} color="blue" isDark={isDark} />
              <StatCard icon={<PiggyBank className="w-5 h-5" />} label="Tabungan" value={0} suffix={`${savingsRate}%`} color="purple" isDark={isDark} />
            </div>

            {/* Comparison Cards */}
            <div className={`rounded-2xl border p-5 ${card}`}>
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className={`w-4 h-4 ${textSecondary}`} />
                <span className={`text-[15px] font-semibold ${textPrimary}`}>Perbandingan</span>
              </div>
              <p className={`text-[12px] mb-4 ${textMuted}`}>Perubahan dari periode sebelumnya</p>
              <div className="space-y-3">
                <ComparisonRow label="Hari Ini" current={todayStats.income} prev={prevDayStats.income} isDark={isDark} />
                <ComparisonRow label="Minggu Ini" current={calcStats(transactions.filter((t) => isWithinInterval(parseISO(t.date), { start: startOfWeek(now), end: endOfWeek(now) }))).income} prev={prevWeekStats.income} isDark={isDark} />
                <ComparisonRow label="Bulan Ini" current={monthStats.income} prev={prevMonthStats.income} isDark={isDark} />
              </div>
            </div>

            {/* Hari Ini */}
            <SummaryCard title="Hari Ini" icon={<Calendar className="w-4 h-4" />} stats={todayStats} isDark={isDark} />

            {/* Bulan Ini */}
            <SummaryCard title="Bulan Ini" icon={<Calendar className="w-4 h-4" />} stats={monthStats} isDark={isDark} />

            {/* Trend dengan Pilihan Tanggal */}
            <div className={`rounded-2xl border p-5 ${card}`}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className={`w-4 h-4 ${textSecondary}`} />
                <span className={`text-[15px] font-semibold ${textPrimary}`}>Trend Keuangan</span>
              </div>
              <p className={`text-[12px] mb-4 ${textMuted}`}>Pilih periode untuk melihat trend</p>

              {/* Date Range Picker */}
              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1">
                  <label className={`block text-[11px] mb-1 ${textMuted}`}>Dari</label>
                  <input type="date" value={trendFrom} onChange={(e) => setTrendFrom(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 text-[13px] outline-none ${inputCls}`} />
                </div>
                <span className={`mt-4 text-[14px] ${textMuted}`}>→</span>
                <div className="flex-1">
                  <label className={`block text-[11px] mb-1 ${textMuted}`}>Sampai</label>
                  <input type="date" value={trendTo} onChange={(e) => setTrendTo(e.target.value)}
                    className={`w-full rounded-xl px-3 py-2 text-[13px] outline-none ${inputCls}`} />
                </div>
              </div>

              {/* Trend Summary */}
              <div className={`grid grid-cols-3 gap-2 mb-4 p-3 rounded-xl ${isDark ? "bg-white/[0.03]" : "bg-zinc-50"}`}>
                <div className="text-center">
                  <p className={`text-[10px] ${textMuted}`}>Pemasukan</p>
                  <p className="text-[12px] font-bold text-emerald-500 tabular-nums">{formatCurrency(trendStats.income)}</p>
                </div>
                <div className="text-center">
                  <p className={`text-[10px] ${textMuted}`}>Pengeluaran</p>
                  <p className="text-[12px] font-bold text-red-500 tabular-nums">{formatCurrency(trendStats.expense)}</p>
                </div>
                <div className="text-center">
                  <p className={`text-[10px] ${textMuted}`}>Selisih</p>
                  <p className={`text-[12px] font-bold tabular-nums ${trendStats.balance >= 0 ? "text-blue-500" : "text-red-500"}`}>{formatCurrency(trendStats.balance)}</p>
                </div>
              </div>

              {/* Mini Chart */}
              {trendChartData.length > 0 && <LineChart data={trendChartData} isDark={isDark} />}

              {trendTx.length === 0 && (
                <p className={`text-[13px] text-center py-4 ${textMuted}`}>Tidak ada transaksi di periode ini</p>
              )}
            </div>

            {/* Komposisi Pengeluaran */}
            {donutData.length > 0 && (
              <div className={`rounded-2xl border p-5 ${card}`}>
                <h3 className={`text-[15px] font-semibold mb-1 ${textPrimary}`}>Komposisi Pengeluaran</h3>
                <p className={`text-[12px] mb-4 ${textMuted}`}>Rincian pengeluaran per kategori</p>
                <DonutChart data={donutData} income={stats.income} expense={stats.expense} isDark={isDark} />
              </div>
            )}

            {/* Transaksi Terbaru */}
            <div className={`rounded-2xl border overflow-hidden ${card}`}>
              <div className="px-5 pt-4 pb-3 flex items-center justify-between">
                <div>
                  <span className={`text-[15px] font-semibold ${textPrimary}`}>Transaksi Terbaru</span>
                  <p className={`text-[12px] ${textMuted}`}>5 transaksi terakhir</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => exportToCSV(filtered, `laporan-${monthLabel}.csv`)}
                    className={`text-[12px] font-medium cursor-pointer flex items-center gap-1 ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                    <Download className="w-3.5 h-3.5" />Export
                  </button>
                  <button onClick={() => onNavigate("reports")}
                    className={`text-[12px] font-medium cursor-pointer ${isDark ? "text-emerald-400" : "text-emerald-600"}`}>
                    Lihat Semua ›
                  </button>
                </div>
              </div>
              {recentTx.length === 0 ? (
                <div className="px-5 pb-6 text-center">
                  <p className={`text-[13px] py-6 ${textMuted}`}>Belum ada transaksi</p>
                  <Button size="sm" onClick={() => onNavigate("add")}>Tambah Sekarang</Button>
                </div>
              ) : (
                <div className={`${isDark ? "divide-white/[0.04]" : "divide-zinc-100"} divide-y`}>
                  {recentTx.map((tx) => (
                    <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5">
                      {tx.image ? (
                        <img src={tx.image} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                      ) : (
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          tx.type === "income" ? (isDark ? "bg-emerald-500/10" : "bg-emerald-50") : (isDark ? "bg-red-500/10" : "bg-red-50")
                        }`}>
                          {tx.type === "income" ? <ArrowUpRight className="w-[18px] h-[18px] text-emerald-500" /> : <ArrowDownRight className="w-[18px] h-[18px] text-red-500" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-[14px] font-medium truncate ${textPrimary}`}>{tx.description}</p>
                        <p className={`text-[12px] mt-0.5 ${textMuted}`}>
                          {tx.category} • {format(parseISO(tx.date), "dd MMM", { locale: idLocale })}
                        </p>
                      </div>
                      <span className={`text-[13px] font-semibold tabular-nums whitespace-nowrap ${tx.type === "income" ? "text-emerald-500" : "text-red-500"}`}>
                        {tx.type === "income" ? "+" : "-"}{formatCurrency(tx.amount)}
                      </span>
                      <button onClick={() => deleteTransaction(tx.id)}
                        className={`p-1.5 rounded-lg cursor-pointer flex-shrink-0 transition-colors ${isDark ? "text-zinc-600 hover:text-red-400" : "text-zinc-300 hover:text-red-400"}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {currentView === "add" && <TransactionForm editingTx={editingTx} onCancel={() => { setEditingTx(null); onNavigate("dashboard"); }} />}
        {currentView === "transactions" && <TransactionList onEdit={(tx) => { setEditingTx(tx); onNavigate("add"); }} onAdd={() => onNavigate("add")} />}
      </motion.div>

      {/* FAB */}
      {currentView === "dashboard" && (
        <div className="fixed bottom-0 left-0 right-0 z-30 p-4 pb-5 pointer-events-none">
          <div className="max-w-lg mx-auto pointer-events-auto">
            <Button onClick={() => onNavigate("add")} className="w-full shadow-lg shadow-emerald-500/25" size="lg">
              + Tambah Transaksi
            </Button>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* Comparison Row */
function ComparisonRow({ label, current, prev, isDark }: { label: string; current: number; prev: number; isDark: boolean }) {
  const change = prev === 0 ? (current > 0 ? 100 : 0) : ((current - prev) / prev) * 100;
  const isUp = change > 0;
  const isDown = change < 0;
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";

  return (
    <div className="flex items-center justify-between">
      <span className={`text-[13px] ${textSecondary}`}>{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-[13px] font-semibold tabular-nums ${textPrimary}`}>{formatCurrency(current)}</span>
        {prev > 0 && (
          <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${
            isUp ? "bg-emerald-500/10 text-emerald-500" : isDown ? "bg-red-500/10 text-red-500" : "bg-zinc-500/10 text-zinc-500"
          }`}>
            {isUp ? "+" : ""}{change.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

/* Stat Card */
function StatCard({ icon, label, value, suffix, color, isDark }: {
  icon: React.ReactNode; label: string; value: number; suffix?: string;
  color: "emerald" | "red" | "blue" | "purple"; isDark: boolean;
}) {
  const palette = {
    emerald: { bg: isDark ? "bg-emerald-500/10" : "bg-emerald-50", icon: "text-emerald-500", value: "text-emerald-500" },
    red:     { bg: isDark ? "bg-red-500/10" : "bg-red-50",     icon: "text-red-500",     value: "text-red-500" },
    blue:    { bg: isDark ? "bg-blue-500/10" : "bg-blue-50",    icon: "text-blue-500",    value: "text-blue-500" },
    purple:  { bg: isDark ? "bg-purple-500/10" : "bg-purple-50", icon: "text-purple-500", value: "text-purple-500" },
  };
  const p = palette[color];
  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";

  return (
    <div className={`rounded-2xl border p-4 ${card}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${p.bg}`}>
          <span className={p.icon}>{icon}</span>
        </div>
        <span className={`text-[12px] font-medium ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>{label}</span>
      </div>
      <p className={`text-[17px] font-bold tabular-nums ${p.value}`}>
        {suffix || formatCurrency(value)}
      </p>
    </div>
  );
}

/* Summary Card */
function SummaryCard({ title, icon, stats, isDark }: {
  title: string; icon: React.ReactNode; stats: { income: number; expense: number; balance: number }; isDark: boolean;
}) {
  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";

  return (
    <div className={`rounded-2xl border p-5 ${card}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className={textSecondary}>{icon}</span>
        <span className={`text-[15px] font-semibold ${textPrimary}`}>{title}</span>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className={`text-[14px] ${textSecondary}`}>Pemasukan</span>
          <span className="text-[14px] font-semibold text-emerald-500 tabular-nums">{formatCurrency(stats.income)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className={`text-[14px] ${textSecondary}`}>Pengeluaran</span>
          <span className="text-[14px] font-semibold text-red-500 tabular-nums">{formatCurrency(stats.expense)}</span>
        </div>
        <div className={`pt-3 border-t ${isDark ? "border-white/[0.06]" : "border-zinc-100"}`}>
          <div className="flex items-center justify-between">
            <span className={`text-[14px] font-bold ${textPrimary}`}>Selisih</span>
            <span className={`text-[14px] font-bold tabular-nums ${stats.balance >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatCurrency(stats.balance)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Line Chart */
function LineChart({ data, isDark }: { data: { label: string; income: number; expense: number }[]; isDark: boolean }) {
  const allValues = data.flatMap((d) => [d.income, d.expense]);
  const maxVal = Math.max(...allValues, 1000);
  const w = 320, h = 170;
  const pad = { top: 10, right: 12, bottom: 24, left: 44 };
  const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
  const toY = (v: number) => pad.top + ch - (v / maxVal) * ch;
  const toX = (i: number) => pad.left + (i / Math.max(data.length - 1, 1)) * cw;
  const incomePoints = data.map((d, i) => `${toX(i)},${toY(d.income)}`).join(" ");
  const expensePoints = data.map((d, i) => `${toX(i)},${toY(d.expense)}`).join(" ");
  const fmt = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}jt` : v >= 1000 ? `${(v / 1000).toFixed(0)}rb` : "0";
  const gridN = 4;
  const gridVals = Array.from({ length: gridN + 1 }, (_, i) => Math.round((maxVal / gridN) * i));
  const textColor = isDark ? "#71717a" : "#a1a1aa";
  // Show max 10 labels, skip some if too many
  const labelStep = Math.max(1, Math.floor(data.length / 8));

  return (
    <div className="overflow-x-auto -mx-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ minWidth: 260 }}>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={pad.left} y1={toY(v)} x2={w - pad.right} y2={toY(v)} stroke={isDark ? "#27272a" : "#e4e4e7"} strokeWidth="0.7" />
            <text x={pad.left - 6} y={toY(v) + 3.5} textAnchor="end" fontSize="9" fill={textColor} fontFamily="Inter">{fmt(v)}</text>
          </g>
        ))}
        {data.map((d, i) => (
          i % labelStep === 0 && <text key={i} x={toX(i)} y={h - 4} textAnchor="middle" fontSize="8" fill={textColor} fontFamily="Inter">{d.label}</text>
        ))}
        <polygon points={`${toX(0)},${toY(0)} ${incomePoints} ${toX(data.length - 1)},${toY(0)}`} fill="url(#gG)" opacity="0.3" />
        <polyline points={incomePoints} fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points={`${toX(0)},${toY(0)} ${expensePoints} ${toX(data.length - 1)},${toY(0)}`} fill="url(#rG)" opacity="0.2" />
        <polyline points={expensePoints} fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={toX(i)} cy={toY(d.income)} r="3.5" fill="#10b981" stroke={isDark ? "#18181b" : "white"} strokeWidth="2" />
            <circle cx={toX(i)} cy={toY(d.expense)} r="3.5" fill="#ef4444" stroke={isDark ? "#18181b" : "white"} strokeWidth="2" />
          </g>
        ))}
        <defs>
          <linearGradient id="gG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity="0.4" /><stop offset="100%" stopColor="#10b981" stopOpacity="0" /></linearGradient>
          <linearGradient id="rG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" /><stop offset="100%" stopColor="#ef4444" stopOpacity="0" /></linearGradient>
        </defs>
      </svg>
      <div className="flex items-center justify-center gap-5 mt-3">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-emerald-500" /><span className={`text-[11px] font-medium ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>Pemasukan</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /><span className={`text-[11px] font-medium ${isDark ? "text-zinc-400" : "text-zinc-500"}`}>Pengeluaran</span></div>
      </div>
    </div>
  );
}

/* Donut Chart with Income/Expense/Remaining */
function DonutChart({ data, income, expense, isDark }: { data: { label: string; value: number }[]; income: number; expense: number; isDark: boolean }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const remaining = income - expense;
  const colors = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];
  const size = 140, r = 50, sw = 20;
  const circ = 2 * Math.PI * r;
  let cum = 0;
  const segs = data.map((d, i) => {
    const pct = total > 0 ? (d.value / total) * 100 : 0;
    const dash = (pct / 100) * circ;
    const off = -((cum / 100) * circ);
    cum += pct;
    return { ...d, pct, dash, off, color: colors[i % colors.length] };
  });

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className={`text-[11px] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>Pemasukan</p>
          <p className="text-[13px] font-bold text-emerald-500 tabular-nums">{formatCurrency(income)}</p>
        </div>
        <div className="text-center">
          <p className={`text-[11px] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>Pengeluaran</p>
          <p className="text-[13px] font-bold text-red-500 tabular-nums">{formatCurrency(expense)}</p>
        </div>
        <div className="text-center">
          <p className={`text-[11px] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>Sisa</p>
          <p className={`text-[13px] font-bold tabular-nums ${remaining >= 0 ? "text-blue-500" : "text-red-500"}`}>{formatCurrency(remaining)}</p>
        </div>
      </div>

      {/* Chart + Legend */}
      <div className="flex flex-col sm:flex-row items-center gap-5">
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={isDark ? "#27272a" : "#f4f4f5"} strokeWidth={sw} />
            {segs.map((s, i) => (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={sw}
                strokeDasharray={`${s.dash} ${circ - s.dash}`} strokeDashoffset={s.off} strokeLinecap="round" />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-[13px] font-bold ${isDark ? "text-white" : "text-zinc-900"}`}>{formatCurrency(total)}</span>
            <span className={`text-[10px] ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>Total</span>
          </div>
        </div>
        <div className="space-y-2.5 flex-1 w-full">
          {segs.slice(0, 6).map((s, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
              <span className={`text-[13px] flex-1 truncate ${isDark ? "text-zinc-300" : "text-zinc-600"}`}>{s.label}</span>
              <span className={`text-[12px] tabular-nums flex-shrink-0 ${isDark ? "text-zinc-500" : "text-zinc-400"}`}>{formatCurrency(s.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
