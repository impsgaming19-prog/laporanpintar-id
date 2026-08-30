import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Wallet, TrendingDown, PiggyBank, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { format, parseISO, isWithinInterval, startOfMonth, endOfMonth } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useData, useTheme } from "@/contexts/AppContext";
import { formatCurrency, generateId } from "@/lib/utils";
import Button from "@/components/ui/Button";

interface Budget { id: string; category: string; amount: number; }
interface SavingsTarget { id: string; name: string; target: number; current: number; deadline: string; }

export default function BudgetPage() {
  const { transactions } = useData();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [budgets, setBudgets] = useState<Budget[]>(() => { const s = localStorage.getItem("budgets"); return s ? JSON.parse(s) : []; });
  const [targets, setTargets] = useState<SavingsTarget[]>(() => { const s = localStorage.getItem("savings_targets"); return s ? JSON.parse(s) : []; });
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [budgetCategory, setBudgetCategory] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [targetName, setTargetName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [targetCurrent, setTargetCurrent] = useState("");
  const [targetDeadline, setTargetDeadline] = useState("");

  // Deposit/Withdraw state per target
  const [depositingId, setDepositingId] = useState<string | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");

  const now = new Date();
  const monthExpenses = useMemo(() =>
    transactions.filter((tx) => tx.type === "expense" && isWithinInterval(parseISO(tx.date), { start: startOfMonth(now), end: endOfMonth(now) })),
    [transactions]
  );

  const totalBudget = budgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = budgets.reduce((s, b) => s + monthExpenses.filter((t) => t.category === b.category).reduce((sum, t) => sum + t.amount, 0), 0);
  const totalSavings = targets.reduce((s, t) => s + t.current, 0);
  const totalTarget = targets.reduce((s, t) => s + t.target, 0);

  const addBudget = () => {
    if (!budgetCategory || !budgetAmount) return;
    setBudgets((prev) => { const u = [...prev.filter((b) => b.category !== budgetCategory), { id: generateId(), category: budgetCategory, amount: parseFloat(budgetAmount) }]; localStorage.setItem("budgets", JSON.stringify(u)); return u; });
    setBudgetCategory(""); setBudgetAmount(""); setShowBudgetForm(false);
  };

  const addTarget = () => {
    if (!targetName || !targetAmount) return;
    setTargets((prev) => { const u = [...prev, { id: generateId(), name: targetName, target: parseFloat(targetAmount), current: parseFloat(targetCurrent || "0"), deadline: targetDeadline }]; localStorage.setItem("savings_targets", JSON.stringify(u)); return u; });
    setTargetName(""); setTargetAmount(""); setTargetCurrent(""); setTargetDeadline(""); setShowTargetForm(false);
  };

  const removeBudget = (id: string) => { setBudgets((prev) => { const u = prev.filter((b) => b.id !== id); localStorage.setItem("budgets", JSON.stringify(u)); return u; }); };
  const removeTarget = (id: string) => { setTargets((prev) => { const u = prev.filter((t) => t.id !== id); localStorage.setItem("savings_targets", JSON.stringify(u)); return u; }); };

  const handleDeposit = (id: string) => {
    const amt = parseFloat(depositAmount);
    if (isNaN(amt) || amt <= 0) return;
    setTargets((prev) => {
      const u = prev.map((t) => t.id === id ? { ...t, current: t.current + amt } : t);
      localStorage.setItem("savings_targets", JSON.stringify(u));
      return u;
    });
    setDepositAmount("");
    setDepositingId(null);
  };

  const handleWithdraw = (id: string) => {
    const amt = parseFloat(withdrawAmount);
    if (isNaN(amt) || amt <= 0) return;
    setTargets((prev) => {
      const u = prev.map((t) => t.id === id ? { ...t, current: Math.max(0, t.current - amt) } : t);
      localStorage.setItem("savings_targets", JSON.stringify(u));
      return u;
    });
    setWithdrawAmount("");
    setWithdrawingId(null);
  };

  const card = isDark ? "bg-[#1e293b] border-white/[0.06]" : "bg-white border-gray-100";
  const inputCls = `w-full rounded-xl px-4 py-2.5 text-[14px] transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500
    ${isDark ? "bg-[#0f172a] border border-white/[0.06] text-white placeholder:text-slate-600" : "bg-gray-50 border border-gray-200 text-gray-900 placeholder:text-gray-400"}`;
  const itemCls = isDark ? "bg-[#0f172a] border-white/[0.06]" : "bg-gray-50 border-gray-100";

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-5 pt-5 pb-8 space-y-4">

      <h1 className={`text-[22px] font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Budget & Target</h1>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className={`rounded-2xl border p-4 ${card}`}>
          <div className="flex items-center gap-1.5 mb-2">
            <Wallet className="w-4 h-4 text-blue-500" />
            <span className={`text-[11px] font-medium truncate ${isDark ? "text-slate-500" : "text-gray-400"}`}>Budget</span>
          </div>
          <p className={`text-[14px] font-bold tabular-nums truncate ${isDark ? "text-white" : "text-gray-900"}`}>{formatCurrency(totalBudget)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${card}`}>
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingDown className="w-4 h-4 text-red-500" />
            <span className={`text-[11px] font-medium truncate ${isDark ? "text-slate-500" : "text-gray-400"}`}>Terpakai</span>
          </div>
          <p className="text-[14px] font-bold text-red-500 tabular-nums truncate">{formatCurrency(totalSpent)}</p>
        </div>
        <div className={`rounded-2xl border p-4 ${card}`}>
          <div className="flex items-center gap-1.5 mb-2">
            <PiggyBank className="w-4 h-4 text-emerald-500" />
            <span className={`text-[11px] font-medium truncate ${isDark ? "text-slate-500" : "text-gray-400"}`}>Sisa</span>
          </div>
          <p className={`text-[14px] font-bold tabular-nums truncate ${totalBudget - totalSpent >= 0 ? "text-emerald-500" : "text-red-500"}`}>{formatCurrency(totalBudget - totalSpent)}</p>
        </div>
      </div>

      {/* Budget per Kategori */}
      <div className={`rounded-2xl border shadow-sm p-5 ${card}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-[15px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Budget per Kategori</h3>
          <button onClick={() => setShowBudgetForm(!showBudgetForm)}
            className="px-3 py-1.5 rounded-xl bg-emerald-500 text-white text-[12px] font-semibold flex items-center gap-1 cursor-pointer shadow-sm shadow-emerald-500/20">
            <Plus className="w-3 h-3" /> Tambah
          </button>
        </div>
        <AnimatePresence>
          {showBudgetForm && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
              <div className="space-y-3">
                <input type="text" placeholder="Nama Kategori" value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)} className={inputCls} />
                <input type="number" placeholder="Budget (Rp)" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} className={inputCls} />
                <div className="flex gap-2">
                  <Button onClick={addBudget} size="sm" className="flex-1">Simpan</Button>
                  <Button onClick={() => setShowBudgetForm(false)} variant="secondary" size="sm">Batal</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {budgets.length === 0 ? (
          <p className={`text-[13px] text-center py-6 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Belum ada budget</p>
        ) : (
          <div className="space-y-3">
            {budgets.map((b) => {
              const spent = monthExpenses.filter((t) => t.category === b.category).reduce((s, t) => s + t.amount, 0);
              const pct = b.amount > 0 ? Math.min((spent / b.amount) * 100, 100) : 0;
              return (
                <div key={b.id} className={`p-3.5 rounded-xl border ${itemCls}`}>
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className={`text-[14px] font-medium truncate ${isDark ? "text-white" : "text-gray-900"}`}>{b.category}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-[12px] tabular-nums truncate ${isDark ? "text-slate-500" : "text-gray-400"}`}>{formatCurrency(spent)} / {formatCurrency(b.amount)}</span>
                      <button onClick={() => removeBudget(b.id)} className={`p-1 rounded-lg cursor-pointer ${isDark ? "text-slate-600 hover:text-red-400 hover:bg-red-500/10" : "text-gray-300 hover:text-red-400 hover:bg-red-50"}`}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className={`h-2 rounded-full overflow-hidden ${isDark ? "bg-white/[0.06]" : "bg-gray-200"}`}>
                    <div className={`h-full rounded-full transition-all ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`text-[10px] mt-1 text-right ${isDark ? "text-slate-600" : "text-gray-400"}`}>{pct.toFixed(0)}%</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Target Tabungan */}
      <div className={`rounded-2xl border shadow-sm p-5 ${card}`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className={`text-[15px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Target Tabungan</h3>
            {targets.length > 0 && (
              <p className={`text-[12px] mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                Total: {formatCurrency(totalSavings)} / {formatCurrency(totalTarget)}
              </p>
            )}
          </div>
          <button onClick={() => setShowTargetForm(!showTargetForm)}
            className="px-3 py-1.5 rounded-xl bg-blue-500 text-white text-[12px] font-semibold flex items-center gap-1 cursor-pointer shadow-sm shadow-blue-500/20">
            <Plus className="w-3 h-3" /> Tambah
          </button>
        </div>
        <AnimatePresence>
          {showTargetForm && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
              <div className="space-y-3">
                <input type="text" placeholder="Nama Target (contoh: Beli HP)" value={targetName} onChange={(e) => setTargetName(e.target.value)} className={inputCls} />
                <input type="number" placeholder="Target (Rp)" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} className={inputCls} />
                <input type="number" placeholder="Sudah Terkumpul (Rp)" value={targetCurrent} onChange={(e) => setTargetCurrent(e.target.value)} className={inputCls} />
                <input type="date" value={targetDeadline} onChange={(e) => setTargetDeadline(e.target.value)} className={inputCls} />
                <div className="flex gap-2">
                  <Button onClick={addTarget} size="sm" className="flex-1">Simpan</Button>
                  <Button onClick={() => setShowTargetForm(false)} variant="secondary" size="sm">Batal</Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {targets.length === 0 ? (
          <p className={`text-[13px] text-center py-6 ${isDark ? "text-slate-500" : "text-gray-400"}`}>Belum ada target tabungan</p>
        ) : (
          <div className="space-y-3">
            {targets.map((t) => {
              const pct = t.target > 0 ? Math.min((t.current / t.target) * 100, 100) : 0;
              const remaining = Math.max(0, t.target - t.current);
              return (
                <div key={t.id} className={`p-4 rounded-xl border ${itemCls}`}>
                  {/* Header: name + delete */}
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className={`text-[14px] font-semibold truncate ${isDark ? "text-white" : "text-gray-900"}`}>{t.name}</span>
                    <button onClick={() => removeTarget(t.id)} className={`p-1 rounded-lg cursor-pointer flex-shrink-0 ${isDark ? "text-slate-600 hover:text-red-400 hover:bg-red-500/10" : "text-gray-300 hover:text-red-400 hover:bg-red-50"}`}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Amounts */}
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className={`text-[13px] font-bold tabular-nums ${isDark ? "text-white" : "text-gray-900"}`}>{formatCurrency(t.current)}</span>
                    <span className={`text-[12px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>/ {formatCurrency(t.target)}</span>
                  </div>
                  {remaining > 0 && (
                    <p className={`text-[11px] mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                      Sisa {formatCurrency(remaining)} lagi
                    </p>
                  )}
                  {remaining === 0 && (
                    <p className="text-[11px] mb-2 text-emerald-500 font-semibold">✓ Target tercapai!</p>
                  )}

                  {/* Deadline */}
                  {t.deadline && (
                    <p className={`text-[11px] mb-3 ${isDark ? "text-slate-600" : "text-gray-400"}`}>
                      Target: {format(parseISO(t.deadline), "dd MMM yyyy", { locale: idLocale })}
                    </p>
                  )}

                  {/* Progress bar */}
                  <div className={`h-2.5 rounded-full overflow-hidden mb-3 ${isDark ? "bg-blue-500/10" : "bg-blue-100"}`}>
                    <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`text-[11px] mb-3 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{pct.toFixed(0)}% tercapai</p>

                  {/* Action Buttons: Setor & Tarik */}
                  <div className="flex gap-2">
                    <button onClick={() => { setDepositingId(depositingId === t.id ? null : t.id); setWithdrawingId(null); setDepositAmount(""); }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold cursor-pointer transition-all
                        bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20">
                      <ArrowDownToLine className="w-3.5 h-3.5" /> Setor
                    </button>
                    <button onClick={() => { setWithdrawingId(withdrawingId === t.id ? null : t.id); setDepositingId(null); setWithdrawAmount(""); }}
                      disabled={t.current <= 0}
                      className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[12px] font-semibold cursor-pointer transition-all border
                        ${t.current <= 0
                          ? isDark ? "text-slate-600 border-white/[0.04] cursor-not-allowed" : "text-gray-300 border-gray-100 cursor-not-allowed"
                          : "text-amber-500 border-amber-500/20 hover:bg-amber-500/10 bg-amber-500/10"
                        }`}>
                      <ArrowUpFromLine className="w-3.5 h-3.5" /> Tarik
                    </button>
                  </div>

                  {/* Deposit Input */}
                  <AnimatePresence>
                    {depositingId === t.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden mt-3">
                        <div className="flex gap-2">
                          <input type="number" placeholder="Jumlah setor (Rp)" value={depositAmount} onChange={(e) => setDepositAmount(e.target.value)}
                            className={`${inputCls} flex-1`} autoFocus />
                          <button onClick={() => handleDeposit(t.id)}
                            className="px-4 py-2 rounded-xl bg-emerald-500 text-white text-[12px] font-semibold cursor-pointer shadow-sm shadow-emerald-500/20 flex-shrink-0">
                            OK
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Withdraw Input */}
                  <AnimatePresence>
                    {withdrawingId === t.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden mt-3">
                        <div className="flex gap-2">
                          <input type="number" placeholder="Jumlah tarik (Rp)" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)}
                            max={t.current}
                            className={`${inputCls} flex-1`} autoFocus />
                          <button onClick={() => handleWithdraw(t.id)}
                            className="px-4 py-2 rounded-xl bg-amber-500 text-white text-[12px] font-semibold cursor-pointer shadow-sm shadow-amber-500/20 flex-shrink-0">
                            OK
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
