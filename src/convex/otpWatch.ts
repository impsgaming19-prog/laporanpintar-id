"use node";

/**
 * Modul latar-belakang toko KAKO NOKOS.
 *
 *  - #5  Cek OTP OTOMATIS: setelah order nomor berhasil dibuat, server
 *        mengecek ke provider setiap 20 detik sampai OTP masuk — jalan terus
 *        walau customer menutup halaman. Kalau sampai ±10 menit tidak ada
 *        OTP, server membatalkan order di provider (best-effort) dan
 *        mengembalikan saldo customer otomatis.
 *  - #6  Pengaturan fee Paymentku (untuk hitung untung bersih di panel).
 *  - #13 Monitor saldo provider (KirimKode / Ditznesia / Ditznesia v2).
 *
 * Dibuat terpisah dari shop.ts agar bisa dijadwalkan (internalAction) tanpa
 * memuat seluruh modul transaksi.
 */

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
// Cast ke any: generated api/internal ikut memuat modul ini sendiri sehingga
// inferensi tipe melingkar; referensi objek tetap valid saat runtime.
const I = internal as any;

const KIRIMKODE_BASE_DEFAULT = "https://api.kirimkode.com/v1";
const DITZNESIA_BASE_DEFAULT = "https://api.ditznesia.com/v1";
const DITZNESIA2_BASE_DEFAULT = "https://api.jasaotp.id/v2";

/** Interval cek OTP otomatis (20 detik) & batas percobaan (±10 menit). */
const POLL_DELAY_MS = 20_000;
const MAX_ATTEMPTS = 30;

function envKey(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

type P = {
  key: string;
  altKey?: string;
  label: string;
  baseEnv: string;
  def: string;
  auth: "header" | "query";
  /** Base URL cadangan (kalau host utama provider mati/DNS gagal). */
  fallbacks?: string[];
  /** Nama env berisi base cadangan tambahan, dipisah koma. */
  fallbackEnv?: string;
  /** Jangan tampilkan barisnya di monitor saldo Owner (alias provider lain). */
  hidden?: boolean;
};

const PROVIDERS: Record<string, P> = {
  kirimkode: {
    key: "NOKOS_KIRIMKODE_API_KEY",
    label: "KirimKode",
    baseEnv: "NOKOS_KIRIMKODE_API_URL",
    def: KIRIMKODE_BASE_DEFAULT,
    auth: "header",
  },
  // Server v2/v4 memakai kunci & host KirimKode yang sama, hanya urutan node
  // stoknya berbeda. Entri ini wajib ada supaya OTP order dari jalur itu tetap
  // terbaca, tapi tidak ditampilkan dua kali di monitor saldo Owner.
  kirimkode_alt: {
    key: "NOKOS_KIRIMKODE_API_KEY",
    label: "KirimKode (jalur alternatif)",
    baseEnv: "NOKOS_KIRIMKODE_API_URL",
    def: KIRIMKODE_BASE_DEFAULT,
    auth: "header",
    hidden: true,
  },
  ditznesia: {
    key: "NOKOS_DITZNESIA_API_KEY",
    // 1 kunci akun Ditznesia berlaku untuk API v1 (server 3) DAN v2 (server 4).
    altKey: "NOKOS_DITZNESIA_API2_KEY",
    label: "Ditznesia",
    baseEnv: "NOKOS_DITZNESIA_API_URL",
    def: DITZNESIA_BASE_DEFAULT,
    auth: "query",
  },
  ditznesia_v2: {
    key: "NOKOS_DITZNESIA_API2_KEY",
    altKey: "NOKOS_DITZNESIA_API_KEY",
    label: "Ditznesia API v2",
    baseEnv: "NOKOS_DITZNESIA_API2_URL",
    def: DITZNESIA2_BASE_DEFAULT,
    auth: "query",
    // Host API v2 (api.jasaotp.id) bisa mati total; order yang dibuat lewat
    // jalur cadangan juga harus dicek OTP-nya di host yang sama.
    fallbacks: [DITZNESIA_BASE_DEFAULT],
    fallbackEnv: "NOKOS_DITZNESIA_API2_FALLBACK",
  },
};

type ResolvedP = P & { apiKey: string; base: string; fallbackBases: string[] };

function providerCfg(provider: string): ResolvedP | null {
  const p = PROVIDERS[provider];
  if (!p) return null;
  // Kunci versi ini dulu; kalau kosong pakai kunci versi lainnya (satu akun = satu kunci).
  const apiKey = p.altKey ? envKey(p.key, p.altKey) : envKey(p.key);
  const base = (process.env[p.baseEnv] || p.def).trim().replace(/\/+$/, "");
  if (!apiKey || !base) return null;
  const extra = (process.env[p.fallbackEnv || ""] || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const fallbackBases = [
    ...new Set(
      [...extra, ...(p.fallbacks || [])]
        .map((b) => b.trim().replace(/\/+$/, ""))
        .filter((b) => b && b !== base)
    ),
  ];
  return { ...p, apiKey, base, fallbackBases };
}

/**
 * Coba host utama lalu host cadangan — supaya order yang dibuat saat host v2
 * mati tetap bisa dicek OTP-nya di host yang benar-benar dipakai.
 */
async function providerFetchAny(
  cfg: ResolvedP,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; json: any; text: string; base: string }> {
  let last = { ok: false, status: 0, json: null as any, text: "", base: cfg.base };
  for (const base of [cfg.base, ...cfg.fallbackBases]) {
    const { url, headers } = withAuth(cfg, `${base}${path}`);
    const merged: RequestInit = { ...(init || {}) };
    if (headers) merged.headers = { ...((init?.headers as Record<string, string>) || {}), ...headers };
    const res = await fetchJson(url, merged);
    last = { ...res, base };
    if (res.ok) return last;
    if (res.status !== 0 && res.status !== 404 && res.status < 500) return last;
  }
  return last;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  } catch (err: any) {
    return { ok: false, status: 0, json: null, text: String(err?.message || err) };
  }
  const text = await res.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* bukan JSON */
  }
  return { ok: res.ok, status: res.status, json, text };
}

