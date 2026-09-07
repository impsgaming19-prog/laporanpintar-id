"use node";

/**
 * Backend toko KAKO NOKOS — jalan di Convex cloud.
 *
 * Alur bisnis (sesuai penjelasan owner):
 * 1. Customer deposit / beli nomor -> dibuatkan invoice Paymentku (QRIS only).
 *    Uang masuk ke akun Paymentku milik owner, BUKAN saldo toko.
 * 2. Nomor dipesan ke server provider memakai kunci API milik owner
 *    (KirimKode / Ditznesia / Ditznesia API v2). Saldo yang terpotong di
 *    provider adalah saldo owner di website provider tsb.
 * 3. Nomor + OTP dikembalikan ke customer lewat website.
 *
 * Kunci & URL dibaca dari environment (Keys/Environment project / Convex):
 *   PAYMENTKU_API_KEY | NOKOS_PAYMENTKU_API_KEY   -> Paymentku
 *   PAYMENTKU_API_URL                             -> default https://paymenku.com/api/v1
 *
 *   NOKOS_KIRIMKODE_API_KEY       -> KirimKode (header X-API-Key)
 *   NOKOS_KIRIMKODE_API_URL       -> default https://api.kirimkode.com/v1
 *   NOKOS_KIRIMKODE_SERVER        -> server di body order: api1 | api2 | api3 (default api1)
 *
 *   NOKOS_DITZNESIA_API_KEY       -> Ditznesia (param api_key)
 *   NOKOS_DITZNESIA_API_URL       -> default https://api.ditznesia.com/v1
 *
 *   NOKOS_DITZNESIA_API2_KEY      -> Ditznesia API v2
 *   NOKOS_DITZNESIA_API2_URL      -> default https://api.jasaotp.id/v2 (per docs resmi)
 *                                    Bisa di-override kalau domain tsb tidak aktif dari server.
 *
 * Format API sudah dicocokkan dengan dokumentasi resmi:
 *   - KirimKode : GET /balance, GET /countries, GET /services,
 *                 POST /order {server,country,service,operator},
 *                 GET /order/{id}/status, POST /order/{id}/cancel
 *                 Auth header: X-API-Key. Envelope: {code,success,message,data}.
 *   - Ditznesia v1 : GET .../balance.php?api_key=, .../negara.php,
 *                    .../operator.php?negara=, .../layanan.php?negara=,
 *                    .../order.php?negara=&layanan=&operator=, .../sms.php?id=,
 *                    .../cancel.php?id=
 *                    Auth param: api_key.
 *   - Ditznesia v2 : host & endpoint sama persis dengan v1 (negara/operator/
 *                    layanan/order/sms/cancel), beda base URL:
 *                    https://api.jasaotp.id/v2 (server 4) per docs resmi.
 *                    Catatan: domain tsb saat dicek tidak ter-resolve di DNS
 *                    global -> bila dari server juga gagal, isi env
 *                    NOKOS_DITZNESIA_API2_URL dengan base yang benar.
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
// Dipakai lintas modul. Di-cast ke any karena generated api/internal ikut
// memuat modul ini sendiri -> inferensi tipe melingkar (TS7022/TS7023).
// Objek referensi yang dikirim tetap sama saat runtime.
const I = internal as any;

const PAYMENTKU_BASE_DEFAULT = "https://paymenku.com/api/v1";
const KIRIMKODE_BASE_DEFAULT = "https://api.kirimkode.com/v1";
const DITZNESIA_BASE_DEFAULT = "https://api.ditznesia.com/v1";
// Sesuai docs resmi Ditznesia (ditznesia.com/api-v2): base v2 = https://api.jasaotp.id/v2
// Domain ini bisa saja tidak aktif di sebagian jaringan -> override via NOKOS_DITZNESIA_API2_URL.
const DITZNESIA2_BASE_DEFAULT = "https://api.jasaotp.id/v2";

function envKey(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

/** Server KirimKode yang dipakai akun (dari env, default api4 — server tempat
 *  stok layanan akun ini terbaca saat diuji langsung ke API). */
function kirimkodeServer(): string {
  return (process.env.NOKOS_KIRIMKODE_SERVER || "api4").trim() || "api4";
}

/** Urutan server yang dicoba untuk daftar negara/layanan: pilihan env dulu,
 *  lalu api1..api10 (beberapa node kadang gagal sementara — lewati, coba yang lain). */
