import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Image, X, Download, Calendar, Tag, ZoomIn } from "lucide-react";
import { format, parseISO } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { useData, useTheme } from "@/contexts/AppContext";
import { formatCurrency } from "@/lib/utils";

export default function GalleryPage() {
  const { transactions } = useData();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [selectedImage, setSelectedImage] = useState<{ src: string; tx: typeof transactions[0] } | null>(null);
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");

  const imagesWithTx = useMemo(() => {
    return transactions
      .filter((tx) => tx.image)
      .filter((tx) => filter === "all" || tx.type === filter)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [transactions, filter]);

  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";
  const textMuted = isDark ? "text-zinc-500" : "text-zinc-400";

  const totalImages = transactions.filter((t) => t.image).length;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-5 pt-5 pb-8 space-y-4">

      {/* Header */}
      <div>
        <h1 className={`text-[22px] font-bold tracking-tight ${textPrimary}`}>Galeri</h1>
        <p className={`text-[13px] mt-0.5 ${textSecondary}`}>
          {totalImages > 0 ? `${totalImages} foto bukti transaksi` : "Belum ada foto"}
        </p>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {[
          { id: "all" as const, label: "Semua" },
          { id: "income" as const, label: "Pemasukan" },
          { id: "expense" as const, label: "Pengeluaran" },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setFilter(tab.id)}
            className={`px-4 py-2 rounded-xl text-[13px] font-medium transition-all cursor-pointer ${
              filter === tab.id
                ? tab.id === "income" ? "bg-emerald-500 text-white"
                  : tab.id === "expense" ? "bg-red-500 text-white"
                  : isDark ? "bg-white text-zinc-900" : "bg-zinc-900 text-white"
                : isDark ? "bg-white/[0.04] text-zinc-400 border border-white/[0.06]" : "bg-zinc-50 text-zinc-500 border border-zinc-200"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Gallery Grid */}
      {imagesWithTx.length === 0 ? (
        <div className={`text-center py-16 rounded-2xl border ${card}`}>
          <Image className={`w-12 h-12 mx-auto mb-3 ${textMuted}`} />
          <p className={`text-[14px] font-medium ${textPrimary}`}>
            {totalImages === 0 ? "Belum ada foto bukti" : "Tidak ada foto di filter ini"}
          </p>
          <p className={`text-[13px] mt-1 ${textSecondary}`}>
            {totalImages === 0 ? "Foto bukti akan muncul saat kamu upload struk di transaksi" : "Coba ganti filter"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2.5">
          {imagesWithTx.map((tx) => (
            <motion.button
              key={tx.id}
              whileTap={{ scale: 0.97 }}
              onClick={() => setSelectedImage({ src: tx.image!, tx })}
              className={`relative group rounded-2xl border overflow-hidden cursor-pointer ${card}`}
            >
              <div className="aspect-square">
                <img src={tx.image} alt={tx.description}
                  className="w-full h-full object-cover" loading="lazy" />
              </div>
              {/* Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2.5">
                <p className="text-white text-[12px] font-semibold truncate">{tx.description}</p>
                <p className="text-white/70 text-[10px]">
                  {format(parseISO(tx.date), "dd MMM yyyy", { locale: idLocale })}
                </p>
              </div>
              {/* Type badge */}
              <div className={`absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-semibold ${
                tx.type === "income" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
              }`}>
                {tx.type === "income" ? "+" : "-"}
              </div>
              {/* Zoom icon */}
              <div className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="w-3.5 h-3.5 text-white" />
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {selectedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex flex-col"
            onClick={() => setSelectedImage(null)}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3">
              <div className="min-w-0">
                <p className="text-white text-[14px] font-semibold truncate">{selectedImage.tx.description}</p>
                <p className="text-zinc-400 text-[12px]">
                  {format(parseISO(selectedImage.tx.date), "dd MMMM yyyy", { locale: idLocale })}
                </p>
              </div>
              <button onClick={() => setSelectedImage(null)}
                className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            {/* Image */}
            <div className="flex-1 flex items-center justify-center px-4 pb-4" onClick={(e) => e.stopPropagation()}>
              <img src={selectedImage.src} alt={selectedImage.tx.description}
                className="max-w-full max-h-full object-contain rounded-xl" />
            </div>

            {/* Info */}
            <div className="px-4 py-4 space-y-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-3">
                <div className={`px-3 py-1.5 rounded-xl text-[13px] font-semibold ${
                  selectedImage.tx.type === "income" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                }`}>
                  {selectedImage.tx.type === "income" ? "Pemasukan" : "Pengeluaran"}
                </div>
                <span className={`text-[18px] font-bold ${
                  selectedImage.tx.type === "income" ? "text-emerald-400" : "text-red-400"
                }`}>
                  {selectedImage.tx.type === "income" ? "+" : "-"}{formatCurrency(selectedImage.tx.amount)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-zinc-400 text-[12px]">{selectedImage.tx.category}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