function withAuth(cfg: P & { apiKey: string; base: string }, url: string): { url: string; headers?: Record<string, string> } {
  if (cfg.auth === "header") {
    return { url, headers: { "X-API-Key": cfg.apiKey } };
  }
  const sep = url.includes("?") ? "&" : "?";
  return { url: `${url}${sep}api_key=${encodeURIComponent(cfg.apiKey)}` };
}

/** Ambil OTP dari provider untuk satu id order (kirimkode: /order/{id}/status, ditznesia: /sms.php). */
async function fetchOtp(
  cfg: ResolvedP,
  orderId: string
): Promise<{ code: string | null; number: string | null }> {
  const id = encodeURIComponent(orderId);
  const path = cfg.auth === "header" ? `/order/${id}/status` : `/sms.php?id=${id}&id_order=${id}`;
  const { ok, json } = await providerFetchAny(cfg, path);
  if (!ok) return { code: null, number: null };
  const data = (json && json.data) || json || {};
  const code = data.code ?? data.otp ?? data.sms ?? null;
  const num =
    data.phone ??
    data.phone_number ??
    data.nohp ??
    data.number ??
    data.nomor ??
    data.mobile ??
    data.phoneNumber ??
    null;
  const number = num != null && String(num).trim() !== "" && String(num) !== "null" ? String(num).trim().slice(0, 40) : null;
  if (code != null && String(code).trim() !== "") return { code: String(code).trim().slice(0, 40), number };
  return { code: null, number };
}

/** Batalkan order di provider (best-effort — kalau gagal tidak masalah, saldo customer tetap dikembalikan). */
async function cancelAtProvider(cfg: ResolvedP, orderId: string): Promise<void> {
  try {
    const id = encodeURIComponent(orderId);
    if (cfg.auth === "header") {
      await providerFetchAny(cfg, `/order/${id}/cancel`, { method: "POST" });
    } else {
      await providerFetchAny(cfg, `/cancel.php?id=${id}&id_order=${id}`);
    }
  } catch {
    /* ignore */
  }
}