function kirimkodeServerCandidates(): string[] {
  const chosen = kirimkodeServer();
  const out: string[] = [chosen];
  for (let i = 1; i <= 10; i++) {
    const s = `api${i}`;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function makeReferenceId(prefix = "KAKO"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${rand.toUpperCase()}`;
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

/** Harga jual = harga provider + 30% (default, bisa diatur NOKOS_MARKUP_PCT). */
function computeSellPrice(providerPrice: number): number {
  const base = Math.max(0, Math.floor(Number(providerPrice) || 0));
  const pct = Math.max(0, Number(process.env.NOKOS_MARKUP_PCT) || 30);
  return Math.max(0, Math.round(base * (1 + pct / 100)));
}

function extractErrorMessage(json: any, text: string, fallback: string): string {
  const msg =
    (json && (json.message || json.msg || json.error)) ||
    (json && json.data && (json.data.message || json.data.error)) ||
    "";
  if (msg) return String(msg);
  return text && text.trim() ? text.slice(0, 300) : fallback;
}

/* =====================================================================
 * PAYMENTKU (deposit / pembayaran customer) — QRIS only
 * ===================================================================== */

/** Buat invoice Paymentku. Uang masuk ke akun Paymentku owner. */
export const createPayment = action({
  args: {
    amount: v.number(),
    referenceId: v.optional(v.string()),
    customerName: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const apiKey = envKey("PAYMENTKU_API_KEY", "NOKOS_PAYMENTKU_API_KEY");
    if (!apiKey) {
      return { ok: false, error: "PAYMENTKU_API_KEY belum diatur di Keys/Environment project ini." };
    }
    const amount = Math.max(1, Math.floor(args.amount));
    const referenceId = (args.referenceId || makeReferenceId("KAKO")).slice(0, 64);
    const base = (process.env.PAYMENTKU_API_URL || PAYMENTKU_BASE_DEFAULT).replace(/\/+$/, "");

    const body: Record<string, unknown> = {
      channel_code: "qris", // Deposit toko ini: QR only.
      amount,
      reference_id: referenceId,
      customer_name: (args.customerName || "Customer KAKO NOKOS").slice(0, 50),
      customer_email: (args.customerEmail || "customer@kakonokos.local").slice(0, 100),
      return_url: process.env.SITE_URL || "",
    };
    if (args.description) body.description = args.description.slice(0, 200);

    const { ok, status, json, text } = await fetchJson(`${base}/transaction/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": referenceId,
      },
      body: JSON.stringify(body),
    });

    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `Paymentku menjawab HTTP ${status}`) };
    }

    const data = (json && json.data) || json || {};
    const payUrl = data.pay_url || data.payment_url || "";
    if (!payUrl) {
      return { ok: false, error: "Paymentku tidak mengembalikan link bayar (pay_url)." };
    }
    return {
      ok: true,
      referenceId,
      trxId: data.trx_id || null,
      amount: Number(data.amount) || amount,
      payUrl,
      paymentInfo: data.payment_info || {},
    };
  },
});

