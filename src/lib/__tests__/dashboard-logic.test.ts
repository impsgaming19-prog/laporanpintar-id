import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseISO,
  isWithinInterval,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  isToday,
} from "date-fns";

// ── Extracted logic from DashboardPage (the code under test) ──

type TxType = "income" | "expense";
interface Tx {
  id: string;
  type: TxType;
  amount: number;
  date: string; // ISO date string
  category: string;
  description: string;
}

function calcStats(txs: Tx[]) {
  const income = txs
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const expense = txs
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  return { income, expense, balance: income - expense };
}

function filterByPeriod(
  txs: Tx[],
  period: "all" | "today" | "week" | "month" | "year",
  referenceDate: Date
): Tx[] {
  if (period === "all") return txs;
  const monthStart = startOfMonth(referenceDate);
  const monthEnd = endOfMonth(referenceDate);
  return txs.filter((tx) => {
    const d = parseISO(tx.date);
    switch (period) {
      case "today":
        return isToday(d);
      case "week":
        return isWithinInterval(d, {
          start: startOfWeek(referenceDate),
          end: endOfWeek(referenceDate),
        });
      case "month":
        return isWithinInterval(d, { start: monthStart, end: monthEnd });
      case "year":
        return d.getFullYear() === referenceDate.getFullYear();
      default:
        return true;
    }
  });
}

// ── Fixtures ──

function tx(
  overrides: Partial<Tx> & { date: string; amount: number; type: TxType }
): Tx {
  return {
    id: Math.random().toString(36).slice(2),
    category: "Gaji",
    description: "Test transaction",
    ...overrides,
  };
}

const now = new Date();
const y = now.getFullYear();
const m = String(now.getMonth() + 1).padStart(2, "0");
const d = String(now.getDate()).padStart(2, "0");
const today = `${y}-${m}-${d}`;

const sampleTransactions: Tx[] = [
  tx({ id: "1", type: "income", amount: 5000000, date: today }),
  tx({ id: "2", type: "expense", amount: 1000000, date: today }),
  tx({
    id: "3",
    type: "income",
    amount: 3000000,
    date: `${y}-${m}-05`,
  }),
  tx({
    id: "4",
    type: "expense",
    amount: 500000,
    date: `${y}-${m}-10`,
  }),
  tx({
    id: "5",
    type: "income",
    amount: 1000000,
    date: `${y}-01-15`,
  }),
];

// ── Tests ──

describe("calcStats", () => {
  it("calculates income, expense, and balance correctly", () => {
    const result = calcStats(sampleTransactions);
    expect(result.income).toBe(9000000); // 5M + 3M + 1M
    expect(result.expense).toBe(1500000); // 1M + 500K
    expect(result.balance).toBe(7500000);
  });

  it("returns all zeros for empty array", () => {
    const result = calcStats([]);
    expect(result).toEqual({ income: 0, expense: 0, balance: 0 });
  });

  it("handles all income, no expense", () => {
    const result = calcStats([
      tx({ id: "a", type: "income", amount: 100, date: today }),
      tx({ id: "b", type: "income", amount: 200, date: today }),
    ]);
    expect(result.income).toBe(300);
    expect(result.expense).toBe(0);
    expect(result.balance).toBe(300);
  });

  it("handles all expense, no income (negative balance)", () => {
    const result = calcStats([
      tx({ id: "a", type: "expense", amount: 500, date: today }),
    ]);
    expect(result.income).toBe(0);
    expect(result.expense).toBe(500);
    expect(result.balance).toBe(-500);
  });
});

describe("filterByPeriod", () => {
  it('"all" returns every transaction', () => {
    const filtered = filterByPeriod(sampleTransactions, "all", now);
    expect(filtered.length).toBe(sampleTransactions.length);
  });

  it('"month" returns only current-month transactions', () => {
    const filtered = filterByPeriod(sampleTransactions, "month", now);
    // Today + 5th + 10th of current month = 4 txs (ids 1-4)
    // id 5 is from January
    expect(filtered.length).toBe(4);
    expect(filtered.every((tx) => {
      const d = parseISO(tx.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })).toBe(true);
  });

  it('"year" returns only current-year transactions', () => {
    const filtered = filterByPeriod(sampleTransactions, "year", now);
    // All 5 transactions are in current year
    expect(filtered.length).toBe(5);
  });

  it('"today" returns only today\'s transactions', () => {
    const filtered = filterByPeriod(sampleTransactions, "today", now);
    expect(filtered.length).toBe(2); // ids 1 and 2
    expect(filtered.every((tx) => tx.date === today)).toBe(true);
  });

  it("returns empty array when no transactions match", () => {
    const futureTx = [tx({ id: "f", type: "income", amount: 100, date: "2099-12-31" })];
    const filtered = filterByPeriod(futureTx, "today", now);
    expect(filtered.length).toBe(0);
  });
});