/**
 * #5 — Pekerjaan terjadwal: cek OTP order yang masih menunggu.
 * Dipanggil ulang sendiri lewat ctx.scheduler sampai OTP masuk atau waktu habis.
 */
export const watchOtp = internalAction({
  args: { orderId: v.string(), attempts: v.number() },
  handler: async (ctx, args) => {
    const row: any = await ctx.runQuery(I.wallet.orderByProviderId, { orderId: args.orderId }).catch(() => null);
    // Order hilang / sudah berstatus lain / OTP sudah tercatat → selesai.
    if (!row) return { ok: false, reason: "order-not-found" };
    if (row.otp || row.status === "otp") return { ok: true, reason: "otp-already" };
    if (row.status !== "ordered") return { ok: true, reason: `status-${row.status}` };

    // Waktu habis → coba cek sekali lagi, kalau tetap kosong: cancel + refund otomatis.
    if (args.attempts >= MAX_ATTEMPTS) {
      const cfg = providerCfg(row.provider);
      if (cfg) {
        const last = await fetchOtp(cfg, row.orderId);
        if (last && last.code) {
          await ctx.runMutation(I.wallet.setOrderResult, {
            orderId: row.orderId,
            otp: last.code,
            number: last.number || undefined,
            status: "otp",
          });
          return { ok: true, reason: "otp-found-last" };
        }
        if (last && last.number && !row.number) {
          await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, number: last.number });
        }
        await cancelAtProvider(cfg, row.orderId);
      }
      const refund = await ctx.runMutation(I.wallet.refundCharge, {
        userId: row.userId,
        amount: row.sellPrice,
      }).catch(() => ({ ok: false }));
      await ctx.runMutation(I.wallet.setOrderResult, {
        orderId: row.orderId,
        status: "refunded",
        error: "Waktu tunggu OTP habis (±10 menit) — saldo dikembalikan otomatis.",
      });
      return { ok: true, reason: "timeout-refunded", balance: refund.ok ? refund.balance : undefined };
    }

    const cfg = providerCfg(row.provider);
    if (cfg) {
      const live = await fetchOtp(cfg, row.orderId);
      if (live.code) {
        await ctx.runMutation(I.wallet.setOrderResult, {
          orderId: row.orderId,
          otp: live.code,
          number: live.number || undefined,
          status: "otp",
        });
        return { ok: true, reason: "otp-found" };
      }
      if (live.number && !row.number) {
        await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, number: live.number });
      }
    }

    // Belum ada OTP → jadwalkan pemeriksaan berikutnya.
    try {
      await ctx.scheduler.runAfter(POLL_DELAY_MS, I.otpWatch.watchOtp, {
        orderId: row.orderId,
        attempts: (args.attempts || 0) + 1,
      });
    } catch {
      /* jadwal gagal — cek berikutnya tidak dijalankan; tidak memblokir apa pun */
    }
    return { ok: true, reason: "rescheduled", attempt: args.attempts + 1 };
  },
});

/* =====================================================================
 * #6 — Pengaturan toko: fee Paymentku (untuk untung bersih di panel)
 * ===================================================================== */

/** Baca pengaturan publik toko (tanpa rahasia apa pun). */
export const getShopConfig = action({
  args: {},
  handler: async (ctx) => {
    const map = await ctx.runQuery(I.wallet.getSettings, {});
    const raw = Number(map["paymentFeePct"]);
    return {
      ok: true,
      feePct: Number.isFinite(raw) && raw > 0 ? raw : 0,
      siteName: typeof map["siteName"] === "string" && map["siteName"] ? map["siteName"] : "KAKO NOKOS",
    };
  },
});