/** Cek status pembayaran Paymentku. */
export const checkPayment = action({
  args: { referenceId: v.string() },
  handler: async (_ctx, args) => {
    const apiKey = envKey("PAYMENTKU_API_KEY", "NOKOS_PAYMENTKU_API_KEY");
    if (!apiKey) return { ok: false, error: "PAYMENTKU_API_KEY belum diatur." };
    const base = (process.env.PAYMENTKU_API_URL || PAYMENTKU_BASE_DEFAULT).replace(/\/+$/, "");
    const { ok, status, json, text } = await fetchJson(
      `${base}/check-status/${encodeURIComponent(args.referenceId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `HTTP ${status}`) };
    }
    const data = (json && json.data) || json || {};
    const statusStr = String(data.status || data.payment_status || "").toLowerCase();
    return {
      ok: true,
      referenceId: args.referenceId,
      status: statusStr,
      paid: ["paid", "success", "settled", "completed"].includes(statusStr),
      data,
    };
  },
});

/* =====================================================================
 * PROVIDER OTP (KirimKode / Ditznesia / Ditznesia v2)
 * ===================================================================== */

type Provider = "kirimkode" | "ditznesia" | "ditznesia_v2";

type ProviderConfig = {
  label: string;
  keyEnv: string;
  baseEnv: string;
  defaultBase: string;
  auth: "header" | "query";
  apiKeyHeader?: string;
};

type ResolvedProviderConfig = ProviderConfig & { apiKey: string; base: string };

function isResolved(cfg: ProviderConfig): cfg is ResolvedProviderConfig {
  return Boolean((cfg as ResolvedProviderConfig).apiKey && (cfg as ResolvedProviderConfig).base);
}

const PROVIDERS: Record<Provider, ProviderConfig> = {
  kirimkode: {
    label: "KirimKode",
    keyEnv: "NOKOS_KIRIMKODE_API_KEY",
    baseEnv: "NOKOS_KIRIMKODE_API_URL",
    defaultBase: KIRIMKODE_BASE_DEFAULT,
    auth: "header",
    apiKeyHeader: "X-API-Key",
  },
  ditznesia: {
    label: "Ditznesia",
    keyEnv: "NOKOS_DITZNESIA_API_KEY",
    baseEnv: "NOKOS_DITZNESIA_API_URL",
    defaultBase: DITZNESIA_BASE_DEFAULT,
    auth: "query",
  },
  ditznesia_v2: {
    label: "Ditznesia API v2",
    keyEnv: "NOKOS_DITZNESIA_API2_KEY",
    baseEnv: "NOKOS_DITZNESIA_API2_URL",
    defaultBase: DITZNESIA2_BASE_DEFAULT,
    auth: "query",
  },
};

function providerConfig(provider: string): ResolvedProviderConfig | null {
  const cfg = PROVIDERS[provider as Provider];
  if (!cfg) return null;
  const apiKey = envKey(cfg.keyEnv);
  const base = (process.env[cfg.baseEnv] || cfg.defaultBase).trim().replace(/\/+$/, "");
  if (!apiKey) return null;
  if (!base) return null;
  const resolved = { ...cfg, apiKey, base };
  return isResolved(resolved) ? resolved : null;
}

/** Tambah auth ke URL (Ditznesia: param api_key) atau headers (KirimKode: X-API-Key). */
function withAuth(cfg: ResolvedProviderConfig, url: string): { url: string; headers?: Record<string, string> } {
  if (cfg.auth === "header") {
    return { url, headers: { [cfg.apiKeyHeader || "X-API-Key"]: cfg.apiKey } };
  }
  const sep = url.includes("?") ? "&" : "?";
  return { url: `${url}${sep}api_key=${encodeURIComponent(cfg.apiKey)}` };
}

/** KirimKode memakai /order/{id}/status, Ditznesia memakai /sms.php?id_order=... */
export const getOrderStatus = action({
  args: { provider: v.string(), orderId: v.string() },
  handler: async (_ctx, args) => {
    const cfg = providerConfig(args.provider);
    if (!cfg) {
      return { ok: false, error: `Kunci/URL untuk ${args.provider} belum diatur di Keys/Environment.` };
    }
    const id = encodeURIComponent(args.orderId);
    // KirimKode: GET /order/{id}/status. Ditznesia v1/v2: GET /sms.php — docs resmi
    // v2 memakai param `id`; v1 di beberapa versi memakai `id_order`. Dikirim dua-duanya
    // agar kompatibel dengan keduanya (param ekstra diabaikan API).
    const path = cfg.auth === "header" ? `/order/${id}/status` : `/sms.php?id=${id}&id_order=${id}`;
    const { url, headers } = withAuth(cfg, `${cfg.base}${path}`);
    const { ok, status, json, text } = await fetchJson(url, { headers });
    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `${cfg.label}: HTTP ${status}`) };
    }
    const data = (json && json.data) || json || {};
    const code = data.code ?? data.otp ?? data.sms ?? null;
    return { ok: true, provider: cfg.label, orderId: args.orderId, code, raw: json };
  },
});

/** Cek saldo owner di provider. */
export const getProviderBalance = action({
  args: { provider: v.string() },
  handler: async (_ctx, args) => {
    const cfg = providerConfig(args.provider);
    if (!cfg) {
      return { ok: false, error: `Kunci/URL untuk ${args.provider} belum diatur di Keys/Environment.` };
    }
    const path = cfg.auth === "header" ? "/balance" : "/balance.php";
    const { url, headers } = withAuth(cfg, `${cfg.base}${path}`);
    const { ok, status, json, text } = await fetchJson(url, { headers });
    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `${cfg.label}: HTTP ${status}`) };
    }
    const data = (json && json.data) || json || {};
    const balance = Number(data.balance ?? data.saldo ?? data.saldo_akun);
    return {
      ok: true,
      provider: cfg.label,
      balance: Number.isFinite(balance) ? balance : null,
      raw: json,
    };
  },
});

/** Daftar negara yang tersedia di provider. */
export const listCountries = action({
  args: { provider: v.string() },
  handler: async (_ctx, args) => {
    const cfg = providerConfig(args.provider);
    if (!cfg) {
      return { ok: false, error: `Kunci/URL untuk ${args.provider} belum diatur di Keys/Environment.` };
    }
    // KirimKode butuh param server (api1..api10) untuk daftar negara/layanan.
    if (cfg.auth === "header") {
      let lastErr = "";
      for (const server of kirimkodeServerCandidates()) {
        const { url, headers } = withAuth(cfg, `${cfg.base}/countries?server=${server}`);
        const { ok, status, json, text } = await fetchJson(url, { headers });
        if (!ok || (json && json.success === false)) {
          lastErr = extractErrorMessage(json, text, `${cfg.label}: HTTP ${status}`);
          continue;
        }
        const data = (json && json.data) || [];
        const countries = Array.isArray(data)
          ? data.map((c: any) => ({
              id: c.id ?? c.id_negara ?? null,
              name: c.name ?? c.nama_negara ?? c.country ?? String(c.id ?? ""),
              code: c.code ?? c.kode ?? null,
            }))
          : [];
        return { ok: true, provider: cfg.label, countries, raw: json };
      }
      return { ok: false, error: lastErr || `${cfg.label}: semua server gagal.` };
    }
    const path = "/negara.php";
    const { url, headers } = withAuth(cfg, `${cfg.base}${path}`);
    const { ok, status, json, text } = await fetchJson(url, { headers });
    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `${cfg.label}: HTTP ${status}`) };
    }
    const data = (json && json.data) || [];
    const countries = Array.isArray(data)
      ? data.map((c: any) => ({
          id: c.id ?? c.id_negara ?? null,
          name: c.name ?? c.nama_negara ?? c.country ?? String(c.id ?? ""),
          code: c.code ?? c.kode ?? null,
        }))
      : [];
    return { ok: true, provider: cfg.label, countries, raw: json };
  },
});

/**
 * Ubah respons daftar layanan (array ATAU objek bertingkat khas Ditznesia:
 * { id_negara: { kodeLayanan: { harga, stok, layanan } } }) jadi array seragam.
 */
function flattenServices(root: any): Array<{
  id: string | null;
  name: string | null;
  service: string | null;
  price: number;
  stock: number;
}> {
  const out: Array<{ id: string | null; name: string | null; service: string | null; price: number; stock: number }> = [];
  const walk = (node: any, keyHint: string | null) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, keyHint);
      return;
    }
    const hasPrice = "price" in node || "harga" in node || "harga_jual" in node;
    const hasStock = "stock" in node || "stok" in node;
    const hasName = "name" in node || "nama" in node || "layanan" in node || "nama_layanan" in node;
    if (hasPrice || (hasStock && hasName)) {
      const code = node.service ?? node.code ?? node.kode ?? node.id ?? keyHint;
      out.push({
        id: code != null ? String(code) : null,
        service: code != null ? String(code) : null,
        name: node.name ?? node.nama ?? node.layanan ?? node.nama_layanan ?? null,
        price: Number(node.price ?? node.harga ?? node.harga_jual ?? 0),
        stock: Number(node.stock ?? node.stok ?? 0),
      });
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, k);
  };
  walk(root, null);
  return out;
}

/** Daftar layanan untuk sebuah negara di provider. */
export const listServices = action({
  args: { provider: v.string(), country: v.union(v.number(), v.string()) },
  handler: async (_ctx, args) => {
    const cfg = providerConfig(args.provider);
    if (!cfg) {
      return { ok: false, error: `Kunci/URL untuk ${args.provider} belum diatur di Keys/Environment.` };
    }
    const countryEnc = encodeURIComponent(String(args.country));
    if (cfg.auth === "header") {
      let lastErr = "";
      for (const server of kirimkodeServerCandidates()) {
        const { url, headers } = withAuth(cfg, `${cfg.base}/services?country=${countryEnc}&server=${server}`);
        const { ok, status, json, text } = await fetchJson(url, { headers });
        if (!ok || (json && json.success === false)) {
          lastErr = extractErrorMessage(json, text, `${cfg.label}: HTTP ${status}`);
          continue;
        }
        const data = (json && json.data) || [];
        const services = flattenServices(Array.isArray(data) ? data : []);
        if (services.length === 0) {
          lastErr = `${cfg.label} (${server}) tidak mengembalikan layanan untuk negara ini.`;
          continue;
        }
        return { ok: true, provider: cfg.label, services, raw: json };
      }
      return { ok: false, error: lastErr || `${cfg.label}: semua server gagal.` };
    }
    const { url, headers } = withAuth(cfg, `${cfg.base}/layanan.php?negara=${countryEnc}`);
    const { ok, status, json, text } = await fetchJson(url, { headers });
    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `${cfg.label}: HTTP ${status}`) };
    }
    const data = (json && json.data) || json || {};
    const services = flattenServices(data);
    return { ok: true, provider: cfg.label, services, raw: json };
  },
});

/**
 * Pesan nomor dari provider dengan kunci owner.
 *
 * KirimKode : POST {base}/order , header X-API-Key, body JSON
 *             { server: (NOKOS_KIRIMKODE_SERVER|"api1"), country, service, operator }
 * Ditznesia : GET {base}/order.php?api_key=...&negara=..&operator=any&layanan=..
 *
 * Harga jual dihitung +30% di sini (satu sumber).
 */
async function placeProviderOrder(opts: {
  provider: string;
  country: number | string;
  service: number | string;
  operator?: number | string;
  providerPrice: number;
  extra?: any;
}): Promise<Record<string, unknown>> {
  const cfg = providerConfig(opts.provider);
  if (!cfg) {
    return {
      ok: false,
      error: `Kunci/URL untuk ${opts.provider} belum diatur di Keys/Environment (${opts.provider === "kirimkode" ? "NOKOS_KIRIMKODE_API_KEY" : opts.provider === "ditznesia" ? "NOKOS_DITZNESIA_API_KEY" : "NOKOS_DITZNESIA_API2_KEY"}).`,
    };
  }

  const providerPrice = Math.max(0, Math.floor(Number(opts.providerPrice) || 0));
  const sellPrice = computeSellPrice(providerPrice);
  const country = String(opts.country);
  const service = String(opts.service);
  const operator = opts.operator != null ? String(opts.operator) : "any";

  let orderId: string | null = null;
  let raw: any = null;
  let err: { ok: false; error: string } | null = null;

  if (cfg.auth === "header") {
    const server = (process.env.NOKOS_KIRIMKODE_SERVER || "api4").trim() || "api4";
    const body: Record<string, unknown> = {
      server,
      country,
      service,
      operator,
      ...(opts.extra && typeof opts.extra === "object" ? opts.extra : {}),
    };
    const { ok, status, json, text } = await fetchJson(`${cfg.base}/order`, {
      method: "POST",
      headers: {
        [cfg.apiKeyHeader || "X-API-Key"]: cfg.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!ok) {
      err = { ok: false, error: extractErrorMessage(json, text, `${cfg.label}: HTTP ${status}`) };
    } else {
      raw = json;
      const data = (json && json.data) || json || {};
      orderId = data.id ?? data.order_id ?? data.orderId ?? null;
    }
  } else {
    const params = new URLSearchParams({
      api_key: cfg.apiKey,
      negara: country,
      operator,
      layanan: service,
    });
    if (opts.extra && typeof opts.extra === "object") {
      for (const [k, val] of Object.entries(opts.extra)) {
        if (val != null) params.set(k, String(val));
      }
    }
    const { ok, status, json, text } = await fetchJson(`${cfg.base}/order.php?${params.toString()}`);
    if (!ok) {
      err = { ok: false, error: extractErrorMessage(json, text, `${cfg.label}: HTTP ${status}`) };
    } else {
      raw = json;
      const data = (json && json.data) || json || {};
      orderId =
        data.id ??
        data.id_order ??
        data.order_id ??
        data.orderId ??
        data.trx_id ??
        null;
    }
  }

  if (err) return err;

  if (!orderId) {
    const text = raw ? JSON.stringify(raw).slice(0, 300) : "(kosong)";
    return {
      ok: false,
      error: `${cfg.label} menjawab sukses tapi tidak ada id order. Respons: ${text}`,
    };
  }

  return {
    ok: true,
    provider: cfg.label,
    orderId: String(orderId),
    providerPrice,
    sellPrice,
    raw,
  };
}

export const createNumberOrder = action({
  args: {
    provider: v.string(),
    country: v.union(v.number(), v.string()),
    service: v.union(v.number(), v.string()),
    operator: v.optional(v.union(v.number(), v.string())),
    providerPrice: v.number(),
    extra: v.optional(v.any()),
  },
  handler: async (_ctx, args) => placeProviderOrder(args),
});

/* =====================================================================
 * AKUN & SALDO CUSTOMER (login email+password, deposit QR Paymentku,
 * beli dipotong dari saldo, gagal otomatis refund ke saldo)
 * ===================================================================== */

/** Daftar akun customer sendiri (email = username). */
export const registerCustomer = action({
  args: {
    email: v.string(),
    password: v.string(),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.runMutation(I.wallet.registerCustomer, {
      email: args.email,
      password: args.password,
      fullName: args.fullName ?? undefined,
    });
  },
});

/** Login email + password. */
export const loginCustomer = action({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(I.wallet.verifyCustomer, {
      username: args.username.trim().toLowerCase(),
      password: args.password,
    });
    if (!user) {
      return { ok: false, error: "Email atau password salah." };
    }
    // Catat waktu akses terakhir (untuk daftar akun di Panel Admin Owner).
    await ctx.runMutation(I.wallet.touchLogin, { userId: user.id }).catch(() => {});
    return { ok: true, user };
  },
});

/** Info saldo customer. */
export const getWallet = action({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const w = await ctx.runQuery(I.wallet.wallet, { userId: args.userId });
    if (!w) return { ok: false, error: "Akun tidak ditemukan." };
    return { ok: true, wallet: w };
  },
});

/** Riwayat order customer. */
export const listMyOrders = action({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const rows = await ctx.runQuery(I.wallet.listOrders, { userId: args.userId });
    return { ok: true, orders: rows };
  },
});

/** Buat invoice deposit (QRIS Paymentku) + tandai pending. */
export const depositCreate = action({
  args: { userId: v.id("appUsers"), amount: v.number() },
  handler: async (ctx, args) => {
    const apiKey = envKey("PAYMENTKU_API_KEY", "NOKOS_PAYMENTKU_API_KEY");
    if (!apiKey) {
      return { ok: false, error: "PAYMENTKU_API_KEY belum diatur di Keys/Environment." };
    }
    const amount = Math.max(5000, Math.floor(args.amount));
    const referenceId = makeReferenceId("DEP");
    const base = (process.env.PAYMENTKU_API_URL || PAYMENTKU_BASE_DEFAULT).replace(/\/+$/, "");
    const body: Record<string, unknown> = {
      channel_code: "qris",
      amount,
      reference_id: referenceId,
      customer_name: "Customer KAKO NOKOS",
      customer_email: "customer@kakonokos.local",
      description: `Deposit saldo KAKO NOKOS (${referenceId})`,
      return_url: process.env.SITE_URL || "https://kakonokos.freebuff.app",
    };
    const { ok, status, json, text } = await fetchJson(`${base}/transaction/create`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": referenceId,
      },
      body: JSON.stringify(body),
    });
    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `Paymentku menjawab HTTP ${status}`) };
    }
    const data = (json && json.data) || json || {};
    const payUrl = data.pay_url || data.payment_url || "";
    if (!payUrl) {
      return { ok: false, error: "Paymentku tidak mengembalikan link bayar (pay_url)." };
    }
    await ctx.runMutation(I.wallet.recordDeposit, {
      userId: args.userId,
      referenceId,
      amount,
    });
    return { ok: true, referenceId, amount, payUrl };
  },
});

/** Cek status deposit & kredit saldo otomatis kalau sudah lunas. */
export const depositPoll = action({
  args: { referenceId: v.string() },
  handler: async (ctx, args) => {
    const apiKey = envKey("PAYMENTKU_API_KEY", "NOKOS_PAYMENTKU_API_KEY");
    if (!apiKey) return { ok: false, error: "PAYMENTKU_API_KEY belum diatur." };
    const base = (process.env.PAYMENTKU_API_URL || PAYMENTKU_BASE_DEFAULT).replace(/\/+$/, "");
    const { ok, status, json, text } = await fetchJson(
      `${base}/check-status/${encodeURIComponent(args.referenceId)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `HTTP ${status}`) };
    }
    const data = (json && json.data) || json || {};
    const statusStr = String(data.status || data.payment_status || "").toLowerCase();
    const paid = ["paid", "success", "settled", "completed"].includes(statusStr);
    if (!paid) {
      return { ok: true, paid: false, status: statusStr || "pending" };
    }
    const res = await ctx.runMutation(I.wallet.settleDeposit, { referenceId: args.referenceId });
    return { ok: true, paid: true, status: statusStr, balance: res.ok ? res.balance : undefined };
  },
});

