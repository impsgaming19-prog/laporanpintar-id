import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { FileText, Download, FileSpreadsheet, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { format, parseISO, isWithinInterval, startOfMonth, endOfMonth, startOfYear } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useData, useTheme } from "@/contexts/AppContext";
import { formatCurrency } from "@/lib/utils";
import { exportToCSV } from "@/lib/export";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const YEARS = [2024, 2025, 2026, 2027];

export default function ReportsPage() {
  const { transactions } = useData();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const now = new Date();

  const [periodType, setPeriodType] = useState<"monthly" | "yearly">("monthly");
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      const d = parseISO(tx.date);
      if (periodType === "monthly") {
        const start = startOfMonth(new Date(selectedYear, selectedMonth, 1));
        const end = endOfMonth(new Date(selectedYear, selectedMonth, 1));
        return isWithinInterval(d, { start, end });
      } else {
        return d.getFullYear() === selectedYear;
      }
    });
  }, [transactions, periodType, selectedMonth, selectedYear]);

  const totals = useMemo(() => {
    const income = filtered.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expense = filtered.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    return { income, expense, balance: income - expense };
  }, [filtered]);

  const categoryRecap = useMemo(() => {
    const map = new Map<string, { income: number; expense: number }>();
    filtered.forEach((tx) => {
      const existing = map.get(tx.category) || { income: 0, expense: 0 };
      if (tx.type === "income") existing.income += tx.amount;
      else existing.expense += tx.amount;
      map.set(tx.category, existing);
    });
    return Array.from(map.entries())
      .map(([category, data]) => ({ category, ...data, balance: data.income - data.expense }))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [filtered]);

  const card = isDark ? "bg-[#1e293b] border-white/[0.06]" : "bg-white border-gray-100";
  const periodLabel = periodType === "monthly"
    ? `${MONTHS[selectedMonth]} ${selectedYear}`
    : `Tahun ${selectedYear}`;

  const handleExportPDF = () => {
    // Generate text-based report
    let report = `LAPORAN KEUANGAN\n`;
    report += `Periode: ${periodLabel}\n`;
    report += `================================\n\n`;
    report += `RINGKASAN\n`;
    report += `Pemasukan : ${formatCurrency(totals.income)}\n`;
    report += `Pengeluaran: ${formatCurrency(totals.expense)}\n`;
    report += `Selisih    : ${formatCurrency(totals.balance)}\n\n`;
    report += `REKAP PER KATEGORI\n`;
    report += `--------------------------------\n`;
    categoryRecap.forEach((c) => {
      report += `${c.category}\n`;
      report += `  Pemasukan: ${formatCurrency(c.income)} | Pengeluaran: ${formatCurrency(c.expense)} | Selisih: ${formatCurrency(c.balance)}\n`;
    });
    report += `\n================================\n`;
    report += `Dibuat: ${format(now, "dd MMMM yyyy HH:mm", { locale: idLocale })}\n`;

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `laporan-${periodLabel.replace(" ", "-").toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-5 pt-5 pb-32 space-y-4">

      {/* ═══ Header ═══ */}
      <div>
        <h1 className={`text-[22px] font-bold tracking-tight ${isDark ? "text-white" : "text-gray-900"}`}>
          Laporan & Export
        </h1>
        <p className={`text-[13px] mt-0.5 ${isDark ? "text-slate-400" : "text-gray-400"}`}>
          Generate dan unduh laporan keuangan
        </p>
      </div>

      {/* ═══ Period Selector ═══ */}
      <div className={`rounded-2xl border p-5 ${card}`}>
        {/* Toggle */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setPeriodType("monthly")}
            className={`px-5 py-2.5 rounded-xl text-[14px] font-semibold transition-all cursor-pointer ${
              periodType === "monthly"
                ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20"
                : isDark ? "bg-[#0f172a] text-slate-400 border border-white/[0.06]" : "bg-gray-50 text-gray-500 border border-gray-200"
            }`}>
            Bulanan
          </button>
          <button onClick={() => setPeriodType("yearly")}
            className={`px-5 py-2.5 rounded-xl text-[14px] font-semibold transition-all cursor-pointer ${
              periodType === "yearly"
                ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/20"
                : isDark ? "bg-[#0f172a] text-slate-400 border border-white/[0.06]" : "bg-gray-50 text-gray-500 border border-gray-200"
            }`}>
            Tahunan
          </button>
        </div>

        {/* Selectors */}
        <div className="flex items-center gap-3">
          {periodType === "monthly" && (
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-[14px] font-medium outline-none cursor-pointer ${
                isDark ? "bg-[#0f172a] border-white/[0.06] text-white" : "bg-gray-50 border-gray-200 text-gray-900"
              }`}>
              {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          )}
          <select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}
            className={`rounded-xl border px-3 py-2.5 text-[14px] font-medium outline-none cursor-pointer ${
              isDark ? "bg-[#0f172a] border-white/[0.06] text-white" : "bg-gray-50 border-gray-200 text-gray-900"
            } ${periodType === "yearly" ? "flex-1" : ""}`}>
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className={`text-[12px] whitespace-nowrap flex-shrink-0 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            {filtered.length} transaksi
          </span>
        </div>
      </div>

      {/* ═══ Stat Cards ═══ */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Pemasukan" value={totals.income} color="emerald" isDark={isDark} />
        <StatCard icon={<TrendingDown className="w-5 h-5" />} label="Pengeluaran" value={totals.expense} color="red" isDark={isDark} />
        <StatCard icon={<Wallet className="w-5 h-5" />} label="Saldo" value={totals.balance} color="blue" isDark={isDark} />
      </div>

      {/* ═══ Rekap per Kategori ═══ */}
      <div className={`rounded-2xl border p-5 ${card}`}>
        <h3 className={`text-[15px] font-semibold mb-4 ${isDark ? "text-white" : "text-gray-900"}`}>
          Rekap per Kategori
        </h3>
        {categoryRecap.length === 0 ? (
          <p className={`text-[13px] text-center py-6 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
            Tidak ada data
          </p>
        ) : (
          <div className="space-y-3">
            {categoryRecap.map((row, i) => (
              <div key={i} className={`rounded-xl border p-4 ${isDark ? "bg-[#0f172a] border-white/[0.04]" : "bg-gray-50 border-gray-100"}`}>
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-[15px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{row.category}</span>
                  <span className={`text-[14px] font-bold tabular-nums ${
                    row.balance >= 0 ? "text-emerald-500" : "text-red-500"
                  }`}>
                    {formatCurrency(row.balance)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className={`text-[11px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Pemasukan</p>
                    <p className={`text-[13px] font-semibold tabular-nums ${row.income > 0 ? "text-emerald-500" : (isDark ? "text-slate-600" : "text-gray-300")}`}>
                      {row.income > 0 ? formatCurrency(row.income) : "-"}
                    </p>
                  </div>
                  <div>
                    <p className={`text-[11px] mb-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Pengeluaran</p>
                    <p className={`text-[13px] font-semibold tabular-nums ${row.expense > 0 ? "text-red-500" : (isDark ? "text-slate-600" : "text-gray-300")}`}>
                      {row.expense > 0 ? formatCurrency(row.expense) : "-"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ Export Buttons ═══ */}
      <div className="grid grid-cols-2 gap-3">
        <button onClick={handleExportPDF}
          className={`rounded-2xl border p-5 text-center cursor-pointer transition-all hover:scale-[0.98] ${
            isDark ? "bg-[#1e293b] border-white/[0.06] hover:border-red-500/30" : "bg-white border-gray-100 hover:border-red-200"
          }`}>
          <div className={`w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center ${
            isDark ? "bg-red-500/15" : "bg-red-50"
          }`}>
            <FileText className="w-6 h-6 text-red-500" />
          </div>
          <p className={`text-[14px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Export PDF</p>
          <p className={`text-[12px] mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Cetak atau simpan PDF</p>
        </button>

        <button onClick={() => exportToCSV(filtered, `laporan-${periodLabel.replace(" ", "-").toLowerCase()}.csv`)}
          className={`rounded-2xl border p-5 text-center cursor-pointer transition-all hover:scale-[0.98] ${
            isDark ? "bg-[#1e293b] border-white/[0.06] hover:border-emerald-500/30" : "bg-white border-gray-100 hover:border-emerald-200"
          }`}>
          <div className={`w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center ${
            isDark ? "bg-emerald-500/15" : "bg-emerald-50"
          }`}>
            <FileSpreadsheet className="w-6 h-6 text-emerald-500" />
          </div>
          <p className={`text-[14px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Export Excel</p>
          <p className={`text-[12px] mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Unduh file CSV</p>
        </button>
      </div>
    </motion.div>
  );
}

function StatCard({ icon, label, value, color, isDark }: {
  icon: React.ReactNode; label: string; value: number;
  color: "emerald" | "red" | "blue"; isDark: boolean;
}) {
  const palette = {
    emerald: { bg: isDark ? "bg-emerald-500/10" : "bg-emerald-50", icon: "text-emerald-500", value: "text-emerald-500" },
    red:     { bg: isDark ? "bg-red-500/10" : "bg-red-50",     icon: "text-red-500",     value: "text-red-500" },
    blue:    { bg: isDark ? "bg-blue-500/10" : "bg-blue-50",    icon: "text-blue-500",    value: "text-blue-500" },
  };
  const p = palette[color];

  return (
    <div className={`rounded-2xl border p-3.5 text-center overflow-hidden ${isDark ? "bg-[#1e293b] border-white/[0.06]" : "bg-white border-gray-100 shadow-sm"}`}>
      <div className={`w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center ${p.bg}`}>
        <div className={p.icon}>{icon}</div>
      </div>
      <p className={`text-[11px] mb-0.5 truncate ${isDark ? "text-slate-400" : "text-gray-500"}`}>{label}</p>
      <p className={`text-[13px] font-bold tabular-nums truncate ${p.value}`}>{formatCurrency(value)}</p>
    </div>
  );
}
