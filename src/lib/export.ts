import type { Transaction } from "./types";
import { format, parseISO } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { formatCurrency } from "./utils";

export function exportToCSV(transactions: Transaction[], filename?: string) {
  const headers = ["Tanggal", "Deskripsi", "Jenis", "Kategori", "Jumlah"];

  const rows = transactions.map((tx) => [
    format(parseISO(tx.date), "dd/MM/yyyy", { locale: idLocale }),
    tx.description,
    tx.type === "income" ? "Pemasukan" : "Pengeluaran",
    tx.category,
    `${tx.type === "income" ? "+" : "-"}${tx.amount}`,
  ]);

  // Calculate totals
  const totalIncome = transactions
    .filter((t) => t.type === "income")
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = transactions
    .filter((t) => t.type === "expense")
    .reduce((s, t) => s + t.amount, 0);
  const balance = totalIncome - totalExpense;

  // Add summary rows
  rows.push([]);
  rows.push(["", "", "", "Total Pemasukan", `+${totalIncome}`]);
  rows.push(["", "", "", "Total Pengeluaran", `-${totalExpense}`]);
  rows.push(["", "", "", "Saldo Bersih", `${balance >= 0 ? "+" : ""}${balance}`]);

  const csvContent = [headers, ...rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || `laporan-keuangan-${format(new Date(), "yyyy-MM-dd")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