/**
 * Beli nomor pakai saldo: potong saldo -> pesan ke provider -> kalau gagal
 * saldo otomatis dikembalikan (refund).
 */
export const buyWithBalance = action({
  args: {
    userId: v.id("appUsers"),
    provider: v.string(),
    country: v.union(v.number(), v.string()),
    service: v.union(v.number(), v.string()),
    operator: v.optional(v.union(v.number(), v.string())),
    providerPrice: v.number(),
    countryName: v.optional(v.string()),
    serviceName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const providerPrice = Math.max(0, Math.floor(Number(args.providerPrice) || 0));
    const sellPrice = computeSellPrice(providerPrice);

    const charge = await ctx.runMutation(I.wallet.charge, {
      userId: args.userId,
      amount: sellPrice,
    });
    if (!charge.ok) {
      return { ok: false, error: charge.error || "Saldo tidak cukup." };
    }

    const order = await placeProviderOrder({
      provider: args.provider,
      country: args.country,
      service: args.service,
      operator: args.operator ?? "any",
      providerPrice,
    });

    if (!order.ok || !order.orderId) {
      // Gagal -> uang dikembalikan ke saldo customer.
      const refund = await ctx.runMutation(I.wallet.refundCharge, {
        userId: args.userId,
        amount: sellPrice,
      });
      return {
        ok: false,
        refunded: true,
        balance: refund.ok ? refund.balance : undefined,
        error:
          (order.error || "Server provider gagal memesan nomor.") +
          " Saldo kamu sudah dikembalikan otomatis.",
      };
    }

    await ctx.runMutation(I.wallet.saveOrder, {
      userId: args.userId,
      provider: args.provider,
      providerLabel: order.provider || args.provider,
      country: String(args.country),
      countryName: args.countryName ?? undefined,
      service: String(args.service),
      serviceName: args.serviceName ?? undefined,
      orderId: String(order.orderId),
      sellPrice,
      providerPrice,
    });

    return {
      ok: true,
      orderId: String(order.orderId),
      provider: order.provider,
      sellPrice,
      balance: charge.balance,
    };
  },
});

