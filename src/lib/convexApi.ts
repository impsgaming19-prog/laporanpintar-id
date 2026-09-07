/**
 * Klien tipis ke fungsi backend Convex (di-deploy sebagai HTTP action).
 *
 * Alasan: hosting web ini statis, jadi semua panggilan ke Paymentku dan ke
 * server provider (KirimKode/Ditznesia) harus lewat backend. Backend toko
 * ada di `convex/shop.ts` dan dipanggil lewat HTTP action Convex:
 *   POST https://<deployment>.convex.cloud/api/action
 *   body: { path: "shop:namaFungsi", format: "json", args: {...} }
 */

const CONVEX_URL = "https://glorious-ladybug-353.convex.cloud";

export type ProviderId = "kirimkode" | "ditznesia" | "ditznesia_v2";

export type PaymentResult = {
  ok: boolean;
  referenceId?: string;
  trxId?: string | null;
  amount?: number;
  payUrl?: string;
  paymentInfo?: Record<string, unknown>;
  error?: string;
};

export type CheckPaymentResult = {
  ok: boolean;
  referenceId?: string;
  status?: string;
  paid?: boolean;
  data?: Record<string, unknown>;
  error?: string;
};

export type Country = { id: number | string | null; name: string; code?: string | null };

export type Service = {
  id: number | string | null;
  name: string | null;
  service?: string | null;
  price: number;
  stock: number;
};

export type OrderResult = {
  ok: boolean;
  provider?: string;
  orderId?: string | null;
  providerPrice?: number;
  sellPrice?: number;
  raw?: unknown;
  error?: string;
};

const BACKEND_NOT_DEPLOYED =
  "Backend toko belum aktif (fungsi transaksi belum ter-deploy). Hubungi pemilik/admin agar backend dinyalakan — data & pembayaran baru bisa jalan setelah itu.";

async function callAction<T = unknown>(path: string, args: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${CONVEX_URL}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, format: "json", args }),
      // Jangan biarkan permintaan menggantung tanpa batas.
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(25000) : undefined,
    });
  } catch (err: any) {
    const aborted = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new Error(
      aborted
        ? "Server backend terlalu lama merespons. Coba lagi sebentar lagi."
        : "Tidak bisa menghubungi server backend. Cek koneksi internet."
    );
  }

  let payload: any = null;
  const text = await res.text().catch(() => "");
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }

  // Convex membalas error (fungsi tidak ada, dll) dengan HTTP 200 + envelope
  // { status: "error", errorMessage } — bukan HTTP 4xx/5xx. Cek dua-duanya.
  const isEnvelopeError = payload && payload.status === "error";
  if (!res.ok || isEnvelopeError) {
    const rawMsg = payload && (payload.errorMessage || payload.message || payload.error);
    const msg = String(rawMsg || "");
    if (
      res.status === 404 ||
      /could not find public function|does not exist/i.test(msg) ||
      /Server Error/i.test(msg)
    ) {
      throw new Error(BACKEND_NOT_DEPLOYED);
    }
    throw new Error(msg || `Backend menjawab HTTP ${res.status}`);
  }

  return (payload?.result ?? payload ?? {}) as T;
}

/** Buat invoice Paymentku (QRIS). */
export async function apiCreatePayment(opts: {
  amount: number;
  description?: string;
}): Promise<PaymentResult> {
  return callAction<PaymentResult>("shop:createPayment", {
    amount: opts.amount,
    description: opts.description || "Pembayaran KAKO NOKOS",
  });
}

/** Cek status pembayaran Paymentku sampai lunas. */
export async function apiCheckPayment(referenceId: string): Promise<CheckPaymentResult> {
  return callAction<CheckPaymentResult>("shop:checkPayment", { referenceId });
}

/** Polling status pembayaran: balik true saat lunas / false saat timeout. */
export async function apiWaitPaid(
  referenceId: string,
  maxTries = 20,
  intervalMs = 4000
): Promise<boolean> {
  for (let i = 0; i < maxTries; i++) {
    const r = await apiCheckPayment(referenceId);
    if (r.ok && r.paid) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** Daftar negara dari server provider. */
export async function apiListCountries(provider: ProviderId): Promise<Country[]> {
  const r = await callAction<{ ok?: boolean; countries?: Country[]; error?: string }>(
    "shop:listCountries",
    { provider }
  );
  if (!r.ok || !Array.isArray(r.countries)) {
    throw new Error(r.error || "Gagal mengambil daftar negara dari server.");
  }
  return r.countries;
}

/** Daftar layanan untuk satu negara dari server provider. */
export async function apiListServices(
  provider: ProviderId,
  country: number | string
): Promise<Service[]> {
  const r = await callAction<{ ok?: boolean; services?: Service[]; error?: string }>(
    "shop:listServices",
    { provider, country }
  );
  if (!r.ok || !Array.isArray(r.services)) {
    throw new Error(r.error || "Gagal mengambil daftar layanan dari server.");
  }
  return r.services;
}

/** Pesan nomor dari server provider. */
export async function apiCreateNumberOrder(opts: {
  provider: ProviderId;
  country: number | string;
  service: number | string;
  providerPrice: number;
  operator?: number | string;
}): Promise<OrderResult> {
  return callAction<OrderResult>("shop:createNumberOrder", {
    provider: opts.provider,
    country: opts.country,
    service: opts.service,
    providerPrice: opts.providerPrice,
    operator: opts.operator ?? "any",
  });
}

/** Ambil OTP / status order. */
export async function apiGetOrderStatus(provider: ProviderId, orderId: string): Promise<{
  ok?: boolean;
  code?: string | number | null;
  error?: string;
  raw?: unknown;
}> {
  return callAction("shop:getOrderStatus", { provider, orderId });
}

/** Harga jual = harga provider + 30% (harus sama dengan hitungan backend). */
export function computeSellPrice(providerPrice: number): number {
  const base = Math.max(0, Math.floor(Number(providerPrice) || 0));
  return Math.max(0, Math.round(base * 1.3));
}

export function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}
