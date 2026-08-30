import { describe, it, expect } from "vitest";

// ── Extracted data transformation from exportToCSV (DOM parts excluded) ──

interface Tx {
  id: string;
  type: "income" | "expense";
  amount: number;
  date: string;
  category: string;
  description: string;
}

function buildCsvRows(transactions: Tx[]) {
  const headers = ["Tanggal", "Deskripsi", "Jenis", "Kategori", "Jumlah"];

  const rows = transactions.map((tx) => [
    tx.date, // date-fns format skipped for testability
    tx.description,
    tx.type === "income" ? "Pemasukan" : "Pengeluaran",
    tx.category,
    `${tx.type === "income" ? "+" : "-"}${tx.amount}`,
  ]);

  const totalIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const balance = totalIncome - totalExpense;

  rows.push([]);
  rows.push(["", "", "", "Total Pemasukan", `+${totalIncome}`]);
  rows.push(["", "", "", "Total Pengeluaran", `-${totalExpense}`]);
  rows.push(["", "", "", "Saldo Bersih", `${balance >= 0 ? "+" : ""}${balance}`]);

  return { headers, rows, totalIncome, totalExpense, balance };
}

function escapeCell(cell: string) {
  return `"${String(cell).replace(/"/g, '""')}"`;
}

function toCsvString(headers: string[], rows: (string | number)[][]) {
  return [headers, ...rows]
    .map((row) => row.map((cell) => escapeCell(String(cell))).join(","))
    .join("\n");
}

// ── Fixtures ──

const sampleTx: Tx[] = [
  { id: "1", type: "income", amount: 5000000, date: "01/08/2026", category: "Gaji", description: "Gaji bulanan" },
  { id: "2", type: "expense", amount: 1000000, date: "05/08/2026", category: "Makanan", description: "Makan siang" },
  { id: "3", type: "income", amount: 2000000, date: "10/08/2026", category: "Freelance", description: "Proyek desain" },
];

// ── Tests ──

describe("CSV export data transformation", () => {
  it("generates correct headers", () => {
    const { headers } = buildCsvRows(sampleTx);
    expect(headers).toEqual(["Tanggal", "Deskripsi", "Jenis", "Kategori", "Jumlah"]);
  });

  it("converts income rows correctly", () => {
    const { rows } = buildCsvRows(sampleTx);
    const incomeRow = rows[0];
    expect(incomeRow[2]).toBe("Pemasukan");
    expect(incomeRow[4]).toBe("+5000000");
  });

  it("converts expense rows correctly", () => {
    const { rows } = buildCsvRows(sampleTx);
    const expenseRow = rows[1];
    expect(expenseRow[2]).toBe("Pengeluaran");
    expect(expenseRow[4]).toBe("-1000000");
  });

  it("calculates summary totals correctly", () => {
    const { totalIncome, totalExpense, balance } = buildCsvRows(sampleTx);
    expect(totalIncome).toBe(7000000); // 5M + 2M
    expect(totalExpense).toBe(1000000);
    expect(balance).toBe(6000000);
  });

  it("summary rows are appended after data", () => {
    const { rows } = buildCsvRows(sampleTx);
    // 3 data rows + 1 empty + 3 summary = 7 total
    expect(rows.length).toBe(7);
    expect(rows[3]).toEqual([]);
    expect(rows[4][3]).toBe("Total Pemasukan");
    expect(rows[5][3]).toBe("Total Pengeluaran");
  });

  it("handles empty transactions", () => {
    const { rows, totalIncome, totalExpense, balance } = buildCsvRows([]);
    // 0 data + 1 empty + 3 summary = 4
    expect(rows.length).toBe(4);
    expect(totalIncome).toBe(0);
    expect(totalExpense).toBe(0);
    expect(balance).toBe(0);
  });

  it("escapes double quotes in cell values", () => {
    const txWithQuotes: Tx[] = [
      { id: "1", type: "income", amount: 100, date: "01/01/2026", category: "Lain", description: 'He said "hello"' },
    ];
    const { headers, rows } = buildCsvRows(txWithQuotes);
    const csv = toCsvString(headers, rows);
    expect(csv).toContain('"He said ""hello"""');
  });

  it("negative balance shows correct sign", () => {
    const bigExpense: Tx[] = [
      { id: "1", type: "expense", amount: 5000, date: "01/01/2026", category: "Belanja", description: "Beli" },
    ];
    const { balance } = buildCsvRows(bigExpense);
    expect(balance).toBe(-5000);
  });
});