/* =====================================================================
 * PERAN OWNER & CS — panel admin (semua aksi cek peran pemanggil dulu)
 * ===================================================================== */

/** Batas minimum sebelum customer boleh membatalkan order (2 menit). */
const CANCEL_MIN_MS = 2 * 60 * 1000;

async function staffActor(ctx: any, actorId: string) {
  const a = await ctx.runQuery(I.wallet.actorInfo, { userId: actorId });
  if (!a) return null;
  if (a.role !== "owner" && a.role !== "cs") return null;
  return a;
}

async function ownerActor(ctx: any, actorId: string) {
  const a = await staffActor(ctx, actorId);
  if (!a || a.role !== "owner") return null;
  return a;
}

/** Baca kode OTP / status terkini dari provider (untuk cek sebelum refund). */
async function providerFetchCode(cfg: ResolvedProviderConfig, orderId: string): Promise<{ code: string | null; raw: any }> {
  const id = encodeURIComponent(orderId);
  const path = cfg.auth === "header" ? `/order/${id}/status` : `/sms.php?id=${id}&id_order=${id}`;
  const { url, headers } = withAuth(cfg, `${cfg.base}${path}`);
  const { ok, json } = await fetchJson(url, { headers });
  if (!ok) return { code: null, raw: json };
  const data = (json && json.data) || json || {};
  const code = data.code ?? data.otp ?? data.sms ?? null;
  return { code: code != null && String(code) !== "" ? String(code) : null, raw: json };
}