/** Owner menyimpan fee Paymentku (persen dari nominal deposit, misal 0,7). */
export const setShopConfig = action({
  args: { actorId: v.id("appUsers"), feePct: v.number() },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(I.wallet.actorInfo, { userId: args.actorId });
    if (!actor || actor.role !== "owner") return { ok: false, error: "Khusus Owner." };
    const feePct = Math.min(10, Math.max(0, Number(args.feePct) || 0));
    await ctx.runMutation(I.wallet.setSettings, { key: "paymentFeePct", value: feePct });
    return { ok: true, feePct };
  },
});

/* =====================================================================
 * #13 — Monitor saldo provider (khusus Owner)
 * ===================================================================== */

/** Cek saldo di semua provider yang kuncinya sudah terisi. */
export const providerMonitor = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(I.wallet.actorInfo, { userId: args.actorId });
    if (!actor || actor.role !== "owner") return { ok: false, error: "Khusus Owner." };

    const out: Array<{ key: string; label: string; configured: boolean; balance: number | null; error?: string }> = [];
    for (const key of Object.keys(PROVIDERS)) {
      if (PROVIDERS[key].hidden) continue;
      const cfg = providerCfg(key);
      if (!cfg) {
        out.push({ key, label: PROVIDERS[key].label, configured: false, balance: null });
        continue;
      }
      try {
        const path = cfg.auth === "header" ? "/balance" : "/balance.php";
        const { ok, status, json, text } = await providerFetchAny(cfg, path);
        if (!ok) {
          const msg =
            status === 500 && cfg.auth !== "header"
              ? `${cfg.label}: endpoint saldo provider (balance.php) error HTTP 500 — bukan masalah kunci API. Cek saldo manual di dashboard provider.`
              : status === 0
                ? `${cfg.label}: host API tidak terjangkau (DNS/ jaringan) — termasuk jalur cadangan.`
                : text?.slice(0, 160) || `HTTP gagal (${key})`;
          out.push({ key, label: cfg.label, configured: true, balance: null, error: msg.slice(0, 200) });
          continue;
        }
        const data = (json && json.data) || json || {};
        const balance = Number(data.balance ?? data.saldo ?? data.saldo_akun);
        out.push({
          key,
          label: cfg.label,
          configured: true,
          balance: Number.isFinite(balance) ? Math.max(0, balance) : null,
        });
      } catch (err: any) {
        out.push({ key, label: cfg.label, configured: true, balance: null, error: String(err?.message || err).slice(0, 160) });
      }
    }
    return { ok: true, providers: out, checkedAt: Date.now() };
  },
});

/* =====================================================================
 * #2 — Kode promo / voucher saldo (dibuat Owner, ditukar customer)
 * Kode tersimpan di pengaturan toko (key "promoCodes") sebagai peta:
 *   { [KODE]: { nominal, kuota, used, createdAt } }
 * ===================================================================== */

type PromoEntry = { nominal: number; kuota: number; used: number; createdAt: number };

async function readPromos(ctx: any): Promise<Record<string, PromoEntry>> {
  const map = await ctx.runQuery(I.wallet.getSettings, {});
  const raw = map["promoCodes"];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, PromoEntry>;
  return {};
}

function makeVoucherReference(code: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
  return `VCH-${code}-${rand}`.toUpperCase();
}

/** Daftar kode promo (khusus Owner). */
export const promoList = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(I.wallet.actorInfo, { userId: args.actorId });
    if (!actor || actor.role !== "owner") return { ok: false, error: "Khusus Owner." };
    const promos = await readPromos(ctx);
    const list = Object.entries(promos)
      .map(([code, e]) => ({ code, ...e }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return { ok: true, promos: list };
  },
});

