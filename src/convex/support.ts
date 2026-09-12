/**
 * Layanan Bantuan (CS) — tombol "Bantuan" di website.
 *
 * Alur:
 * 1. Customer menekan tombol bantuan (tombol ngambang kanan bawah).
 * 2. Ada 2 pilihan yang bisa dinyalakan/dimatikan Owner di Panel Admin →
 *    tab "Bantuan CS":
 *      a. Chat di website — pesan disimpan & dijawab OTOMATIS dengan balasan
 *         sederhana (cocok kata kunci, TANPA AI). Kalau customer minta admin
 *         atau tulisannya keluhan, percakapan dialihkan ke admin/CS.
 *      b. WhatsApp — customer diarahkan ke nomor WhatsApp milik Owner.
 * 3. Owner/CS membalas dari Panel Admin → tab "Bantuan CS".
 *
 * Pengaturan disimpan di nokosSettings (bisa juga dibaca action lain):
 *   supportConfig: { autoReply, contactEnabled, waNumber }
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// Cast ke any: generated api/internal memuat modul ini sendiri -> inferensi
// tipe melingkar. Objek referensi tetap valid saat runtime.
const I = internal as any;

const MAX_BODY = 1000;
const SETTINGS_KEY = "supportConfig";
/** Nomor WhatsApp bawaan (Owner bisa ganti kapan saja dari Panel Admin). */
const DEFAULT_WA = "12897540214";

type SupportConfig = {
  /** Balasan otomatis sederhana di chat website. */
  autoReply: boolean;
  /** Tampilkan pilihan WhatsApp untuk customer. */
  contactEnabled: boolean;
  /** Nomor WhatsApp (boleh pakai +, spasi, atau tanda hubung). */
  waNumber: string;
};

function normalizeConfig(raw: any): SupportConfig {
  return {
    autoReply: raw?.autoReply !== false,
    contactEnabled: raw?.contactEnabled !== false,
    waNumber: typeof raw?.waNumber === "string" ? raw.waNumber : DEFAULT_WA,
  };
}

function waLink(value: string): { url: string | null; number: string } {
  const digits = (value || "").replace(/[^0-9]/g, "");
  if (!digits) return { url: null, number: "" };
  return { url: `https://wa.me/${digits}`, number: `+${digits}` };
}

async function readConfig(ctx: any): Promise<SupportConfig> {
  const map = await ctx.runQuery(I.wallet.getSettings, {});
  return normalizeConfig(map?.[SETTINGS_KEY]);
}

/* =====================================================================
 * Balasan otomatis sederhana (tanpa AI) — cocok kata kunci
 * ===================================================================== */

const AUTO_REPLIES: Array<{ keys: string[]; answer: string }> = [
  {
    keys: ["harga", "berapa", "biaya", "tarif", "mahal", "murah"],
    answer:
      "Harga yang tampil di halaman sudah harga final (tidak ada biaya tambahan). Harga berbeda antar server karena sumber stoknya berbeda — pilih yang paling murah sesuai kebutuhanmu ya 🙏",
  },
  {
    keys: ["cara beli", "beli nomor", "cara pesan", "gimana beli", "bagaimana beli", "cara order", "cara pakai"],
    answer:
      "Cara beli nomornya: buka menu Beli Nomor → pilih server → pilih negara → pilih layanan (mis. WhatsApp) → tekan Beli. Saldo otomatis terpotong dan nomornya langsung muncul di halaman.",
  },
  {
    keys: ["isi saldo", "deposit", "top up", "topup", "tambah saldo", "saldo masuk"],
    answer:
      "Isi saldo: tekan tombol Isi Saldo → pilih nominal → bayar via QRIS otomatis (saldo masuk sendiri setelah dibayar) atau lewat metode manual (QR/transfer bank/e-wallet) yang dikonfirmasi admin. Kalau sudah bayar tapi saldo belum masuk, tulis \"admin\" ya.",
  },
  {
    keys: ["refund", "batal", "batalkan", "cancel", "pengembalian", "uang kembali"],
    answer:
      "Pembatalan/refund bisa dilakukan paling cepat 2 menit setelah pembelian, dari menu Riwayat. Kalau kode OTP sudah masuk, order TIDAK bisa dibatalkan/direfund. Kalau pembelian gagal, saldo otomatis dikembalikan.",
  },
  {
    keys: ["otp", "kode", "sms", "kode belum", "belum masuk", "tidak masuk", "gak masuk"],
    answer:
      "Kode OTP muncul otomatis di halaman Riwayat begitu masuk dari provider — cukup tunggu dan tekan \"Periksa OTP\". Kalau sudah lebih dari 10 menit belum masuk, tulis \"admin\" beserta nomor order supaya kami cek.",
  },
  {
    keys: ["server", "v1", "v2", "v3", "v4", "stok", "habis"],
    answer:
      "Ada 4 server: Server v1 (pilihan terlengkap, paling banyak negara & layanan) dan Server v2–v4 sebagai cadangan. Kalau stok di satu server habis atau gagal, coba server lain ya.",
  },
  {
    keys: ["daftar", "akun", "login", "password", "lupa", "masuk"],
    answer:
      "Akun dibuat dengan email + password. Kalau lupa password, tulis \"admin\" dengan email akunmu, nanti admin bantu reset. Jangan pernah bagikan password ke siapa pun, termasuk ke kami 🙏",
  },
  {
    keys: ["promo", "voucher", "kode promo", "diskon"],
    answer:
      "Kode promo bisa dimasukkan di menu Kode Promo pada halaman akun. Kalau kodemu tidak bisa dipakai, tulis \"admin\" ya.",
  },
  {
    keys: ["wa", "whatsapp", "telegram", "kontak", "hubungi"],
    answer:
      "Kamu bisa lanjut lewat WhatsApp lewat menu Bantuan di halaman ini, atau tulis \"admin\" supaya saya sambungkan ke admin/CS kami.",
  },
];