/** Batalkan order di sisi provider (best-effort — saldo tetap dikembalikan). */
async function providerCancelOrder(cfg: ResolvedProviderConfig, orderId: string): Promise<{ ok: boolean; error?: string }> {
  const id = encodeURIComponent(orderId);
  if (cfg.auth === "header") {
    // KirimKode: POST {base}/order/{id}/cancel
    const { url, headers } = withAuth(cfg, `${cfg.base}/order/${id}/cancel`);
    const { ok, status, json, text } = await fetchJson(url, { method: "POST", headers });
    return ok ? { ok: true } : { ok: false, error: extractErrorMessage(json, text, `HTTP ${status}`) };
  }
  // Ditznesia v1/v2: GET cancel.php?id=...
  const { url } = withAuth(cfg, `${cfg.base}/cancel.php?id=${id}&id_order=${id}`);
  const { ok, status, json, text } = await fetchJson(url);
  return ok ? { ok: true } : { ok: false, error: extractErrorMessage(json, text, `HTTP ${status}`) };
}

/** Daftar akun Owner pertama — butuh kode rahasia dari env (bukan dari browser). */
export const registerOwner = action({
  args: {
    email: v.string(),
    password: v.string(),
    fullName: v.optional(v.string()),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const expected = (process.env.OWNER_SIGNUP_CODE || "").trim();
    if (!expected) {
      return { ok: false, error: "Pendaftaran Owner belum diaktifkan di server (OWNER_SIGNUP_CODE kosong)." };
    }
    if (!args.code || args.code.trim() !== expected) {
      return { ok: false, error: "Kode Owner salah." };
    }
    const res = await ctx.runMutation(I.wallet.registerOwner, {
      email: args.email,
      password: args.password,
      fullName: args.fullName ?? undefined,
    });
    return res.success ? { ok: true, id: res.id } : { ok: false, error: res.error || "Gagal membuat akun Owner." };
  },
});

