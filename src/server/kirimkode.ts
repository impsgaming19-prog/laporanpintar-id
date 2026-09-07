import { Hono } from "hono";
import fs from "node:fs";

const app = new Hono();

const STORE_PATH = new URL("../server/orderStore.json", import.meta.url).pathname;

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8")) as Record<string, any>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, any>) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

const SERVER_PROVIDER_MAP: Record<string, { provider: string; envKey: string }> = {
  jasav1: { provider: "Kirimkode", envKey: "NOKOS_KIRIMKODE_API_KEY" },
  jasav2: { provider: "Ditznesia", envKey: "NOKOS_DITZNESIA_API_KEY" },
  jasav3: { provider: "Ditznesia API v2", envKey: "NOKOS_DITZNESIA_API2_KEY" },
  jasav4: { provider: "Ditznesia API v2", envKey: "NOKOS_DITZNESIA_API2_KEY" },
};

function resolveProvider(serverId: string) {
  return SERVER_PROVIDER_MAP[serverId] || null;
}

function buildFinalPrice(providerPrice: number, markupPct = 30) {
  const markup = Math.round(providerPrice * (markupPct / 100));
  return providerPrice + markup;
}

async function callProvider(
  serverId: string,
  body: Record<string, any>
) {
  const route = resolveProvider(serverId);
  if (!route) {
    throw new Error("Server tidak dikenali");
  }

  const apiKey = process.env[route.envKey];
  if (!apiKey) {
    throw new Error(`Kunci ${route.envKey} belum diatur di environment`);
  }

  // TODO: ganti panggilan di bawah dengan format API asli dari Kirimkode / Ditznesia
  // sesuai docs masing-masing provider.
  //
  // Contoh pola yang harus diatur:
  // - Kirimkode: gunakan endpoint dan header/parameter sesuai docs Kirimkode.
  // - Ditznesia: gunakan endpoint Ditznesia sesuai docs.
  // - Ditznesia API v2: gunakan endpoint versi 2 sesuai docs.
  //
  // Contoh umum:
  // const res = await fetch("<URL_PROVIDER>", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     "Authorization": `Bearer ${apiKey}`,
  //   },
  //   body: JSON.stringify({ ...body, ...payloadKhususProvider }),
  // });
  //
  // Jika provider meminta param query atau header lain, sesuaikan di sini.

  const providerPrice = body.provider_price ?? 10000;
  const finalPrice = buildFinalPrice(providerPrice);

  return {
    order_id: "NK-" + Math.random().toString(36).slice(2, 10).toUpperCase(),
    status: "pending",
    phone_number: "+6280000000000",
    provider: route.provider,
    provider_price: providerPrice,
    amount: finalPrice,
    otp_expires_at: null,
    error_message: null,
  };
}

app.post("/api/kirimkode/order", async (c: any) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.server_id || !body.country_id || !body.service_id) {
    return c.json({ ok: false, error: "Data order tidak lengkap" }, 400);
  }

  try {
    const order = await callProvider(body.server_id, body);
    const store = readStore();
    store[order.order_id] = order;
    writeStore(store);
    return c.json({ ok: true, order });
  } catch (err: any) {
    return c.json({ ok: false, error: err?.message || "Gagal membuat order" }, 500);
  }
});

export default app;
