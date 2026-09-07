export interface CreatePaymentLinkRequest {
  order_id: string;
  amount: number;
  provider: string;
  callback_url?: string;
}

export interface CreatePaymentLinkResponse {
  ok: boolean;
  url?: string;
  payment_id?: string;
  error?: string;
}

export interface PaymentkuSaldoResponse {
  balance?: number;
  error?: string;
}

export async function createPaymentLink(
  params: CreatePaymentLinkRequest
): Promise<CreatePaymentLinkResponse> {
  const res = await fetch("/api/paymentku/create-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: text || `Gagal: ${res.status}` };
  }

  return (await res.json()) as CreatePaymentLinkResponse;
}

export async function fetchSaldoFromPaymentku(): Promise<PaymentkuSaldoResponse> {
  const res = await fetch("/api/paymentku/saldo");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: text || `Gagal: ${res.status}` };
  }
  return (await res.json()) as PaymentkuSaldoResponse;
}

/**
 * Catatan:
 * - Backend API URL yang dipakai: https://paymenku.com/api/v1
 * - Kalau domain ini salah, perbaiki PAYMENTKU_API_URL di src/server/paymentku.ts.
 * - Endpoint /payments dan bentuk body masih placeholder sampai kamu beri detail endpoint/parameter resmi Paymentku.
 * - Metode deposit yang dipakai di toko ini: QR only.
 */