/** Owner membuat akun CS (Customer Service). */
export const createStaff = action({
  args: {
    actorId: v.id("appUsers"),
    username: v.string(),
    password: v.string(),
    fullName: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    if (args.password.length < 4) return { ok: false, error: "Password minimal 4 karakter." };
    const res = await ctx.runMutation(I.wallet.createStaff, {
      username: args.username,
      password: args.password,
      fullName: args.fullName || "Customer Service",
      role: "cs",
    });
    return res.success ? { ok: true, id: res.id } : { ok: false, error: res.error || "Gagal membuat akun CS." };
  },
});

/** Owner menghapus akun CS. */
export const deleteStaff = action({
  args: { actorId: v.id("appUsers"), userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    return ctx.runMutation(I.wallet.deleteStaff, { userId: args.userId });
  },
});

/** Statistik panel admin (khusus Owner — berisi total deposit & transaksi). */
export const adminStats = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    const s = await ctx.runQuery(I.wallet.statsOverview, {});
    return { ok: true, stats: s };
  },
});

/** Daftar semua akun (owner/cs). */
export const adminListUsers = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await staffActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Akses khusus Owner/CS." };
    const users = await ctx.runQuery(I.wallet.listAllUsers, {});
    const list = users.map((u: any) => ({
      id: u._id,
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      balance: Math.max(0, Math.floor(Number(u.balance) || 0)),
      createdAt: u.createdAt,
      createdBy: u.createdBy || "",
      lastLoginAt: u.lastLoginAt || null,
    }));
    return { ok: true, users: list };
  },
});

/** Ubah saldo customer: amount positif = isi saldo, negatif = potong/kembalikan. */
export const adminAdjustBalance = action({
  args: {
    actorId: v.id("appUsers"),
    userId: v.id("appUsers"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    const actor = await staffActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Akses khusus Owner/CS." };
    const delta = Math.floor(args.amount) || 0;
    if (delta === 0) return { ok: false, error: "Jumlah tidak boleh 0." };
    if (Math.abs(delta) > 100_000_000) return { ok: false, error: "Nominal terlalu besar." };
    const res = await ctx.runMutation(I.wallet.adjustBalance, { userId: args.userId, delta });
    return res.ok ? { ok: true, balance: res.balance } : { ok: false, error: res.error || "Gagal ubah saldo." };
  },
});

/** Riwayat deposit customer (khusus Owner) — isi saldo via QR. */
export const adminDeposits = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    const rows = await ctx.runQuery(I.wallet.adminDepositsList, {});
    return { ok: true, deposits: rows };
  },
});

/** Riwayat order semua customer. */
export const adminOrders = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await staffActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Akses khusus Owner/CS." };
    const rows = await ctx.runQuery(I.wallet.adminOrdersList, {});
    return { ok: true, orders: rows };
  },
});

/**
 * Refund manual oleh Owner/CS untuk satu order — menolak kalau OTP sudah masuk.
 * (Kebijakan: OTP masuk = nomor sudah terpakai, tidak bisa refund.)
 */
export const adminRefundOrder = action({
  args: { actorId: v.id("appUsers"), rowId: v.id("nokosOrders") },
  handler: async (ctx, args) => {
    const actor = await staffActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Akses khusus Owner/CS." };
    const row: any = await ctx.runQuery(I.wallet.orderByRowId, { rowId: args.rowId });
    if (!row) return { ok: false, error: "Order tidak ditemukan." };
    if (row.status !== "ordered") {
      return {
        ok: false,
        error: row.otp || row.status === "otp" ? "OTP sudah masuk — tidak bisa refund." : `Status order (${row.status}) tidak bisa di-refund.`,
      };
    }
    if (row.otp) return { ok: false, error: "OTP sudah masuk — tidak bisa refund." };
    const cfg = providerConfig(row.provider);
    if (cfg) {
      const live = await providerFetchCode(cfg, row.orderId);
      if (live.code) {
        await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, otp: live.code, status: "otp" });
        return { ok: false, error: "OTP sudah masuk — tidak bisa refund.", otp: live.code };
      }
      await providerCancelOrder(cfg, row.orderId).catch(() => ({ ok: false }));
    }
    const refund = await ctx.runMutation(I.wallet.refundCharge, { userId: row.userId, amount: row.sellPrice });
    await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, status: "refunded" });
    return { ok: true, refunded: row.sellPrice, balance: refund.ok ? refund.balance : undefined };
  },
});

/**
 * Customer membatalkan order-nya sendiri.
 * Aturan: minimal 2 menit sejak order dibuat, dan tidak bisa kalau OTP sudah masuk.
 */