/** Owner membuat kode promo: kode + nominal saldo + kuota pemakaian. */
export const promoCreate = action({
  args: { actorId: v.id("appUsers"), code: v.string(), nominal: v.number(), kuota: v.number() },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(I.wallet.actorInfo, { userId: args.actorId });
    if (!actor || actor.role !== "owner") return { ok: false, error: "Khusus Owner." };
    const code = args.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 4 || code.length > 16) return { ok: false, error: "Kode 4–16 huruf/angka (tanpa spasi)." };
    const nominal = Math.floor(args.nominal);
    const kuota = Math.max(1, Math.floor(args.kuota));
    if (!Number.isFinite(nominal) || nominal < 1000) return { ok: false, error: "Nominal minimal Rp 1.000." };
    const promos = await readPromos(ctx);
    if (promos[code]) return { ok: false, error: `Kode ${code} sudah ada — pakai kode lain.` };
    if (Object.keys(promos).length >= 50) return { ok: false, error: "Maksimal 50 kode aktif. Hapus yang tidak terpakai dulu." };
    promos[code] = { nominal, kuota, used: 0, createdAt: Date.now() };
    await ctx.runMutation(I.wallet.setSettings, { key: "promoCodes", value: promos });
    return { ok: true, code };
  },
});

/** Owner menghapus kode promo. */
export const promoDelete = action({
  args: { actorId: v.id("appUsers"), code: v.string() },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(I.wallet.actorInfo, { userId: args.actorId });
    if (!actor || actor.role !== "owner") return { ok: false, error: "Khusus Owner." };
    const promos = await readPromos(ctx);
    const code = args.code.trim().toUpperCase();
    if (!promos[code]) return { ok: false, error: "Kode tidak ditemukan." };
    delete promos[code];
    await ctx.runMutation(I.wallet.setSettings, { key: "promoCodes", value: promos });
    return { ok: true };
  },
});

/** Cek kode promo valid (untuk preview di halaman, tanpa menukar). */
export const promoValidate = action({
  args: { code: v.string() },
  handler: async (ctx, args) => {
    const promos = await readPromos(ctx);
    const code = args.code.trim().toUpperCase();
    const e = promos[code];
    if (!e) return { ok: false, error: "Kode tidak ditemukan." };
    if (e.used >= e.kuota) return { ok: false, error: "Kode sudah habis dipakai (kuota terpenuhi)." };
    return { ok: true, code, nominal: e.nominal, kuota: e.kuota, used: e.used };
  },
});

/** Customer menukar kode promo -> saldo langsung masuk. */
export const promoRedeem = action({
  args: { userId: v.id("appUsers"), code: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(I.wallet.actorInfo, { userId: args.userId });
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    if (user.role !== "customer") return { ok: false, error: "Hanya akun customer yang bisa menukar kode." };
    const code = args.code.trim().toUpperCase();
    const promos = await readPromos(ctx);
    const e = promos[code];
    if (!e) return { ok: false, error: "Kode tidak ditemukan. Periksa lagi kodenya." };
    if (e.used >= e.kuota) return { ok: false, error: "Kode sudah habis dipakai (kuota terpenuhi)." };
    const res = await ctx.runMutation(I.wallet.applyVoucher, {
      userId: args.userId,
      code,
      amount: e.nominal,
      referenceId: makeVoucherReference(code),
    });
    if (!res.ok) return { ok: false, error: res.error || "Gagal menukar kode." };
    // Catat pemakaian kode (kuota berkurang 1).
    e.used += 1;
    promos[code] = e;
    await ctx.runMutation(I.wallet.setSettings, { key: "promoCodes", value: promos });
    return { ok: true, nominal: e.nominal, balance: res.balance };
  },
});

/** Info kode undangan & status bonus akun sendiri (untuk halaman customer). */
export const myReferral = action({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(I.wallet.actorInfo, { userId: args.userId });
    if (!actor) return { ok: false, error: "Akun tidak ditemukan." };
    if (actor.role !== "customer") return { ok: false, error: "Khusus customer." };
    const u: any = await ctx.runQuery(I.wallet.userDetail, { userId: args.userId });
    if (!u) return { ok: false, error: "Akun tidak ditemukan." };
    return {
      ok: true,
      refCode: u.refCode || "",
      referredBy: u.referredBy || "",
      referralBonusAt: u.referralBonusAt || null,
    };
  },
});
