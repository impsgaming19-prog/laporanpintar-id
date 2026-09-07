export interface KirimkodeOrderRequest {
  server_id: string;
  country_id: string;
  service_id: string;
  provider_price: number;
}

export interface KirimkodeOrderResponse {
  ok: boolean;
  order?: {
    order_id: string;
    status: string;
    phone_number?: string;
    provider?: string;
    provider_price?: number;
    amount?: number;
    otp_expires_at?: string;
    error_message?: string;
  };
  error?: string;
}

export async function kirimkodeCreateOrder(
  payload: KirimkodeOrderRequest
): Promise<KirimkodeOrderResponse> {
  const res = await fetch("/api/kirimkode/order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: text || `Gagal: ${res.status}` };
  }

  return (await res.json()) as KirimkodeOrderResponse;
}