export const cancelOrder = action({
  args: { userId: v.id("appUsers"), orderId: v.string() },
  handler: async (ctx, args) => {
    const row: any = await ctx.runQuery(I.wallet.orderByProviderId, { orderId: args.orderId });
    if (!row) return { ok: false, error: "Order tidak ditemukan." };
    if (String(row.userId) !== String(args.userId)) {
      return { ok: false, error: "Order bukan milik akun ini." };
    }
    if (row.otp || row.status === "otp") {
      return { ok: false, error: "OTP sudah masuk — tidak bisa dibatalkan/direfund.", otp: row.otp };
    }
    if (row.status !== "ordered") {
      return { ok: false, error: row.status === "refunded" ? "Order ini sudah direfund." : "Order sudah tidak bisa dibatalkan." };
    }
    const age = Date.now() - row.createdAt;
    if (age < CANCEL_MIN_MS) {
      const sisa = Math.ceil((CANCEL_MIN_MS - age) / 1000);
      return {
        ok: false,
        retryAfterSeconds: sisa,
        error: `Pembatalan bisa dilakukan minimal 2 menit setelah order dibuat. Bisa dibatalkan dalam ${sisa} detik lagi.`,
      };
    }
    const cfg = providerConfig(row.provider);
    if (cfg) {
      const live = await providerFetchCode(cfg, row.orderId);
      if (live.code) {
        await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, otp: live.code, status: "otp" });
        return { ok: false, error: "OTP sudah masuk — tidak bisa dibatalkan/direfund.", otp: live.code };
      }
      await providerCancelOrder(cfg, row.orderId).catch(() => ({ ok: false }));
    }
    const refund = await ctx.runMutation(I.wallet.refundCharge, { userId: args.userId, amount: row.sellPrice });
    await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, status: "refunded" });
    return { ok: true, refunded: row.sellPrice, balance: refund.ok ? refund.balance : undefined };
  },
});

/** Simpan OTP yang ditemukan ke riwayat (otomatis dari polling halaman). */
export const recordOtp = action({
  args: { userId: v.id("appUsers"), orderId: v.string(), otp: v.string() },
  handler: async (ctx, args) => {
    const row: any = await ctx.runQuery(I.wallet.orderByProviderId, { orderId: args.orderId });
    if (!row) return { ok: false, error: "Order tidak ditemukan." };
    if (String(row.userId) !== String(args.userId)) return { ok: false, error: "Order bukan milik akun ini." };
    if (!args.otp || !args.otp.trim()) return { ok: false, error: "OTP kosong." };
    const otp = args.otp.trim().slice(0, 40);
    const res = await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, otp, status: "otp" });
    return res.ok ? { ok: true } : { ok: false, error: res.error || "Gagal menyimpan OTP." };
  },
});

/** Cek ulang satu order punya customer (dipakai tombol "Periksa OTP"). */
export const checkMyOrder = action({
  args: { userId: v.id("appUsers"), orderId: v.string() },
  handler: async (ctx, args) => {
    const row: any = await ctx.runQuery(I.wallet.orderByProviderId, { orderId: args.orderId });
    if (!row) return { ok: false, error: "Order tidak ditemukan." };
    if (String(row.userId) !== String(args.userId)) return { ok: false, error: "Order bukan milik akun ini." };
    if (row.otp || row.status === "otp") return { ok: true, status: "otp", otp: row.otp };
    if (row.status !== "ordered") return { ok: true, status: row.status, otp: null };
    const cfg = providerConfig(row.provider);
    if (!cfg) return { ok: true, status: row.status, otp: null, error: "Kunci provider belum aktif." };
    const live = await providerFetchCode(cfg, row.orderId);
    if (live.code) {
      await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, otp: live.code, status: "otp" });
      return { ok: true, status: "otp", otp: live.code };
    }
    return { ok: true, status: row.status, otp: null, raw: live.raw };
  },
});

/** Owner mengganti email/password/nama akunnya sendiri. */
export const ownerUpdateLogin = action({
  args: {
    userId: v.id("appUsers"),
    currentPassword: v.string(),
    newUsername: v.optional(v.string()),
    newPassword: v.optional(v.string()),
    newFullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.userId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    // Verifikasi password lama via query internal (tidak perlu baca row langsung di action).
    const check = await ctx.runQuery(I.wallet.verifyCustomer, {
      username: actor.username,
      password: args.currentPassword,
    });
    if (!check) return { ok: false, error: "Password lama salah." };
    return ctx.runMutation(I.wallet.ownerUpdateLogin, {
      userId: args.userId,
      newUsername: args.newUsername ?? undefined,
      newPassword: args.newPassword ?? undefined,
      newFullName: args.newFullName ?? undefined,
    });
  },
});

/** Baca pengaturan toko (visibilitas server). Publik — untuk halaman beli. */
export const getServerSettings = action({
  args: {},
  handler: async (ctx) => {
    const map = await ctx.runQuery(I.wallet.getSettings, {});
    const raw = map["serverVisibility"];
    const servers: Record<string, boolean> =
      raw && typeof raw === "object" ? (raw as Record<string, boolean>) : {};
    return { ok: true, servers };
  },
});

/** Owner menyalakan/mematikan tampilan sebuah server di halaman beli. */
export const setServerEnabled = action({
  args: { actorId: v.id("appUsers"), serverKey: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    const map = await ctx.runQuery(I.wallet.getSettings, {});
    const servers: Record<string, boolean> =
      map["serverVisibility"] && typeof map["serverVisibility"] === "object"
        ? (map["serverVisibility"] as Record<string, boolean>)
        : {};
    servers[args.serverKey] = args.enabled;
    await ctx.runMutation(I.wallet.setSettings, { key: "serverVisibility", value: servers });
    return { ok: true, servers };
  },
});
