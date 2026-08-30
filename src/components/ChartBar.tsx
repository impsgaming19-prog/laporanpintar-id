import { useMemo } from "react";
import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/utils";

interface ChartBarProps {
  data: { label: string; income: number; expense: number }[];
  height?: number;
}

export default function ChartBar({ data, height = 300 }: ChartBarProps) {
  const maxVal = useMemo(
    () => Math.max(...data.map((d) => Math.max(d.income, d.expense)), 1),
    [data]
  );

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-slate-500 text-sm" style={{ height }}>
        Belum ada data
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-emerald-500" />
          <span className="text-slate-400">Pemasukan</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-slate-400">Pengeluaran</span>
        </div>
      </div>

      {/* Bars */}
      <div className="space-y-3">
        {data.map((item, i) => {
          const incomeWidth = maxVal > 0 ? (item.income / maxVal) * 100 : 0;
          const expenseWidth = maxVal > 0 ? (item.expense / maxVal) * 100 : 0;

          return (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <p className="text-[11px] sm:text-xs font-medium text-slate-300 mb-1.5">
                {item.label}
              </p>
              <div className="space-y-1">
                {/* Income bar */}
                <div className="flex items-center gap-2">
                  <div className="w-full h-5 bg-white/5 rounded-lg overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${incomeWidth}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 }}
                      className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-lg flex items-center justify-end pr-2"
                    >
                      {incomeWidth > 15 && (
                        <span className="text-[10px] font-medium text-white">
                          {formatCurrency(item.income)}
                        </span>
                      )}
                    </motion.div>
                  </div>
                  {incomeWidth <= 15 && (
                    <span className="text-[10px] text-emerald-400 whitespace-nowrap">
                      {formatCurrency(item.income)}
                    </span>
                  )}
                </div>
                {/* Expense bar */}
                <div className="flex items-center gap-2">
                  <div className="w-full h-5 bg-white/5 rounded-lg overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${expenseWidth}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 + 0.1 }}
                      className="h-full bg-gradient-to-r from-red-600 to-red-400 rounded-lg flex items-center justify-end pr-2"
                    >
                      {expenseWidth > 15 && (
                        <span className="text-[10px] font-medium text-white">
                          {formatCurrency(item.expense)}
                        </span>
                      )}
                    </motion.div>
                  </div>
                  {expenseWidth <= 15 && (
                    <span className="text-[10px] text-red-400 whitespace-nowrap">
                      {formatCurrency(item.expense)}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