const FALLBACK_ANSWER =
  "Terima kasih, pesanmu sudah kami terima 🙏\nKalau pertanyaannya soal saldo, OTP, atau transaksi tertentu, tulis \"admin\" supaya saya sambungkan ke admin/CS kami — sertakan nomor ordernya ya.";

const HUMAN_MESSAGE =
  "Baik, saya sambungkan ke admin/CS kami ya 🙏\nTulis detailnya di chat ini (sertakan nomor order kalau ada), admin akan balas di halaman ini juga.";

const WAITING_MESSAGE =
  "Pesanmu sudah masuk ke admin/CS kami 🙏\nBalasannya muncul di halaman ini juga. Sambil menunggu, kamu bisa lanjut lewat WhatsApp di menu Bantuan.";

/** Kata kunci yang membuat percakapan langsung dialihkan ke admin manusia. */
const ESCALATE_WORDS = [
  "admin",
  "cs",
  "customer service",
  "manusia",
  "orang asli",
  "orangnya",
  "komplain",
  "keluhan",
  "lapor",
  "penipuan",
  "ditipu",
  "tipu",
  "kecewa",
  "belum masuk",
  "tidak masuk",
  "gak masuk",
  "ga masuk",
  "belum dikirim",
  "tidak dikirim",
  "gagal terus",
  "uang saya",
  "saldo hilang",
];

function wantsHuman(text: string): boolean {
  const s = (text || "").toLowerCase();
  return ESCALATE_WORDS.some((w) => s.includes(w));
}

function autoAnswer(text: string): string {
  const s = (text || "").toLowerCase();
  for (const item of AUTO_REPLIES) {
    if (item.keys.some((k) => s.includes(k))) return item.answer;
  }
  return FALLBACK_ANSWER;
}

/* =====================================================================
 * Bagian customer
 * ===================================================================== */

/** Pengaturan bantuan untuk halaman customer (publik). */
export const publicConfig = action({
  args: {},
  handler: async (ctx) => {
    const cfg = await readConfig(ctx);
    const wa = waLink(cfg.waNumber);
    return {
      ok: true,
      autoReply: cfg.autoReply,
      contactEnabled: cfg.contactEnabled,
      // Kontak ditutup -> jangan kirim tautannya ke browser sama sekali.
      waUrl: cfg.contactEnabled ? wa.url : null,
    };
  },
});

/** Kirim pesan ke CS. Dijawab balasan otomatis sederhana, atau dialihkan ke admin. */
export const sendMessage = action({
  args: { userId: v.id("appUsers"), body: v.string() },
  handler: async (ctx, args) => {
    const body = (args.body || "").trim().slice(0, MAX_BODY);
    if (!body) return { ok: false, error: "Pesan masih kosong." };

    const me = await ctx.runQuery(I.wallet.actorInfo, { userId: args.userId });
    if (!me) return { ok: false, error: "Akun tidak ditemukan. Coba login ulang." };

    let thread = await ctx.runQuery(I.supportDb.threadOfUser, { userId: args.userId });
    if (!thread) {
      const threadId = await ctx.runMutation(I.supportDb.createThread, {
        userId: args.userId,
        userEmail: me.username,
        userName: me.fullName || me.username,
      });
      thread = { _id: threadId, mode: "ai" };
    }
    const threadId = thread._id;

    await ctx.runMutation(I.supportDb.addMessage, {
      threadId,
      role: "user",
      body,
      authorName: me.fullName || me.username,
      countForStaff: true,
    });

    // Sudah ditangani admin -> tidak dijawab otomatis lagi, cukup tunggu admin.
    if (thread.mode === "human") {
      return { ok: true, mode: "human" };
    }

    // Minta admin / keluhan -> alihkan ke admin.
    if (wantsHuman(body)) {
      await ctx.runMutation(I.supportDb.addMessage, {
        threadId,
        role: "assistant",
        body: HUMAN_MESSAGE,
        countForUser: true,
        mode: "human",
      });
      return { ok: true, mode: "human" };
    }

    // Balasan otomatis dimatikan Owner -> jangan biarkan customer menunggu tanpa kabar.
    const cfg = await readConfig(ctx);
    if (!cfg.autoReply) {
      await ctx.runMutation(I.supportDb.addMessage, {
        threadId,
        role: "assistant",
        body: WAITING_MESSAGE,
        countForUser: true,
        mode: "human",
      });
      return { ok: true, mode: "human" };
    }

    await ctx.runMutation(I.supportDb.addMessage, {
      threadId,
      role: "assistant",
      body: autoAnswer(body),
      countForUser: true,
    });
    return { ok: true, mode: "ai" };
  },
});

