"use node";

/**
 * Layanan Bantuan (CS) — "Hubungi CS" di website.
 *
 * Alur:
 * 1. Customer menulis pesan/laporan di panel Hubungi CS.
 * 2. Pesan disimpan, lalu dijawab otomatis oleh asisten AI (OpenAI) berdasarkan
 *    pengetahuan toko di SYSTEM_PROMPT.
 * 3. Kalau customer minta admin, atau tulisannya berupa keluhan, atau AI tidak
 *    bisa dipakai (kunci belum diisi / error), percakapan otomatis dialihkan ke
 *    ADMIN (mode "human") dan berhenti dijawab AI.
 * 4. Owner/CS membalas dari Panel Admin → tab "Bantuan CS".
 *
 * Catatan: file ini memakai "use node" (untuk memanggil OpenAI), jadi Convex
 * HANYA mengizinkan action di sini. Fungsi database-nya ada di `supportDb.ts`.
 *
 * Kunci API dibaca dari environment backend (BUKAN dari browser):
 *   OPENAI_API_KEY  -> wajib untuk balasan AI
 *   OPENAI_MODEL    -> opsional, default "gpt-4o-mini"
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

// Cast ke any: generated api/internal memuat modul ini sendiri -> inferensi
// tipe melingkar. Objek referensi tetap valid saat runtime.
const I = internal as any;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
/** Timeout OpenAI harus lebih kecil dari timeout klien (25 detik). */
const OPENAI_TIMEOUT_MS = 18_000;
const MAX_BODY = 1000;
/** Jumlah pesan terakhir yang dikirim sebagai konteks ke AI. */
const HISTORY_LIMIT = 14;

/** Pengetahuan toko yang dipakai asisten AI. */
const SYSTEM_PROMPT = `Kamu adalah CS (customer service) ramah untuk KAKO NOKOS, toko nomor virtual online di Indonesia.
Tugasmu: menjawab pertanyaan customer dengan singkat, jelas, dan sopan (maksimal 4 kalimat), pakai bahasa Indonesia santai.

CARA PAKAI TOKO:
1. Daftar akun pakai email + password, lalu login.
2. Isi Saldo: pilih nominal, lalu bayar via QRIS otomatis (saldo masuk otomatis setelah dibayar) ATAU via isi manual (QR/transfer bank/e-wallet) yang dikonfirmasi admin/CS.
3. Beli nomor: pilih server, lalu negara, lalu layanan (mis. WhatsApp, Telegram) lalu tekan Beli. Saldo otomatis terpotong.
4. Nomor muncul otomatis setelah pembelian, dan kode OTP muncul otomatis di halaman saat sudah masuk.
5. Ada 4 pilihan server (Server v1 sampai Server v4). Kalau stok di satu server habis, coba server lain.

ATURAN PENTING:
- Harga yang tampil adalah harga final (tidak ada biaya tambahan). Harga bisa berbeda antar server karena sumber stoknya berbeda.
- Pembatalan/refund: bisa dilakukan minimal 2 menit setelah pembelian dari menu Riwayat. TIDAK bisa dibatalkan kalau kode OTP sudah masuk. Kalau pembelian gagal, saldo otomatis dikembalikan.
- Kalau negara/layanan yang dicari tidak ada, saran: coba server lain atau layanan lain.
- Jangan pernah menyebut nama perusahaan pemasok/server internal. Sebut saja "Server v1" sampai "Server v4".
- JANGAN pernah meminta password, OTP, atau data sensitif customer. Jangan menjanjikan bonus/uang/saldo gratis.
- Jangan mengarang harga, stok, atau kebijakan yang tidak ada di sini.
- Kalau pertanyaan butuh pengecekan akun/transaksi (mis. saldo tidak masuk, OTP tidak masuk, dana hilang), jawab singkat lalu sarankan: "tulis 'admin' supaya saya sambungkan ke admin/CS kami".`;

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

const HUMAN_MESSAGE =
  "Baik, saya sambungkan ke admin/CS kami ya 🙏\nTulis detailnya di chat ini (sertakan nomor order kalau ada), admin akan balas di halaman ini juga.";

function wantsHuman(text: string): boolean {
  const s = (text || "").toLowerCase();
  return ESCALATE_WORDS.some((w) => s.includes(w));
}

/** Tanya asisten AI (OpenAI). Mengembalikan pesan error yang jelas kalau gagal. */
async function askOpenAi(
  history: Array<{ role: string; content: string }>
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) return { ok: false, error: "OPENAI_API_KEY belum diatur." };
  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: (process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        temperature: 0.3,
        max_tokens: 350,
      }),
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: `OpenAI HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "Balasan AI kosong." };
    return { ok: true, text: String(content).trim().slice(0, 1500) };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err).slice(0, 200) };
  }
}

/* =====================================================================
 * Bagian customer
 * ===================================================================== */

/** Kirim pesan ke CS. Dijawab otomatis oleh AI, atau dialihkan ke admin. */
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

    // Sudah ditangani admin -> tidak dijawab AI lagi, cukup tunggu admin.
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

    // Bangun konteks percakapan untuk AI.
    const history = await ctx.runQuery(I.supportDb.messagesOf, { threadId, limit: HISTORY_LIMIT });
    const messages = (history as any[])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: String(m.body) }));

    const answer = await askOpenAi(messages);
    if (!answer.ok || !answer.text) {
      // AI tidak bisa dipakai -> jangan biarkan customer menunggu tanpa jawaban.
      await ctx.runMutation(I.supportDb.addMessage, {
        threadId,
        role: "assistant",
        body: `Maaf, asisten otomatis sedang tidak bisa dipakai 🙏\n${HUMAN_MESSAGE}`,
        countForUser: true,
        mode: "human",
      });
      return { ok: false, error: answer.error || "Asisten AI gagal menjawab.", mode: "human" };
    }

    await ctx.runMutation(I.supportDb.addMessage, {
      threadId,
      role: "assistant",
      body: answer.text,
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
      // Setelah admin turun tangan, AI berhenti menjawab otomatis.
      mode: "human",
    });
    return { ok: true };
  },
});

/** Ubah status percakapan: aktifkan AI lagi, alihkan ke admin, atau tutup. */
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

/** Status asisten AI (untuk info di Panel Admin). */
export const staffAiStatus = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await requireStaff(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner/CS." };
    const key = (process.env.OPENAI_API_KEY || "").trim();
    return {
      ok: true,
      aiEnabled: Boolean(key),
      model: (process.env.OPENAI_MODEL || "gpt-4o-mini").trim(),
    };
  },
});
