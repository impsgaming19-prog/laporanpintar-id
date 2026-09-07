/**
 * Paymentku backend helper.
 *
 * Base URL yang digunakan: https://paymenku.com/api/v1
 * Catatan: pastikan ini benar-benar domain yang kamu maksud.
 * Jika maksudmu paymentku.com, perbaiki PAYMENTKU_BASE_URL di bawah.
 *
 * TODO: sesuaikan endpoint dan parameter sesuai dokumen resmi Paymentku.
 * Endpoint dan parameter di bawah ini adalah placeholder sampai kamu mengonfirmasi bentuk
 * permintaan yang benar dari Paymentku.
 */
const PAYMENTKU_API_URL = process.env.PAYMENTKU_API_URL || "https://paymenku.com/api/v1";
const PAYMENTKU_API_KEY = process.env.NOKOS_PAYMENTKU_API_KEY;

interface CreatePaymentLinkParams {
  order_id: string;
  amount: number;
  provider: string;
  callback_url?: string;
}

interface CreatePaymentLinkResult {
  ok: boolean;
  url?: string;
  payment_id?: string;
  error?: string;
}

export async function createPaymentLink(
  params: CreatePaymentLinkParams
): Promise<CreatePaymentLinkResult> {
  if (!PAYMENTKU_API_KEY) {
    return { ok: false, error: "NOKOS_PAYMENTKU_API_KEY belum diatur di environment" };
  }

  // TODO: sesuaikan endpoint dan parameter dengan API resmi Paymentku.
  const res = await fetch(`${PAYMENTKU_API_URL}/payments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAYMENTKU_API_KEY}`,
    },
    body: JSON.stringify({
      order_id: params.order_id,
      amount: params.amount,
      provider: params.provider,
      callback_url: params.callback_url,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: text || `Paymentku gagal: ${res.status}` };
  }

  const data = (await res.json().catch(() => ({}))) as {
    payment_url?: string;
    payment_id?: string;
  };

  return {
    ok: true,
    url: data.payment_url,
    payment_id: data.payment_id,
  };
}

/**
 * Coba baca saldo dari respons Paymentku.
 * Bentuk respons masih placeholder sampai kamu mengonfirmasi format aslinya.
 */
export function parsePaymentkuSaldo(raw: unknown): { balance?: number; error?: string } {
  if (!raw || typeof raw !== "object") {
    return { error: "Respons Paymentku tidak dikenali" };
  }

  const data = raw as Record<string, unknown>;

  const candidates: unknown[] = [
    data.balance,
    (data.data as Record<string, unknown> | undefined)?.balance,
    data.saldo,
    (data.data as Record<string, unknown> | undefined)?.saldo,
  ];

  for (const value of candidates) {
    if (typeof value === "number" && isFinite(value)) {
      return { balance: value };
    }
  }

  return { error: "Tidak menemukan field saldo yang dikenali" };
}
