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

/**
 * Node KirimKode yang TERBUKTI bisa MEMESAN nomor untuk akun ini.
 *
 * Hasil uji langsung ke API: dari api1..api10, hanya api4 dan api3 yang
 * benar-benar mengeluarkan nomor. Node lain masih menjawab daftar negara &
 * layanan (jadi terlihat "tersedia"), tapi setiap order selalu ditolak dengan
 * "nomor untuk pilihan ini sedang tidak tersedia". Karena itu hanya dua node
 * ini yang dipakai, supaya customer tidak pernah memilih yang pasti gagal.
 */
const KIRIMKODE_LIVE_NODES = ["api4", "api3"];

/** Jalur stok utama (Server v1 & v3): node utama akun dulu, lalu node live lain. */
function kirimkodePoolMain(): string[] {
  return [...new Set([kirimkodeServer(), ...KIRIMKODE_LIVE_NODES])];
}

/** Jalur stok alternatif (Server v2 & v4): mulai dari node live kedua. */
function kirimkodePoolAlt(): string[] {
  return [...KIRIMKODE_LIVE_NODES].reverse();
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

/**
 * Harga jual = harga provider dibagi (1 - margin), dengan margin = % dari
 * HARGA JUAL (default 30, bisa diatur NOKOS_MARKUP_PCT).
 * Contoh: modal Rp 1.000, margin 30% -> jual = 1.000 / 0,7 = Rp 1.429,
 * keuntungan Rp 429 = 30% dari harga jual.
 */
function computeSellPrice(providerPrice: number): number {
  const base = Math.max(0, Math.floor(Number(providerPrice) || 0));
  const pct = Math.min(95, Math.max(0, Number(process.env.NOKOS_MARKUP_PCT) || 30));
  return Math.max(0, Math.round(base / (1 - pct / 100)));
}

function extractErrorMessage(json: any, text: string, fallback: string): string {
  const cand =
    (json && (json.message || json.msg || json.error || json.error_message)) ||
    (json && json.data && (json.data.message || json.data.error)) ||
    "";
  // Sebagian API menaruh errornya sebagai objek: { error: { message, code } }.
  const msg =
    cand && typeof cand === "object"
      ? cand.message || cand.msg || cand.error || JSON.stringify(cand).slice(0, 200)
      : cand;
  if (msg) return String(msg).slice(0, 300);
  return text && text.trim() ? text.slice(0, 300) : fallback;
}

/**
 * HTTP 500 dari API OTP (Ditznesia/jasaotp) biasanya bukan error server —
 * API ini mengembalikan HTTP 500 polos (tanpa isi) saat kunci salah / tidak
 * terdaftar / akun tidak dikenali. Jelaskan ke user supaya tidak bingung.
 */
function explainHttpFailure(label: string, status: number, json: any, text: string, base?: string): string {
  if (status === 0) {
    return (
      `${label} tidak bisa dihubungi${base ? ` (${base})` : ""} — host API provider tidak terjangkau (DNS gagal / server mereka sedang mati), ` +
      "dan jalur cadangan juga tidak bisa dipakai. Tekan “Muat Ulang Data” beberapa saat lagi."
    );
  }
  if (status === 500) {
    return (
      `${label} menjawab HTTP 500. Biasanya ini dari sisi server provider (API mereka sedang bermasalah), ` +
      "bukan dari kunci API kita. Coba lagi beberapa saat lagi; kalau terus begini, kabari admin."
    );
  }
  return extractErrorMessage(json, text, `${label}: HTTP ${status}`);
}

/** Ambil nomor telepon/order dari respons provider (kalau dikirim). */
function extractNumberField(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  const v =
    data.phone ??
    data.phone_number ??
    data.nohp ??
    data.number ??
    data.nomor ??
    data.mobile ??
    data.phoneNumber ??
    data.no;
  if (v == null) return null;
  const s = String(v).trim();
  return s && s !== "" && s !== "null" && s !== "undefined" ? s.slice(0, 40) : null;
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

type Provider = "kirimkode" | "kirimkode_alt" | "ditznesia" | "ditznesia_v2";

type ProviderConfig = {
  label: string;
  keyEnv: string;
  altKeyEnv?: string;
  baseEnv: string;
  defaultBase: string;
  auth: "header" | "query";
  apiKeyHeader?: string;
  /** Base URL cadangan: dipakai otomatis kalau base utama tidak bisa dihubungi. */
  fallbackBases?: string[];
  /** Nama env berisi daftar base cadangan dipisah koma (bisa diisi Owner). */
  fallbackEnv?: string;
  /**
   * Node KirimKode yang dipakai provider ini (urutan prioritas). Dibuat sebagai
   * fungsi supaya env NOKOS_KIRIMKODE_SERVER tetap terbaca saat dipakai.
   */
  nodePool?: () => string[];
};

type ResolvedProviderConfig = ProviderConfig & {
  apiKey: string;
  base: string;
  fallbackBases: string[];
};

function isResolved(cfg: ProviderConfig): cfg is ResolvedProviderConfig {
  return Boolean((cfg as ResolvedProviderConfig).apiKey && (cfg as ResolvedProviderConfig).base);
}

/** Setelan dasar KirimKode — dipakai dua server (jalur stok utama & alternatif). */
const KIRIMKODE_PROVIDER: ProviderConfig = {
  label: "KirimKode",
  keyEnv: "NOKOS_KIRIMKODE_API_KEY",
  baseEnv: "NOKOS_KIRIMKODE_API_URL",
  defaultBase: KIRIMKODE_BASE_DEFAULT,
  auth: "header",
  apiKeyHeader: "X-API-Key",
};

const PROVIDERS: Record<Provider, ProviderConfig> = {
  kirimkode: { ...KIRIMKODE_PROVIDER, nodePool: kirimkodePoolMain },
  // Server v2/v4: kunci & host sama, hanya urutan node stoknya berbeda, jadi
  // tetap benar-benar bisa memesan nomor (bukan sekadar tampilan cadangan).
  kirimkode_alt: { ...KIRIMKODE_PROVIDER, nodePool: kirimkodePoolAlt },
  ditznesia: {
    label: "Ditznesia",
    keyEnv: "NOKOS_DITZNESIA_API_KEY",
    // 1 kunci akun Ditznesia berlaku untuk API v1 (server 3) DAN v2 (server 4),
    // jadi kalau kunci versi satunya tidak diisi, pakai yang ini juga.
    altKeyEnv: "NOKOS_DITZNESIA_API2_KEY",
    baseEnv: "NOKOS_DITZNESIA_API_URL",
    defaultBase: DITZNESIA_BASE_DEFAULT,
    auth: "query",
  },
  ditznesia_v2: {
    label: "Ditznesia API v2",
    keyEnv: "NOKOS_DITZNESIA_API2_KEY",
    altKeyEnv: "NOKOS_DITZNESIA_API_KEY",
    baseEnv: "NOKOS_DITZNESIA_API2_URL",
    defaultBase: DITZNESIA2_BASE_DEFAULT,
    auth: "query",
    // Host resmi API v2 (api.jasaotp.id) tidak selalu bisa dihubungi — domainnya
    // bisa mati / tidak resolve, sehingga Server 4 gagal "fetch failed". Supaya
    // server tetap jalan, kalau host utama gagal sistem otomatis pindah ke API
    // v1 (api.ditznesia.com/v1) yang memakai KUNCI AKUN YANG SAMA.
    // Owner bisa mengisi host v2 yang benar di NOKOS_DITZNESIA_API2_URL, atau
    // menambah cadangan lain di NOKOS_DITZNESIA_API2_FALLBACK (pisahkan koma).
    fallbackBases: [DITZNESIA_BASE_DEFAULT],
    fallbackEnv: "NOKOS_DITZNESIA_API2_FALLBACK",
  },
};

function providerConfig(provider: string): ResolvedProviderConfig | null {
  const cfg = PROVIDERS[provider as Provider];
  if (!cfg) return null;
  // Satu kunci akun Ditznesia dipakai di API v1 (api.ditznesia.com) dan v2
  // (api.jasaotp.id). Kalau kunci khusus versi ini kosong, pakai kunci versi lain.
  const apiKey = cfg.altKeyEnv ? envKey(cfg.keyEnv, cfg.altKeyEnv) : envKey(cfg.keyEnv);
  const base = (process.env[cfg.baseEnv] || cfg.defaultBase).trim().replace(/\/+$/, "");
  if (!apiKey) return null;
  if (!base) return null;
  const extra = (process.env[cfg.fallbackEnv || ""] || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const fallbackBases = [...new Set([...extra, ...(cfg.fallbackBases || [])].map((b) => b.trim().replace(/\/+$/, "")).filter((b) => b && b !== base))];
  const resolved = { ...cfg, apiKey, base, fallbackBases };
  return isResolved(resolved) ? resolved : null;
}

/** Node KirimKode yang dipakai provider ini (fallback: semua node api1..api10). */
function kirimkodeNodes(cfg: ResolvedProviderConfig): string[] {
  return cfg.nodePool ? cfg.nodePool() : kirimkodeServerCandidates();
}

/** Tambah auth ke URL (Ditznesia: param api_key) atau headers (KirimKode: X-API-Key). */
function withAuth(cfg: ResolvedProviderConfig, url: string): { url: string; headers?: Record<string, string> } {
  if (cfg.auth === "header") {
    return { url, headers: { [cfg.apiKeyHeader || "X-API-Key"]: cfg.apiKey } };
  }
  const sep = url.includes("?") ? "&" : "?";
  return { url: `${url}${sep}api_key=${encodeURIComponent(cfg.apiKey)}` };
}

type ProviderResponse = {
  ok: boolean;
  status: number;
  json: any;
  text: string;
  base: string;
  viaFallback: boolean;
};

/**
 * Kirim permintaan ke provider dengan jalur cadangan.
 *
 * Kalau host utama tidak bisa dihubungi (DNS mati / jaringan gagal = status 0,
 * atau host membalas 404/5xx karena salah host), permintaan otomatis dicoba ke
 * base berikutnya. Ini yang bikin Server 3 & Server 4 tetap hidup walau salah
 * satu domain API provider sedang down.
 */
async function providerFetch(
  cfg: ResolvedProviderConfig,
  path: string,
  init?: RequestInit
): Promise<ProviderResponse> {
  const bases = [cfg.base, ...cfg.fallbackBases].filter(Boolean);
  let last: ProviderResponse = { ok: false, status: 0, json: null, text: "", base: cfg.base, viaFallback: false };
  for (const base of bases) {
    const { url, headers } = withAuth(cfg, `${base}${path}`);
    const merged: RequestInit = { ...(init || {}) };
    if (headers) {
      merged.headers = { ...((init?.headers as Record<string, string>) || {}), ...headers };
    }
    const res = await fetchJson(url, merged);
    last = { ...res, base, viaFallback: base !== cfg.base };
    if (res.ok) return last;
    // Status 0 (host mati), 404 (salah host), atau 5xx -> masih boleh coba cadangan.
    // Kalau host benar tapi membalas 4xx dengan pesan (mis. data tidak ada), stop.
    if (res.status !== 0 && res.status !== 404 && res.status < 500) return last;
  }
  return last;
}

/** KirimKode memakai /order/{id}/status, Ditznesia memakai /sms.php?id_order=... */
export const getOrderStatus = action({
  args: { provider: v.string(), orderId: v.string(), serverLabel: v.optional(v.string()) },
  handler: async (_ctx, args) => {
    const cfg = providerConfig(args.provider);
    const pub = args.serverLabel?.trim() || publicServerName(args.provider);
    if (!cfg) {
      return { ok: false, error: `${pub} belum siap dipakai — kunci/URL server belum diatur.` };
    }
    const id = encodeURIComponent(args.orderId);
    // KirimKode: GET /order/{id}/status. Ditznesia v1/v2: GET /sms.php — docs resmi
    // v2 memakai param `id`; v1 di beberapa versi memakai `id_order`. Dikirim dua-duanya
    // agar kompatibel dengan keduanya (param ekstra diabaikan API).
    const path = cfg.auth === "header" ? `/order/${id}/status` : `/sms.php?id=${id}&id_order=${id}`;
    const { ok, status, json, text, viaFallback } = await providerFetch(cfg, path);
    if (!ok) {
      return { ok: false, error: extractErrorMessage(json, text, `${pub}: HTTP ${status}`) };
    }
    const data = (json && json.data) || json || {};
    const code = data.code ?? data.otp ?? data.sms ?? null;
    const number = extractNumberField(data);
    return { ok: true, provider: pub, orderId: args.orderId, code, number, viaFallback, raw: json };
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
    const { ok, status, json, text, base, viaFallback } = await providerFetch(cfg, path);
    if (!ok) {
      // Khusus endpoint saldo Ditznesia: balance.php memang sering membalas
      // HTTP 500 dari sisi provider walau kunci valid (negara/layanan normal).
      // Pesannya dibuat jelas supaya tidak disangka kunci salah.
      const error =
        status === 500 && cfg.auth !== "header"
          ? `${cfg.label}: saldo tidak bisa dibaca — endpoint saldo provider (balance.php) error HTTP 500. Ini dari sisi provider, bukan kunci API. Cek saldo manual di dashboard provider.`
          : explainHttpFailure(cfg.label, status, json, text, base);
      return { ok: false, error };
    }
    const data = (json && json.data) || json || {};
    const balance = Number(data.balance ?? data.saldo ?? data.saldo_akun);
    return {
      ok: true,
      provider: cfg.label,
      balance: Number.isFinite(balance) ? balance : null,
      viaFallback,
      raw: json,
    };
  },
});

/** Negara dari provider + node asal (khusus KirimKode yang punya banyak node). */
/**
 * Nama server yang boleh dilihat customer (tanpa menyebut nama provider/API).
 * Dipakai kalau pemanggil tidak mengirim nama server spesifik.
 */
function publicServerName(provider: string): string {
  if (provider === "kirimkode") return "Server v1";
  if (provider === "kirimkode_alt") return "Server v2";
  if (provider === "ditznesia") return "Server v3";
  return "Server v4";
}

/**
 * Terjemahkan pesan error mentah provider jadi kalimat Indonesia yang jelas
 * untuk customer ("Failed to create order" dll tidak informatif).
 */
function friendlyProviderError(label: string, raw: string): string {
  const s = (raw || "").toLowerCase();
  if (s.includes("out of stock")) {
    return `${label}: stok nomor untuk layanan ini sedang habis. Coba layanan lain atau beberapa saat lagi.`;
  }
  if (s.includes("failed to create order") || s.includes("gagal")) {
    return `${label}: nomor untuk pilihan ini sedang tidak tersedia. Coba layanan atau server lain.`;
  }
  if (s.includes("insufficient") || s.includes("saldo") || s.includes("balance")) {
    return `${label}: stok toko di server sedang kosong. Kabari admin supaya diisi, lalu coba lagi.`;
  }
  if (s.includes("invalid api key") || s.includes("unauthorized")) {
    return `${label}: kunci server bermasalah. Kabari admin untuk memperbaikinya.`;
  }
  if (s.includes("invalid server")) {
    return `${label}: pilihan server tersebut sedang tidak tersedia.`;
  }
  return raw;
}

type ProviderCountry = {
  id: number | string;
  name: string;
  code: string | null;
  server?: string;
};

/** Daftar negara yang tersedia di provider. */
export const listCountries = action({
  args: {
    provider: v.string(),
    /** Nama server versi customer (mis. "Server v2") untuk pesan error. */
    serverLabel: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const cfg = providerConfig(args.provider);
    const pub = args.serverLabel?.trim() || publicServerName(args.provider);
    if (!cfg) {
      return { ok: false, error: `${pub} belum siap dipakai — kunci/URL server belum diatur.` };
    }
    // KirimKode butuh param server (api1..api10), dan SETIAP node punya daftar
    // negara sendiri-sendiri. Dulu kita cuma pakai node pertama yang menjawab,
    // jadi pilihan negara cuma segelintir. Sekarang semua node diambil lalu
    // digabung supaya pilihan negara maksimal. Node asal tiap negara disimpan
    // di field `server` supaya saat beli nomor dipesan ke node yang benar.
    if (cfg.auth === "header") {
      const results = await Promise.all(
        kirimkodeNodes(cfg).map(async (server) => {
          const { url, headers } = withAuth(cfg, `${cfg.base}/countries?server=${server}`);
          const { ok, status, json, text } = await fetchJson(url, { headers });
          if (!ok || (json && json.success === false)) {
            return { server, error: extractErrorMessage(json, text, `${pub}: HTTP ${status}`), countries: [] as ProviderCountry[] };
          }
          const data = (json && json.data) || [];
          const countries: ProviderCountry[] = Array.isArray(data)
            ? data
                .filter((c: any) => (c.id ?? c.id_negara) != null)
                .map((c: any) => ({
                  id: c.id ?? c.id_negara,
                  name: String(c.name ?? c.nama_negara ?? c.country ?? c.id),
                  code: c.code ?? c.kode ?? null,
                  server,
                }))
            : [];
          return { server, error: "", countries };
        })
      );
      const merged = new Map<string, ProviderCountry>();
      const seenNames = new Set<string>();
      const nodes: string[] = [];
      let lastErr = "";
      for (const r of results) {
        if (r.error) {
          lastErr = r.error;
          continue;
        }
        nodes.push(r.server);
        for (const c of r.countries) {
          const idKey = `${r.server}|${String(c.id)}`;
          // Sebagian node memakai ruang ID dan penamaan sendiri (mis. api1
          // "albana"/id kecil vs api6 "albania"/id besar) — jadi selain ID,
          // nama yang sama juga tidak diduplikasi.
          const nameKey = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (merged.has(idKey) || (nameKey && seenNames.has(nameKey))) continue;
          merged.set(idKey, c);
          if (nameKey) seenNames.add(nameKey);
        }
      }
      if (merged.size === 0) {
        return { ok: false, error: lastErr || `${pub}: semua server gagal.` };
      }
      const countries = [...merged.values()].sort((a, b) => {
        // Indonesia ditaruh paling depan (mayoritas pembeli), sisanya A-Z.
        const rank = (n: string) => (n.toLowerCase().includes("indonesia") ? 0 : 1);
        const ra = rank(a.name);
        const rb = rank(b.name);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
      return { ok: true, provider: cfg.label, countries, nodes, raw: null };
    }
    const { ok, status, json, text, base, viaFallback } = await providerFetch(cfg, "/negara.php");
    if (!ok) {
      return { ok: false, error: explainHttpFailure(pub, status, json, text, base) };
    }
    const data = (json && json.data) || [];
    const countries = Array.isArray(data)
      ? data.map((c: any) => ({
          id: c.id ?? c.id_negara ?? null,
          name: c.name ?? c.nama_negara ?? c.country ?? String(c.id ?? ""),
          code: c.code ?? c.kode ?? null,
        }))
      : [];
    return { ok: true, provider: cfg.label, countries, viaFallback, raw: json };
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

/**
 * Tempelkan harga jual (setelah markup) ke tiap layanan supaya halaman toko dan
 * backend memakai angka yang SAMA — display tidak lagi menghitung sendiri.
 */
function withSellPrices<T extends { price: number }>(services: T[]) {
  return services.map((s) => ({ ...s, sellPrice: computeSellPrice(s.price) }));
}

type FlatService = { id: string | null; name: string | null; service: string | null; price: number; stock: number };

/**
 * Ambil daftar layanan satu negara dari provider (dipakai halaman toko DAN
 * untuk memverifikasi harga asli saat customer membeli).
 */
async function loadProviderServices(
  cfg: ResolvedProviderConfig,
  country: number | string,
  server?: string,
  /** Nama server versi customer untuk pesan error (tanpa nama provider). */
  publicLabel?: string
): Promise<{ ok: boolean; services: FlatService[]; error?: string; note?: string; viaFallback?: boolean; raw?: any }> {
  const label = publicLabel?.trim() || cfg.label;
  const countryEnc = encodeURIComponent(String(country));
  if (cfg.auth === "header") {
    let lastErr = "";
    let reachable = false;
    // Node asal negara dicoba lebih dulu, baru node lain sebagai cadangan.
    const nodeOrder = [...new Set([...(server ? [server] : []), ...kirimkodeNodes(cfg)])];
    for (const node of nodeOrder) {
      const { url, headers } = withAuth(cfg, `${cfg.base}/services?country=${countryEnc}&server=${node}`);
      const { ok, status, json, text } = await fetchJson(url, { headers });
      // HTTP error (401/500/...) = node bermasalah -> coba node lain.
      if (!ok && status >= 400) {
        lastErr = extractErrorMessage(json, text, `${label}: HTTP ${status}`);
        continue;
      }
      // Node menjawab (walau isinya "belum ada layanan") -> API memang hidup.
      reachable = true;
      const data = (json && json.data) || [];
      const services = flattenServices(Array.isArray(data) ? data : []);
      if (services.length === 0) {
        lastErr = `${label}: belum ada layanan untuk negara ini.`;
        continue;
      }
      return { ok: true, services, raw: json };
    }
    // Semua node menjawab tapi negara ini belum punya layanan -> bukan error.
    if (reachable) return { ok: true, services: [], note: lastErr };
    return { ok: false, services: [], error: lastErr || `${label}: semua server gagal.` };
  }
  const { ok, status, json, text, base, viaFallback } = await providerFetch(cfg, `/layanan.php?negara=${countryEnc}`);
  if (!ok) {
    return { ok: false, services: [], error: explainHttpFailure(label, status, json, text, base) };
  }
  const data = (json && json.data) || json || {};
  return { ok: true, services: flattenServices(data), viaFallback, raw: json };
}

/** Daftar layanan untuk sebuah negara di provider. */
export const listServices = action({
  args: {
    provider: v.string(),
    country: v.union(v.number(), v.string()),
    // Node asal negara (dari listCountries) — penting untuk KirimKode.
    server: v.optional(v.string()),
    /** Nama server versi customer (mis. "Server v2") untuk pesan error. */
    serverLabel: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const cfg = providerConfig(args.provider);
    const pub = args.serverLabel?.trim() || publicServerName(args.provider);
    if (!cfg) {
      return { ok: false, error: `${pub} belum siap dipakai — kunci/URL server belum diatur.` };
    }
    const res = await loadProviderServices(cfg, args.country, args.server, pub);
    if (!res.ok) return { ok: false, error: res.error || `${pub}: gagal mengambil layanan.` };
    return {
      ok: true,
      provider: cfg.label,
      services: withSellPrices(res.services),
      viaFallback: res.viaFallback,
      note: res.note,
      raw: res.raw ?? null,
    };
  },
});

/**
 * Harga modal ASLI dari provider untuk satu negara + layanan.
 * Dipakai untuk memastikan customer tidak bisa mengirim harga palsu dari
 * browser (mis. modal Rp 1 supaya bayar Rp 2). Kalau gagal dibaca, kembalikan
 * null dan pembelian memakai harga yang dikirim (perilaku lama).
 */
async function providerPriceFor(
  cfg: ResolvedProviderConfig,
  country: number | string,
  service: number | string,
  server?: string
): Promise<number | null> {
  try {
    if (cfg.auth === "header") {
      // KirimKode: harga dicari di node asal dulu, lalu node lain di pool.
      // Penting supaya harga yang ditagih selalu berasal dari provider (bukan
      // angka kiriman browser), termasuk saat node asal tidak punya kode itu.
      const nodes = [...new Set([(server || "").trim(), ...kirimkodeNodes(cfg)].filter(Boolean))];
      for (const node of nodes) {
        const hit = await serviceOnNode(cfg, node, country, service);
        if (hit) return hit.price;
      }
      return null;
    }
    const res = await loadProviderServices(cfg, country, server);
    if (!res.ok) return null;
    const wanted = String(service).trim().toLowerCase();
    const match = res.services.find((s) => {
      const code = String(s.service ?? s.id ?? "").trim().toLowerCase();
      const name = String(s.name ?? "").trim().toLowerCase();
      return code === wanted || name === wanted || (s.id != null && String(s.id).trim().toLowerCase() === wanted);
    });
    const price = Math.floor(Number(match?.price) || 0);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

type NodeServiceHit = { code: string; price: number; name: string | null };

/**
 * Cari satu layanan di satu node KirimKode tertentu.
 *
 * Penting: KODE layanan tiap node BEDA (mis. node A pakai "ayz#750", node B
 * pakai "ac") walau aplikasinya sama. Jadi kalau kodenya tidak ketemu di node
 * itu, kita cocokkan lewat NAMA layanan (mis. "WhatsApp"). Dengan begitu
 * customer yang memesan satu aplikasi tetap dapat nomor walau node asalnya
 * sedang kehabisan stok, selama node lain punya aplikasi yang sama.
 */
async function serviceOnNode(
  cfg: ResolvedProviderConfig,
  node: string,
  country: number | string,
  code: number | string,
  name?: string | null
): Promise<NodeServiceHit | null> {
  if (cfg.auth !== "header") return null;
  const { url, headers } = withAuth(
    cfg,
    `${cfg.base}/services?country=${encodeURIComponent(String(country))}&server=${node}`
  );
  const { ok, json } = await fetchJson(url, { headers });
  if (!ok) return null;
  const data = (json && json.data) || [];
  const services = flattenServices(Array.isArray(data) ? data : []);
  const wantedCode = String(code).trim().toLowerCase();
  const wantedName = (name || "").trim().toLowerCase();
  const hit =
    services.find((s) => String(s.service ?? s.id ?? "").trim().toLowerCase() === wantedCode) ??
    (wantedName
      ? services.find(
          (s) => String(s.name ?? "").trim().toLowerCase() === wantedName && Number(s.price) > 0
        )
      : undefined);
  if (!hit) return null;
  const price = Math.floor(Number(hit.price) || 0);
  if (price <= 0) return null;
  return { code: String(hit.service ?? hit.id ?? code), price, name: hit.name != null ? String(hit.name) : null };
}

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
  /** Node asal negara (khusus KirimKode: api1..api10). */
  server?: string;
  /**
   * Nama pengganti provider di pesan error (dipakai jalur customer supaya nama
   * provider/API tidak pernah tampil ke pembeli).
   */
  publicLabel?: string;
  /**
   * Batas harga modal yang boleh dibayar toko (harga yang dipakai menghitung
   * harga jual ke customer). Kalau pindah ke node lain, node itu hanya dipakai
   * kalau harga modalnya tidak lebih mahal dari angka ini. 0 = tanpa batas.
   */
  maxProviderPrice?: number;
  extra?: any;
}): Promise<Record<string, unknown>> {
  const cfg = providerConfig(opts.provider);
  // Nama yang dipakai di pesan error: versi customer tidak menyebut provider.
  const label = opts.publicLabel?.trim() || cfg?.label || opts.provider;
  if (!cfg) {
    const needed =
      opts.provider === "kirimkode" || opts.provider === "kirimkode_alt"
        ? "NOKOS_KIRIMKODE_API_KEY"
        : opts.provider === "ditznesia"
          ? "NOKOS_DITZNESIA_API_KEY"
          : "NOKOS_DITZNESIA_API2_KEY atau NOKOS_DITZNESIA_API_KEY (satu kunci akun cukup untuk kedua versi API)";
    return {
      ok: false,
      error: `${label} belum siap dipakai — kunci/URL server belum diatur di Keys/Environment (${needed}).`,
    };
  }

  const providerPrice = Math.max(0, Math.floor(Number(opts.providerPrice) || 0));
  const sellPrice = computeSellPrice(providerPrice);
  const country = String(opts.country);
  const service = String(opts.service);
  const operator = opts.operator != null ? String(opts.operator) : "any";

  let orderId: string | null = null;
  let numberValue: string | null = null;
  let raw: any = null;
  let err: { ok: false; error: string } | null = null;

  if (cfg.auth === "header") {
    // Node asal negara dicoba lebih dulu; kalau node itu tidak bisa memesan
    // (stok habis / nomor tidak tersedia), otomatis dicoba node live berikutnya.
    // Inilah yang membuat Server v1–v4 selalu punya jalur yang benar-benar bisa
    // memesan, bukan cuma tampil sebagai cadangan.
    const nodes = [...new Set([(opts.server || "").trim(), ...kirimkodeNodes(cfg)].filter(Boolean))];
    const maxPrice = Math.max(0, Math.floor(Number(opts.maxProviderPrice) || 0));
    // Nama layanan di node asal — dipakai untuk mencari aplikasi yang sama di
    // node cadangan (kode layanannya berbeda antar node).
    let serviceName: string | null = null;
    if (nodes.length > 1 && maxPrice > 0) {
      const origin = await serviceOnNode(cfg, nodes[0], country, service);
      serviceName = origin?.name ?? null;
    }
    let lastRaw: any = null;
    for (const [idx, server] of nodes.entries()) {
      let serviceForNode = service;
      if (idx > 0 && maxPrice > 0) {
        const hit = await serviceOnNode(cfg, server, country, service, serviceName);
        // Lewati node yang tidak punya aplikasi ini, atau yang modalnya lebih
        // mahal dari harga yang sudah dibayar customer (untung bisa minus).
        if (!hit || hit.price > maxPrice) continue;
        serviceForNode = hit.code;
      }
      const body: Record<string, unknown> = {
        server,
        country,
        service: serviceForNode,
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
      if (json) lastRaw = json;
      err = null;
      orderId = null;
      numberValue = null;
      if (!ok) {
        err = {
          ok: false,
          error: friendlyProviderError(label, extractErrorMessage(json, text, `${label}: HTTP ${status}`)),
        };
      } else {
        raw = json;
        const data = (json && json.data) || json || {};
        if (json && json.success === false) {
          // HTTP 200 tapi server menolak (mis. stok habis).
          err = {
            ok: false,
            error: friendlyProviderError(label, extractErrorMessage(json, text, `${label}: order ditolak server.`)),
          };
        } else {
          orderId = data.id ?? data.order_id ?? data.orderId ?? null;
          numberValue = extractNumberField(data);
          if (!orderId) {
            err = { ok: false, error: `${label}: server tidak mengirim id order.` };
          }
        }
      }
      if (!err && orderId) break;
    }
    if (!raw) raw = lastRaw;
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
    const { ok, status, json, text } = await providerFetch(cfg, `/order.php?${params.toString()}`);
    if (!ok) {
      err = {
        ok: false,
        error: friendlyProviderError(label, explainHttpFailure(label, status, json, text)),
      };
    } else {
      raw = json;
      const data = (json && json.data) || json || {};
      if (json && json.success === false) {
        err = {
          ok: false,
          error: friendlyProviderError(label, extractErrorMessage(json, text, `${label}: order ditolak server.`)),
        };
      } else {
        orderId =
          data.id ??
          data.id_order ??
          data.order_id ??
          data.orderId ??
          data.trx_id ??
          null;
        numberValue = extractNumberField(data);
      }
    }
  }

  if (err) return err;

  if (!orderId) {
    const text = raw ? JSON.stringify(raw).slice(0, 300) : "(kosong)";
    return {
      ok: false,
      error: `${label} menjawab sukses tapi tidak ada id order. Respons: ${text}`,
    };
  }

  return {
    ok: true,
    provider: cfg.label,
    orderId: String(orderId),
    providerPrice,
    sellPrice,
    number: numberValue,
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
    server: v.optional(v.string()),
    /** Batas harga modal saat pindah jalur (0/kosong = tanpa batas). */
    maxProviderPrice: v.optional(v.number()),
    extra: v.optional(v.any()),
  },
  handler: async (_ctx, args) => placeProviderOrder(args),
});

/* =====================================================================
 * AKUN & SALDO CUSTOMER (login email+password, deposit QR Paymentku,
 * beli dipotong dari saldo, gagal otomatis refund ke saldo)
 * ===================================================================== */

/** Daftar akun customer sendiri (email = username, opsional kode undangan teman). */
export const registerCustomer = action({
  args: {
    email: v.string(),
    password: v.string(),
    fullName: v.optional(v.string()),
    refCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return ctx.runMutation(I.wallet.registerCustomer, {
      email: args.email,
      password: args.password,
      fullName: args.fullName ?? undefined,
      refCode: args.refCode ?? undefined,
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
      channel: "paymentku",
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
    /** Node asal negara (khusus KirimKode: api1..api10). */
    server: v.optional(v.string()),
    /** Nama server versi customer (mis. "Server v1") untuk riwayat transaksi. */
    serverLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let providerPrice = Math.max(0, Math.floor(Number(args.providerPrice) || 0));
    // Anti-manipulasi harga: kalau harga asli provider bisa dibaca, itu yang dipakai.
    // Browser tidak lagi bisa mengirim "modal Rp 1" supaya bayar Rp 2.
    const cfgBuy = providerConfig(args.provider);
    if (cfgBuy) {
      const live = await providerPriceFor(cfgBuy, args.country, args.service, args.server);
      if (live != null) providerPrice = live;
    }
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
      server: args.server,
      publicLabel: args.serverLabel?.trim() || "Server",
      // Pengaman untung: pindah jalur hanya boleh ke node dengan modal yang
      // tidak lebih mahal dari harga yang dipakai menghitung tagihan customer.
      maxProviderPrice: providerPrice,
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
      serverLabel: args.serverLabel ?? undefined,
      country: String(args.country),
      countryName: args.countryName ?? undefined,
      service: String(args.service),
      serviceName: args.serviceName ?? undefined,
      orderId: String(order.orderId),
      sellPrice,
      providerPrice,
      number: (order as any).number ?? undefined,
    });

    // #5 — cek OTP otomatis di latar belakang sampai masuk (±10 menit),
    // jalan terus walau customer menutup halaman.
    try {
      await ctx.scheduler.runAfter(20_000, I.otpWatch.watchOtp, {
        orderId: String(order.orderId),
        attempts: 0,
      });
    } catch {
      /* jadwal gagal — halaman customer tetap bisa cek manual */
    }

    return {
      ok: true,
      orderId: String(order.orderId),
      provider: order.provider,
      sellPrice,
      balance: charge.balance,
      number: (order as any).number ?? null,
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
async function providerFetchCode(
  cfg: ResolvedProviderConfig,
  orderId: string
): Promise<{ code: string | null; number: string | null; raw: any }> {
  const id = encodeURIComponent(orderId);
  const path = cfg.auth === "header" ? `/order/${id}/status` : `/sms.php?id=${id}&id_order=${id}`;
  const { ok, json } = await providerFetch(cfg, path);
  if (!ok) return { code: null, number: null, raw: json };
  const data = (json && json.data) || json || {};
  const code = data.code ?? data.otp ?? data.sms ?? null;
  const number = extractNumberField(data);
  return {
    code: code != null && String(code) !== "" ? String(code) : null,
    number,
    raw: json,
  };
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
  const { ok, status, json, text } = await providerFetch(cfg, `/cancel.php?id=${id}&id_order=${id}`);
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
        await ctx.runMutation(I.wallet.setOrderResult, {
          orderId: row.orderId,
          otp: live.code,
          number: live.number || undefined,
          status: "otp",
        });
        return { ok: false, error: "OTP sudah masuk — tidak bisa refund.", otp: live.code };
      }
      if (live.number && !row.number) {
        await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, number: live.number });
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
        await ctx.runMutation(I.wallet.setOrderResult, {
          orderId: row.orderId,
          otp: live.code,
          number: live.number || undefined,
          status: "otp",
        });
        return { ok: false, error: "OTP sudah masuk — tidak bisa dibatalkan/direfund.", otp: live.code };
      }
      if (live.number && !row.number) {
        await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, number: live.number });
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
      await ctx.runMutation(I.wallet.setOrderResult, {
        orderId: row.orderId,
        otp: live.code,
        number: live.number || undefined,
        status: "otp",
      });
      return { ok: true, status: "otp", otp: live.code, number: live.number || row.number || null };
    }
    if (live.number && !row.number) {
      await ctx.runMutation(I.wallet.setOrderResult, { orderId: row.orderId, number: live.number });
    }
    return { ok: true, status: row.status, otp: null, number: row.number || live.number || null, raw: live.raw };
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

/* =====================================================================
 * METODE PEMBAYARAN (QRIS Paymentku otomatis + Isi Manual QR/Bank/E-Wallet)
 *
 * Pengaturan disimpan di nokosSettings:
 *   paykuEnabled : boolean — tampilkan/tutup Paymentku QRIS otomatis
 *   payMethods   : [{ id, type, label, accountName, accountNo, imageUrl?, enabled }]
 * ===================================================================== */

type PayMethodType = "qr" | "bank" | "ewallet";

type PayMethod = {
  id: string;
  type: PayMethodType;
  label: string;
  accountName: string;
  accountNo: string;
  imageUrl?: string;
  /** Gambar QR yang diunggah owner — disimpan di Convex storage. */
  imageStorageId?: string;
  enabled: boolean;
};

const PAY_TYPE_LABEL: Record<string, string> = {
  qr: "QR",
  bank: "Transfer Bank",
  ewallet: "E-Wallet",
};

function makeMethodId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 6)
      : Math.random().toString(36).slice(2, 8);
  return `pay-${rand.toUpperCase()}`;
}

async function readPayConfig(ctx: any): Promise<{ paykuEnabled: boolean; methods: PayMethod[] }> {
  const map = await ctx.runQuery(I.wallet.getSettings, {});
  const paykuEnabled = map["paykuEnabled"] !== false;
  const raw = map["payMethods"];
  const methods: PayMethod[] = Array.isArray(raw)
    ? (raw as PayMethod[]).filter((m) => m && typeof m === "object" && m.id)
    : [];
  // Gambar QR yang diunggah owner disimpan sebagai storageId — resolve jadi URL publik.
  for (const m of methods) {
    if (m.imageStorageId) {
      try {
        const url = await ctx.storage.getUrl(m.imageStorageId);
        if (url) m.imageUrl = url;
      } catch {
        /* biarkan imageUrl lama */
      }
    }
  }
  return { paykuEnabled, methods };
}

function sanitizeMethod(input: {
  id?: string;
  type?: string;
  label?: string;
  accountName?: string;
  accountNo?: string;
  imageUrl?: string;
  imageStorageId?: string;
  enabled?: boolean;
}): { method?: PayMethod; error?: string } {
  const type = (input.type || "qr").toLowerCase();
  if (!["qr", "bank", "ewallet"].includes(type)) {
    return { error: "Jenis metode harus QR / Bank / E-Wallet." };
  }
  const label = (input.label || "").trim();
  const accountName = (input.accountName || "").trim();
  const accountNo = (input.accountNo || "").trim();
  const imageStorageId = (input.imageStorageId || "").trim();
  const imageUrl = (input.imageUrl || "").trim();
  if (type === "qr") {
    // QR cukup nama + gambar QR (atau nama pemilik); nomor tidak wajib.
    if (!label || (!accountName && !accountNo && !imageStorageId && !imageUrl)) {
      return { error: "Lengkapi nama metode, lalu unggah gambar QR atau isi nama pemilik." };
    }
  } else if (!label || !accountName || !accountNo) {
    return { error: "Lengkapi nama metode, nama pemilik, dan nomor/tujuan." };
  }
  const method: PayMethod = {
    id: (input.id || "").trim() || makeMethodId(),
    type: type as PayMethodType,
    label: label.slice(0, 60),
    accountName: accountName.slice(0, 80),
    accountNo: accountNo.slice(0, 120),
    enabled: input.enabled !== false,
  };
  if (imageUrl) {
    method.imageUrl = imageUrl.slice(0, 500);
  }
  if (imageStorageId) {
    method.imageStorageId = imageStorageId;
  }
  return { method };
}

/** Pengaturan pembayaran publik — hanya yang AKTIF dikirim ke halaman beli. */
export const getPaymentConfig = action({
  args: {},
  handler: async (ctx) => {
    const { paykuEnabled, methods } = await readPayConfig(ctx);
    const active = methods.filter((m) => m.enabled);
    return { ok: true, paykuEnabled, methods: active };
  },
});

/** Pengaturan pembayaran lengkap (khusus Owner — termasuk metode yang disembunyikan). */
export const adminPaymentConfig = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    const { paykuEnabled, methods } = await readPayConfig(ctx);
    return { ok: true, paykuEnabled, methods };
  },
});

/** Owner menyiapkan URL upload gambar QR (disimpan di Convex storage). */
export const getImageUploadUrl = action({
  args: { actorId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    const uploadUrl = await ctx.storage.generateUploadUrl();
    return { ok: true, uploadUrl };
  },
});

/** Owner menampilkan/menyembunyikan menu Paymentku QRIS (logika gateway tidak diubah). */
export const adminSetPaymentkuEnabled = action({
  args: { actorId: v.id("appUsers"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    await ctx.runMutation(I.wallet.setSettings, { key: "paykuEnabled", value: args.enabled });
    return { ok: true, paykuEnabled: args.enabled };
  },
});

/** Owner menambah / memperbarui metode isi manual (QR/Bank/E-Wallet). */
export const adminSavePaymentMethod = action({
  args: {
    actorId: v.id("appUsers"),
    id: v.optional(v.string()),
    type: v.string(),
    label: v.string(),
    accountName: v.string(),
    accountNo: v.string(),
    imageUrl: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    const { paykuEnabled, methods } = await readPayConfig(ctx);
    const { method, error } = sanitizeMethod({
      id: args.id ?? undefined,
      type: args.type,
      label: args.label,
      accountName: args.accountName,
      accountNo: args.accountNo,
      imageUrl: args.imageUrl ?? undefined,
      imageStorageId: args.imageStorageId ?? undefined,
      enabled: true,
    });
    if (error || !method) return { ok: false, error: error || "Metode tidak valid." };
    const idx = methods.findIndex((m) => m.id === method.id);
    if (idx >= 0) {
      const old = methods[idx];
      // Ganti gambar lama yang diunggah kalau diganti dengan yang baru.
      if (old.imageStorageId && old.imageStorageId !== method.imageStorageId) {
        try {
          await ctx.storage.delete(old.imageStorageId);
        } catch {
          /* best-effort */
        }
      }
      methods[idx] = { ...old, ...method, id: old.id, enabled: args.id ? old.enabled : true };
    } else {
      methods.push(method);
    }
    await ctx.runMutation(I.wallet.setSettings, { key: "payMethods", value: methods });
    return { ok: true, method, methods };
  },
});

/** Owner menyalakan/mematikan satu metode isi manual. */
export const adminTogglePaymentMethod = action({
  args: { actorId: v.id("appUsers"), id: v.string(), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    const { paykuEnabled, methods } = await readPayConfig(ctx);
    const m = methods.find((x) => x.id === args.id);
    if (!m) return { ok: false, error: "Metode tidak ditemukan." };
    m.enabled = args.enabled;
    await ctx.runMutation(I.wallet.setSettings, { key: "payMethods", value: methods });
    return { ok: true, method: m, methods };
  },
});

/** Owner menghapus metode isi manual. */
export const adminDeletePaymentMethod = action({
  args: { actorId: v.id("appUsers"), id: v.string() },
  handler: async (ctx, args) => {
    const actor = await ownerActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Khusus Owner." };
    const { paykuEnabled, methods } = await readPayConfig(ctx);
    const removed = methods.find((x) => x.id === args.id);
    if (removed?.imageStorageId) {
      try {
        await ctx.storage.delete(removed.imageStorageId);
      } catch {
        /* best-effort */
      }
    }
    const next = methods.filter((x) => x.id !== args.id);
    await ctx.runMutation(I.wallet.setSettings, { key: "payMethods", value: next });
    return { ok: true, methods: next };
  },
});

/**
 * Customer kirim permintaan isi saldo MANUAL (sudah transfer lewat QR/Bank/
 * E-Wallet). Saldo masuk SETELAH admin/CS mencocokkan & menekan "Terima".
 */
export const manualDepositCreate = action({
  args: {
    userId: v.id("appUsers"),
    amount: v.number(),
    methodId: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.runQuery(I.wallet.wallet, { userId: args.userId });
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    const { methods } = await readPayConfig(ctx);
    const method = methods.find((m) => m.id === args.methodId && m.enabled);
    if (!method) return { ok: false, error: "Metode pembayaran tidak aktif. Pilih metode lain atau hubungi CS." };
    const amount = Math.max(5000, Math.floor(args.amount));
    if (amount > 100_000_000) return { ok: false, error: "Nominal terlalu besar." };
    const referenceId = makeReferenceId("MNL");
    const typeLabel = PAY_TYPE_LABEL[method.type] || method.type;
    const methodDetail = [method.accountNo, method.accountName ? `a.n. ${method.accountName}` : ""]
      .filter(Boolean)
      .join(" · ");
    await ctx.runMutation(I.wallet.recordDeposit, {
      userId: args.userId,
      referenceId,
      amount,
      channel: "manual",
      methodId: method.id,
      methodLabel: `${method.label} (${typeLabel})`,
      methodDetail,
      note: (args.note || "").trim().slice(0, 200) || undefined,
    });
    return {
      ok: true,
      referenceId,
      amount,
      methodLabel: method.label,
      methodDetail,
    };
  },
});

/**
 * Admin/CS mencocokkan pembayaran manual lalu menekan TERIMA — saldo masuk.
 * Hanya bisa untuk deposit manual yang masih pending (bukan QRIS otomatis).
 */
export const adminDepositSettle = action({
  args: { actorId: v.id("appUsers"), referenceId: v.string() },
  handler: async (ctx, args) => {
    const actor = await staffActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Akses khusus Owner/CS." };
    const dep: any = await ctx.runQuery(I.wallet.depositByReference, { referenceId: args.referenceId });
    if (!dep) return { ok: false, error: "Deposit tidak ditemukan." };
    if (dep.status !== "pending") {
      return { ok: false, error: dep.status === "paid" ? "Deposit sudah lunas." : "Deposit ini bukan menunggu konfirmasi." };
    }
    if (dep.channel !== "manual") {
      return { ok: false, error: "Deposit QRIS otomatis tidak perlu disetujui manual — cek pembayarannya lewat tombol Cek Lagi." };
    }
    const res = await ctx.runMutation(I.wallet.settleDeposit, { referenceId: args.referenceId });
    if (!res.ok) return { ok: false, error: res.error || "Gagal menyetujui deposit." };
    return { ok: true, amount: dep.amount, balance: res.balance, bonus: res.bonus };
  },
});

/** Admin/CS menolak deposit manual (mis. bukti tidak cocok). */
export const adminDepositReject = action({
  args: { actorId: v.id("appUsers"), referenceId: v.string() },
  handler: async (ctx, args) => {
    const actor = await staffActor(ctx, args.actorId);
    if (!actor) return { ok: false, error: "Akses khusus Owner/CS." };
    const dep: any = await ctx.runQuery(I.wallet.depositByReference, { referenceId: args.referenceId });
    if (!dep) return { ok: false, error: "Deposit tidak ditemukan." };
    if (dep.status !== "pending") {
      return { ok: false, error: dep.status === "paid" ? "Deposit sudah lunas — tidak bisa ditolak." : "Deposit ini bukan menunggu konfirmasi." };
    }
    if (dep.channel !== "manual") {
      return { ok: false, error: "Deposit QRIS otomatis tidak memakai menu tolak manual." };
    }
    const res = await ctx.runMutation(I.wallet.rejectDeposit, { referenceId: args.referenceId });
    return res.ok ? { ok: true } : { ok: false, error: res.error || "Gagal menolak deposit." };
  },
});
