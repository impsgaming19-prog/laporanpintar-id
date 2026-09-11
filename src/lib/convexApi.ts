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

export type Country = {
  id: number | string | null;
  name: string;
  code?: string | null;
  /** Node asal negara (khusus KirimKode: api1..api10) — dipakai saat beli nomor. */
  server?: string | null;
};

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

  // Respons sukses HTTP action Convex dibungkus envelope { status: "success", value: ... }.
  // Hasil aslinya ada di `value` — kalau kode membaca `result`, hasilnya selalu undefined
  // dan halaman menampilkan error palsu walau backend sehat. Ambil `value` dulu.
  if (payload && typeof payload === "object" && payload.status === "success" && "value" in payload) {
    return payload.value as T;
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
/** Sama seperti apiListCountries, tapi ikut memberi tahu apakah data diambil dari jalur cadangan. */
export async function apiListCountriesMeta(
  provider: ProviderId
): Promise<{ countries: Country[]; viaFallback: boolean }> {
  const r = await callAction<{ ok?: boolean; countries?: Country[]; viaFallback?: boolean; error?: string }>(
    "shop:listCountries",
    { provider }
  );
  if (!r.ok || !Array.isArray(r.countries)) {
    throw new Error(r.error || "Gagal mengambil daftar negara dari server.");
  }
  return { countries: r.countries, viaFallback: Boolean(r.viaFallback) };
}

export async function apiListCountries(provider: ProviderId): Promise<Country[]> {
  return (await apiListCountriesMeta(provider)).countries;
}

/** Daftar layanan untuk satu negara dari server provider. */
export async function apiListServices(
  provider: ProviderId,
  country: number | string,
  server?: string | null
): Promise<Service[]> {
  const r = await callAction<{ ok?: boolean; services?: Service[]; error?: string }>(
    "shop:listServices",
    { provider, country, ...(server ? { server } : {}) }
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
  number?: string | null;
  error?: string;
  raw?: unknown;
}> {
  return callAction("shop:getOrderStatus", { provider, orderId });
}

/* =====================================================================
 * AKUN & SALDO (login email+password, deposit QR, beli potong saldo)
 * ===================================================================== */

export type ShopUser = {
  id: string;
  username: string;
  fullName: string;
  role: string;
};

export type ShopOrder = {
  id: string;
  provider: string;
  providerLabel: string;
  countryName: string;
  serviceName: string;
  orderId: string;
  sellPrice: number;
  status: string;
  otp: string | null;
  number: string | null;
  error: string | null;
  createdAt: number;
};

/** Daftar akun customer (email + password, opsional kode undangan teman). */
export async function apiShopRegister(opts: {
  email: string;
  password: string;
  fullName?: string;
  refCode?: string;
}): Promise<{ success: boolean; id?: string; refCode?: string; error?: string }> {
  return callAction<{ success: boolean; id?: string; refCode?: string; error?: string }>("shop:registerCustomer", {
    email: opts.email,
    password: opts.password,
    fullName: opts.fullName ?? undefined,
    refCode: opts.refCode ?? undefined,
  });
}

/** Login email + password. */
export async function apiShopLogin(
  username: string,
  password: string
): Promise<{ ok: boolean; user?: ShopUser; error?: string }> {
  return callAction<{ ok: boolean; user?: ShopUser; error?: string }>("shop:loginCustomer", {
    username,
    password,
  });
}

/** Info saldo customer. */
export async function apiShopWallet(userId: string): Promise<{
  ok: boolean;
  wallet?: { balance: number; username: string; fullName: string };
  error?: string;
}> {
  return callAction("shop:getWallet", { userId });
}

/** Riwayat order customer. */
export async function apiShopOrders(userId: string): Promise<{
  ok: boolean;
  orders?: ShopOrder[];
  error?: string;
}> {
  return callAction("shop:listMyOrders", { userId });
}

/** Buat invoice deposit (QR Paymentku). */
export async function apiShopDepositCreate(
  userId: string,
  amount: number
): Promise<{ ok: boolean; referenceId?: string; amount?: number; payUrl?: string; error?: string }> {
  return callAction("shop:depositCreate", { userId, amount });
}

/** Cek status deposit & kredit saldo otomatis. */
export async function apiShopDepositPoll(referenceId: string): Promise<{
  ok: boolean;
  paid?: boolean;
  status?: string;
  balance?: number;
  error?: string;
}> {
  return callAction("shop:depositPoll", { referenceId });
}

/** Beli nomor potong saldo (gagal = saldo dikembalikan otomatis). */
export async function apiShopBuyWithBalance(opts: {
  userId: string;
  provider: ProviderId;
  country: number | string;
  service: number | string;
  providerPrice: number;
  countryName?: string;
  serviceName?: string;
  operator?: number | string;
  /** Node asal negara (khusus KirimKode). */
  server?: string | null;
}): Promise<{
  ok: boolean;
  orderId?: string | null;
  provider?: string;
  sellPrice?: number;
  balance?: number;
  number?: string | null;
  refunded?: boolean;
  error?: string;
}> {
  return callAction("shop:buyWithBalance", {
    userId: opts.userId,
    provider: opts.provider,
    country: opts.country,
    service: opts.service,
    providerPrice: opts.providerPrice,
    countryName: opts.countryName ?? undefined,
    serviceName: opts.serviceName ?? undefined,
    operator: opts.operator ?? "any",
    ...(opts.server ? { server: opts.server } : {}),
  });
}

/**
 * Harga jual = harga provider / (1 - 0,30), jadi keuntungan = 30% dari
 * HARGA JUAL (bukan dari harga provider). Harus sama dengan hitungan backend
 * (NOKOS_MARKUP_PCT = 30 -> 1 - 0,30 = 0,7).
 */
export function computeSellPrice(providerPrice: number): number {
  const base = Math.max(0, Math.floor(Number(providerPrice) || 0));
  return Math.max(0, Math.round(base / 0.7));
}

/* =====================================================================
 * OWNER & CS (panel admin) + aturan cancel/refund
 * ===================================================================== */

/** Daftar akun Owner pertama — kode rahasia dikirim ke server, tidak disimpan. */
export async function apiShopRegisterOwner(opts: {
  email: string;
  password: string;
  fullName?: string;
  code: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  return callAction<{ ok: boolean; id?: string; error?: string }>("shop:registerOwner", {
    email: opts.email,
    password: opts.password,
    fullName: opts.fullName ?? undefined,
    code: opts.code,
  });
}

/** Owner membuat akun CS. */
export async function apiShopCreateStaff(opts: {
  actorId: string;
  username: string;
  password: string;
  fullName: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  return callAction("shop:createStaff", {
    actorId: opts.actorId,
    username: opts.username,
    password: opts.password,
    fullName: opts.fullName,
  });
}

/** Owner menghapus akun CS. */
export async function apiShopDeleteStaff(actorId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  return callAction("shop:deleteStaff", { actorId, userId });
}

/** Owner mengganti nama/email/password akunnya sendiri (cek password lama). */
export async function apiOwnerUpdateLogin(opts: {
  userId: string;
  currentPassword: string;
  newUsername?: string;
  newPassword?: string;
  newFullName?: string;
}): Promise<{ ok: boolean; error?: string }> {
  return callAction("shop:ownerUpdateLogin", {
    userId: opts.userId,
    currentPassword: opts.currentPassword,
    newUsername: opts.newUsername ?? undefined,
    newPassword: opts.newPassword ?? undefined,
    newFullName: opts.newFullName ?? undefined,
  });
}

export type AdminUser = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  balance: number;
  createdAt: number;
  createdBy?: string;
  lastLoginAt?: number | null;
};

export type AdminDeposit = {
  id: string;
  userId: string;
  username: string;
  fullName: string;
  referenceId: string;
  amount: number;
  status: string;
  channel?: string;
  methodLabel?: string | null;
  methodDetail?: string | null;
  note?: string | null;
  createdAt: number;
  paidAt: number | null;
};

export type AdminOrder = ShopOrder & {
  userId: string;
  username: string;
  fullName: string;
  providerPrice: number;
};

export type AdminStats = {
  userCount: number;
  customerCount: number;
  staffCount: number;
  ownerCount: number;
  orderCount: number;
  activeOrderCount: number;
  soldTotal: number;
  profitGross?: number;
  totalBalance: number;
  depositCount: number;
  depositTotal: number;
  depositPending: number;
  refundCount: number;
  refundTotal: number;
  statusBreakdown?: Record<string, number>;
};

export type ProviderStatusRow = {
  key: string;
  label: string;
  configured: boolean;
  balance: number | null;
  error?: string;
};

export type ShopConfig = { feePct: number; siteName?: string };

/** Baca pengaturan publik toko (fee Paymentku dll). */
export async function apiShopGetConfig(): Promise<{ ok: boolean; config?: ShopConfig; error?: string }> {
  return callAction("otpWatch:getShopConfig", {});
}

/** Owner menyimpan fee Paymentku (persen). */
export async function apiShopSetConfig(
  actorId: string,
  feePct: number
): Promise<{ ok: boolean; feePct?: number; error?: string }> {
  return callAction("otpWatch:setShopConfig", { actorId, feePct });
}

/** Cek saldo provider (khusus Owner). */
export async function apiProviderMonitor(
  actorId: string
): Promise<{ ok: boolean; providers?: ProviderStatusRow[]; checkedAt?: number; error?: string }> {
  return callAction("otpWatch:providerMonitor", { actorId });
}

export type PromoEntry = {
  code: string;
  nominal: number;
  kuota: number;
  used: number;
  createdAt: number;
};

/** Daftar kode promo (khusus Owner). */
export async function apiPromoList(
  actorId: string
): Promise<{ ok: boolean; promos?: PromoEntry[]; error?: string }> {
  return callAction("otpWatch:promoList", { actorId });
}

/** Owner membuat kode promo (kode + nominal saldo + kuota). */
export async function apiPromoCreate(
  actorId: string,
  code: string,
  nominal: number,
  kuota: number
): Promise<{ ok: boolean; code?: string; error?: string }> {
  return callAction("otpWatch:promoCreate", { actorId, code, nominal, kuota });
}

/** Owner menghapus kode promo. */
export async function apiPromoDelete(actorId: string, code: string): Promise<{ ok: boolean; error?: string }> {
  return callAction("otpWatch:promoDelete", { actorId, code });
}

/** Cek kode promo valid tanpa menukar. */
export async function apiPromoValidate(code: string): Promise<{
  ok: boolean;
  code?: string;
  nominal?: number;
  kuota?: number;
  used?: number;
  error?: string;
}> {
  return callAction("otpWatch:promoValidate", { code });
}

/** Customer menukar kode promo -> saldo langsung masuk. */
export async function apiPromoRedeem(
  userId: string,
  code: string
): Promise<{ ok: boolean; nominal?: number; balance?: number; error?: string }> {
  return callAction("otpWatch:promoRedeem", { userId, code });
}

/** Info kode undangan & bonus referral akun sendiri. */
export async function apiMyReferral(userId: string): Promise<{
  ok: boolean;
  refCode?: string;
  referredBy?: string;
  referralBonusAt?: number | null;
  error?: string;
}> {
  return callAction("otpWatch:myReferral", { userId });
}

/** Statistik panel admin. */
export async function apiAdminStats(actorId: string): Promise<{ ok: boolean; stats?: AdminStats; error?: string }> {
  return callAction("shop:adminStats", { actorId });
}

/** Daftar semua akun (owner/cs). */
export async function apiAdminListUsers(actorId: string): Promise<{ ok: boolean; users?: AdminUser[]; error?: string }> {
  return callAction("shop:adminListUsers", { actorId });
}

/** Ubah saldo customer (amount positif/negatif). */
export async function apiAdminAdjustBalance(
  actorId: string,
  userId: string,
  amount: number
): Promise<{ ok: boolean; balance?: number; error?: string }> {
  return callAction("shop:adminAdjustBalance", { actorId, userId, amount });
}

/** Riwayat order semua customer. */
export async function apiAdminOrders(actorId: string): Promise<{ ok: boolean; orders?: AdminOrder[]; error?: string }> {
  return callAction("shop:adminOrders", { actorId });
}

/** Riwayat deposit customer (khusus Owner). */
export async function apiAdminDeposits(actorId: string): Promise<{ ok: boolean; deposits?: AdminDeposit[]; error?: string }> {
  return callAction("shop:adminDeposits", { actorId });
}

export type PayMethodType = "qr" | "bank" | "ewallet";

export type PayMethod = {
  id: string;
  type: PayMethodType;
  label: string;
  accountName: string;
  accountNo: string;
  imageUrl?: string;
  imageStorageId?: string;
  enabled: boolean;
};

/** Pengaturan pembayaran publik (hanya yang aktif): QRIS Paymentku + metode isi manual. */
export async function apiGetPaymentConfig(): Promise<{
  ok: boolean;
  paykuEnabled?: boolean;
  methods?: PayMethod[];
  error?: string;
}> {
  return callAction("shop:getPaymentConfig", {});
}

/** Pengaturan pembayaran lengkap untuk panel Owner. */
export async function apiAdminPaymentConfig(actorId: string): Promise<{
  ok: boolean;
  paykuEnabled?: boolean;
  methods?: PayMethod[];
  error?: string;
}> {
  return callAction("shop:adminPaymentConfig", { actorId });
}

/** Owner menampilkan/menyembunyikan menu Paymentku QRIS. */
export async function apiAdminSetPaymentkuEnabled(
  actorId: string,
  enabled: boolean
): Promise<{ ok: boolean; paykuEnabled?: boolean; error?: string }> {
  return callAction("shop:adminSetPaymentkuEnabled", { actorId, enabled });
}

/** Owner menyiapkan URL upload gambar QR (disimpan di Convex storage). */
export async function apiGetImageUploadUrl(actorId: string): Promise<{
  ok: boolean;
  uploadUrl?: string;
  error?: string;
}> {
  return callAction("shop:getImageUploadUrl", { actorId });
}

/** Owner menambah/memperbarui metode isi manual (QR/Bank/E-Wallet). */
export async function apiAdminSavePaymentMethod(
  actorId: string,
  m: {
    id?: string;
    type: PayMethodType;
    label: string;
    accountName: string;
    accountNo: string;
    imageUrl?: string;
    imageStorageId?: string;
  }
): Promise<{ ok: boolean; method?: PayMethod; methods?: PayMethod[]; error?: string }> {
  return callAction("shop:adminSavePaymentMethod", {
    actorId,
    id: m.id ?? undefined,
    type: m.type,
    label: m.label,
    accountName: m.accountName,
    accountNo: m.accountNo,
    imageUrl: m.imageUrl ?? undefined,
    imageStorageId: m.imageStorageId ?? undefined,
  });
}

/** Owner menyalakan/mematikan satu metode isi manual. */
export async function apiAdminTogglePaymentMethod(
  actorId: string,
  id: string,
  enabled: boolean
): Promise<{ ok: boolean; methods?: PayMethod[]; error?: string }> {
  return callAction("shop:adminTogglePaymentMethod", { actorId, id, enabled });
}

/** Owner menghapus metode isi manual. */
export async function apiAdminDeletePaymentMethod(
  actorId: string,
  id: string
): Promise<{ ok: boolean; methods?: PayMethod[]; error?: string }> {
  return callAction("shop:adminDeletePaymentMethod", { actorId, id });
}

/** Customer kirim permintaan isi saldo manual (sudah transfer) → menunggu konfirmasi admin. */
export async function apiManualDepositCreate(
  userId: string,
  amount: number,
  methodId: string,
  note?: string
): Promise<{
  ok: boolean;
  referenceId?: string;
  amount?: number;
  methodLabel?: string;
  methodDetail?: string;
  error?: string;
}> {
  return callAction("shop:manualDepositCreate", {
    userId,
    amount,
    methodId,
    note: note ?? undefined,
  });
}

/** Admin/CS setujui deposit manual → saldo masuk ke customer. */
export async function apiAdminDepositSettle(
  actorId: string,
  referenceId: string
): Promise<{ ok: boolean; amount?: number; balance?: number; bonus?: number; error?: string }> {
  return callAction("shop:adminDepositSettle", { actorId, referenceId });
}

/** Admin/CS tolak deposit manual. */
export async function apiAdminDepositReject(
  actorId: string,
  referenceId: string
): Promise<{ ok: boolean; error?: string }> {
  return callAction("shop:adminDepositReject", { actorId, referenceId });
}

/** Refund manual oleh Owner/CS (ditolak bila OTP sudah masuk). */
export async function apiAdminRefundOrder(
  actorId: string,
  rowId: string
): Promise<{ ok: boolean; refunded?: number; balance?: number; otp?: string; error?: string }> {
  return callAction("shop:adminRefundOrder", { actorId, rowId });
}

/** Customer membatalkan order sendiri — minimal 2 menit & tidak bisa bila OTP masuk. */
export async function apiShopCancelOrder(
  userId: string,
  orderId: string
): Promise<{ ok: boolean; refunded?: number; balance?: number; otp?: string; retryAfterSeconds?: number; error?: string }> {
  return callAction("shop:cancelOrder", { userId, orderId });
}

/** Simpan OTP yang ditemukan ke riwayat. */
export async function apiShopRecordOtp(
  userId: string,
  orderId: string,
  otp: string
): Promise<{ ok: boolean; error?: string }> {
  return callAction("shop:recordOtp", { userId, orderId, otp });
}

/** Periksa ulang satu order milik customer (tombol "Periksa OTP"). */
export async function apiShopCheckMyOrder(
  userId: string,
  orderId: string
): Promise<{ ok: boolean; status?: string; otp?: string | null; number?: string | null; error?: string }> {
  return callAction("shop:checkMyOrder", { userId, orderId });
}

/** Baca pengaturan toko (visibilitas server). */
export async function apiShopGetSettings(): Promise<{ ok: boolean; servers?: Record<string, boolean>; error?: string }> {
  return callAction("shop:getServerSettings", {});
}

/** Owner menyalakan/mematikan server di halaman beli. */
export async function apiShopSetServerEnabled(
  actorId: string,
  serverKey: string,
  enabled: boolean
): Promise<{ ok: boolean; servers?: Record<string, boolean>; error?: string }> {
  return callAction("shop:setServerEnabled", { actorId, serverKey, enabled });
}

export function formatRupiah(value: number): string {
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
}