/** Ambil percakapan milik customer sendiri (sekaligus tandai sudah dibaca). */
export const myThread = action({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const thread = await ctx.runQuery(I.supportDb.threadOfUser, { userId: args.userId });
    if (!thread) return { ok: true, mode: "ai", messages: [] as any[] };
    const messages = await ctx.runQuery(I.supportDb.messagesOf, { threadId: thread._id, limit: 80 });
    await ctx.runMutation(I.supportDb.markThreadRead, { threadId: thread._id, forStaff: false });
    return { ok: true, mode: thread.mode, messages };
  },
});

/* =====================================================================
 * Bagian admin/CS
 * ===================================================================== */

async function requireStaff(ctx: any, actorId: string) {
  const actor = await ctx.runQuery(I.wallet.actorInfo, { userId: actorId });
  if (!actor || (actor.role !== "owner" && actor.role !== "cs")) return null;
  return actor;
}

/** Daftar semua percakapan (Owner & CS). */
export const staffThreads = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS.", threads: [] as any[] };
    const threads = await ctx.runQuery(I.supportDb.allThreads, {});
    const unread = (threads as any[]).reduce((n, t) => n + (t.unreadForStaff || 0), 0);
    return { ok: true, threads, unread };
  },
});

/** Isi satu percakapan + tandai sudah dibaca oleh staff. */
export const staffMessages = action({
  args: { actorId: v.id("appUsers"), threadId: v.id("supportThreads") },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS.", messages: [] as any[] };
    const messages = await ctx.runQuery(I.supportDb.messagesOf, { threadId: args.threadId, limit: 120 });
    await ctx.runMutation(I.supportDb.markThreadRead, { threadId: args.threadId, forStaff: true });
    return { ok: true, messages };
  },
});

/** Balas percakapan sebagai admin/CS. */
export const staffReply = action({
  args: { actorId: v.id("appUsers"), threadId: v.id("supportThreads"), body: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const body = (args.body || "").trim().slice(0, MAX_BODY);
    if (!body) return { ok: false, error: "Pesan masih kosong." };
    await ctx.runMutation(I.supportDb.addMessage, {
      threadId: args.threadId,
      role: "staff",
      body,
      authorName: actor.fullName || actor.username,
      countForUser: true,
      // Setelah admin turun tangan, balasan otomatis berhenti.
      mode: "human",
    });
    return { ok: true };
  },
});

/** Ubah status percakapan: balasan otomatis lagi, alihkan ke admin, atau tutup. */
export const staffSetMode = action({
  args: { actorId: v.id("appUsers"), threadId: v.id("supportThreads"), mode: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const mode = ["ai", "human", "closed"].includes(args.mode) ? args.mode : "human";
    await ctx.runMutation(I.supportDb.setThreadMode, { threadId: args.threadId, mode });
    return { ok: true, mode };
  },
});

/** Pengaturan bantuan (Owner) — dipakai tab "Bantuan CS" di Panel Admin. */
export const staffGetConfig = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const cfg = await readConfig(ctx);
    return { ok: true, config: cfg };
  },
});

/** Simpan pengaturan bantuan: balasan otomatis & nomor WhatsApp manual. */
export const staffSetConfig = action({
  args: {
    actorId: v.id("appUsers"),
    autoReply: v.boolean(),
    contactEnabled: v.boolean(),
    waNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const cfg: SupportConfig = {
      autoReply: !!args.autoReply,
      contactEnabled: !!args.contactEnabled,
      waNumber: (args.waNumber || "").trim().slice(0, 40),
    };
    await ctx.runMutation(I.wallet.setSettings, { key: SETTINGS_KEY, value: cfg });
    return { ok: true, config: cfg };
  },
});
