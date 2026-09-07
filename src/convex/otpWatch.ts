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

type P = { key: string; label: string; baseEnv: string; def: string; auth: "header" | "query" };

const PROVIDERS: Record<string, P> = {
  kirimkode: {
    key: "NOKOS_KIRIMKODE_API_KEY",
    label: "KirimKode",
    baseEnv: "NOKOS_KIRIMKODE_API_URL",
    def: KIRIMKODE_BASE_DEFAULT,
    auth: "header",
  },
  ditznesia: {
    key: "NOKOS_DITZNESIA_API_KEY",
    label: "Ditznesia",
    baseEnv: "NOKOS_DITZNESIA_API_URL",
    def: DITZNESIA_BASE_DEFAULT,
    auth: "query",
  },
  ditznesia_v2: {
    key: "NOKOS_DITZNESIA_API2_KEY",
    label: "Ditznesia API v2",
    baseEnv: "NOKOS_DITZNESIA_API2_URL",
    def: DITZNESIA2_BASE_DEFAULT,
    auth: "query",
  },
};

function providerCfg(provider: string): (P & { apiKey: string; base: string }) | null {
  const p = PROVIDERS[provider];
  if (!p) return null;
  const apiKey = envKey(p.key);
  const base = (process.env[p.baseEnv] || p.def).trim().replace(/\/+$/, "");
  if (!apiKey || !base) return null;
  return { ...p, apiKey, base };
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
async function fetchOtp(cfg: P & { apiKey: string; base: string }, orderId: string): Promise<string | null> {
  const id = encodeURIComponent(orderId);
  const path = cfg.auth === "header" ? `/order/${id}/status` : `/sms.php?id=${id}&id_order=${id}`;
  const { url, headers } = withAuth(cfg, `${cfg.base}${path}`);
  const { ok, json } = await fetchJson(url, { headers });
  if (!ok) return null;
  const data = (json && json.data) || json || {};
  const code = data.code ?? data.otp ?? data.sms ?? null;
  if (code != null && String(code).trim() !== "") return String(code).trim().slice(0, 40);
  return null;
}

/** Batalkan order di provider (best-effort — kalau gagal tidak masalah, saldo customer tetap dikembalikan). */
async function cancelAtProvider(cfg: P & { apiKey: string; base: string }, orderId: string): Promise<void> {
  try {
    const id = encodeURIComponent(orderId);
    if (cfg.auth === "header") {
      const { url, headers } = withAuth(cfg, `${cfg.base}/order/${id}/cancel`);
      await fetchJson(url, { method: "POST", headers });
    } else {
      const { url } = withAuth(cfg, `${cfg.base}/cancel.php?id=${id}&id_order=${id}`);
      await fetchJson(url);
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
        if (last) {
          await ctx.runMutation(I.wallet.setOrderResult, {
            orderId: row.orderId,
            otp: last,
            status: "otp",
          });
          return { ok: true, reason: "otp-found-last" };
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
      const code = await fetchOtp(cfg, row.orderId);
      if (code) {
        await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, otp: code, status: "otp" });
        return { ok: true, reason: "otp-found" };
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
      const cfg = providerCfg(key);
      if (!cfg) {
        out.push({ key, label: PROVIDERS[key].label, configured: false, balance: null });
        continue;
      }
      try {
        const path = cfg.auth === "header" ? "/balance" : "/balance.php";
        const { url, headers } = withAuth(cfg, `${cfg.base}${path}`);
        const { ok, json, text } = await fetchJson(url, { headers });
        if (!ok) {
          out.push({ key, label: cfg.label, configured: true, balance: null, error: text?.slice(0, 160) || `HTTP gagal (${key})` });
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
