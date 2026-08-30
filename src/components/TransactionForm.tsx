import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, Check, Camera, X, ImagePlus } from "lucide-react";
import { useData, useTheme } from "@/contexts/AppContext";
import type { Transaction } from "@/lib/types";
import Button from "@/components/ui/Button";

const CATEGORIES = ["Gaji", "Freelance", "Investasi", "Makanan", "Transportasi", "Belanja", "Tagihan", "Hiburan", "Kesehatan", "Pendidikan", "Lainnya"];

interface Props {
  editingTx: Transaction | null;
  onCancel: () => void;
}

export default function TransactionForm({ editingTx, onCancel }: Props) {
  const { addTransaction, updateTransaction } = useData();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<"income" | "expense">(editingTx?.type || "expense");
  const [description, setDescription] = useState(editingTx?.description || "");
  const [amount, setAmount] = useState(editingTx ? String(editingTx.amount) : "");
  const [category, setCategory] = useState(editingTx?.category || "Lainnya");
  const [date, setDate] = useState(editingTx?.date || new Date().toISOString().split("T")[0]);
  const [image, setImage] = useState<string | undefined>(editingTx?.image);
  const [showSuccess, setShowSuccess] = useState(false);

  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Compress and resize image to save localStorage space
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 1024;
        let w = img.width;
        let h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = (h / w) * maxSize; w = maxSize; }
          else { w = (w / h) * maxSize; h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          setImage(canvas.toDataURL("image/jpeg", 0.92));
        }
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numAmount = parseFloat(amount);
    if (!description.trim() || isNaN(numAmount) || numAmount <= 0) return;

    if (editingTx) {
      updateTransaction(editingTx.id, { type, description: description.trim(), amount: numAmount, category, date, image });
    } else {
      addTransaction({ type, description: description.trim(), amount: numAmount, category, date, image });
    }
    setShowSuccess(true);
    setTimeout(() => {
      setShowSuccess(false);
      onCancel();
    }, 800);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-5 pt-5 pb-8 space-y-4">

      <h2 className={`text-[22px] font-bold ${textPrimary}`}>
        {editingTx ? "Edit Transaksi" : "Tambah Transaksi"}
      </h2>

      {/* Type Toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setType("income")}
          className={`flex items-center justify-center gap-2 py-3.5 rounded-xl text-[14px] font-semibold transition-all cursor-pointer border
            ${type === "income"
              ? "bg-emerald-500 text-white border-emerald-500 shadow-lg shadow-emerald-500/20"
              : isDark ? "bg-zinc-900 text-zinc-400 border-white/[0.06] hover:border-emerald-500/30" : "bg-white text-zinc-500 border-zinc-200 hover:border-emerald-300"
            }`}>
          <ArrowUpRight className="w-4 h-4" />Pemasukan
        </button>
        <button type="button" onClick={() => setType("expense")}
          className={`flex items-center justify-center gap-2 py-3.5 rounded-xl text-[14px] font-semibold transition-all cursor-pointer border
            ${type === "expense"
              ? "bg-red-500 text-white border-red-500 shadow-lg shadow-red-500/20"
              : isDark ? "bg-zinc-900 text-zinc-400 border-white/[0.06] hover:border-red-500/30" : "bg-white text-zinc-500 border-zinc-200 hover:border-red-300"
            }`}>
          <ArrowDownRight className="w-4 h-4" />Pengeluaran
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Description */}
        <div className={`rounded-xl border p-3.5 ${card}`}>
          <label className={`block text-[12px] font-medium mb-1.5 ${textSecondary}`}>Deskripsi</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Contoh: Gaji bulanan" required
            className={`w-full bg-transparent text-[15px] font-medium outline-none ${isDark ? "text-white placeholder:text-zinc-500" : "text-zinc-900 placeholder:text-zinc-400"}`} />
        </div>

        {/* Amount */}
        <div className={`rounded-xl border p-3.5 ${card}`}>
          <label className={`block text-[12px] font-medium mb-1.5 ${textSecondary}`}>Jumlah (Rp)</label>
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0" min="0" step="any" required
            className={`w-full bg-transparent text-[22px] font-bold outline-none tabular-nums
              ${isDark ? "text-white placeholder:text-zinc-500" : "text-zinc-900 placeholder:text-zinc-400"}`} />
        </div>

        {/* Category */}
        <div className={`rounded-xl border p-3.5 ${card}`}>
          <label className={`block text-[12px] font-medium mb-2 ${textSecondary}`}>Kategori</label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((cat) => (
              <button key={cat} type="button" onClick={() => setCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer border
                  ${category === cat
                    ? "bg-emerald-500 text-white border-emerald-500"
                    : isDark ? "bg-white/[0.04] text-zinc-400 border-white/[0.08] hover:border-emerald-500/30" : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:border-emerald-300"
                  }`}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Date */}
        <div className={`rounded-xl border p-3.5 ${card}`}>
          <label className={`block text-[12px] font-medium mb-1.5 ${textSecondary}`}>Tanggal</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
            className={`w-full bg-transparent text-[15px] font-medium outline-none ${textPrimary}`} />
        </div>

        {/* Image Upload */}
        <div className={`rounded-xl border p-3.5 ${card}`}>
          <label className={`block text-[12px] font-medium mb-2 ${textSecondary}`}>Foto Struk (Opsional)</label>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          
          {image ? (
            <div className="relative">
              <img src={image} alt="Struk" className="w-full h-40 object-cover rounded-xl" />
              <button type="button" onClick={() => setImage(undefined)}
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center cursor-pointer">
                <X className="w-4 h-4 text-white" />
              </button>
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-2 right-2 px-3 py-1.5 rounded-lg bg-black/60 text-white text-[12px] font-medium cursor-pointer flex items-center gap-1">
                <Camera className="w-3.5 h-3.5" /> Ganti
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className={`w-full flex items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                isDark ? "border-white/[0.08] hover:border-emerald-500/30 text-zinc-500" : "border-zinc-200 hover:border-emerald-300 text-zinc-400"
              }`}>
              <ImagePlus className="w-6 h-6" />
              <span className="text-[13px] font-medium">Pilih Foto dari Galeri</span>
            </button>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <Button type="submit" className="flex-1" size="lg">
            {showSuccess ? <><Check className="w-4 h-4 mr-1" /> Tersimpan!</> : editingTx ? "Simpan Perubahan" : "Tambah Transaksi"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel} size="lg">Batal</Button>
        </div>
      </form>
    </motion.div>
  );
}
