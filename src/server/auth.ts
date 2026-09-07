import { Hono } from "hono";
import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";

const app = new Hono();

const DB_PATH = new URL("../server/userdb.json", import.meta.url).pathname;

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  verified: boolean;
  createdAt: number;
};

type OtpRow = {
  email: string;
  code: string;
  expiresAt: number;
  used: boolean;
  purpose: "register" | "login" | "google_link";
  userId?: string;
};

function readDb(): { users: UserRow[]; otps: OtpRow[] } {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as { users: UserRow[]; otps: OtpRow[] };
  } catch {
    return { users: [], otps: [] };
  }
}

function writeDb(db: { users: UserRow[]; otps: OtpRow[] }) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function hashPassword(plain: string) {
  // sederhana untuk MVP lokal. Ganti pakai bcrypt/argon2 untuk produksi.
  return crypto.createHash("sha256").update(plain + "kakosalt" + plain.length).digest("hex");
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sendOtpPlaceholder(email: string, code: string, purpose: OtpRow["purpose"]) {
  // TODO: ganti ini dengan kirim email asli.
  // Contoh: kirim lewat service email, atau lewat Telegram bot sesuai pilihan kamu.
  console.log(`[OTP placeholder] ke ${email} untuk ${purpose}: ${code}`);
}

app.post("/api/auth/register", async (c: any) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.email || !body.password || !body.fullName) {
    return c.json({ ok: false, error: "Email, password, dan nama wajib diisi" }, 400);
  }

  const email = body.email.toLowerCase().trim();
  const password = body.password;
  const fullName = body.fullName.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ ok: false, error: "Format email tidak benar" }, 400);
  }

  const db = readDb();
  if (db.users.some((u) => u.email === email)) {
    return c.json({ ok: false, error: "Email sudah terdaftar" }, 400);
  }

  const id = crypto.randomUUID();
  const passwordHash = hashPassword(password);

  db.users.push({
    id,
    email,
    passwordHash,
    fullName,
    verified: false,
    createdAt: Date.now(),
  });
  writeDb(db);

  const code = generateOtp();
  db.otps.push({
    email,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
    used: false,
    purpose: "register",
    userId: id,
  });
  writeDb(db);

  sendOtpPlaceholder(email, code, "register");

  return c.json({ ok: true, message: "Kode OTP dikirim ke email maksud. Cek inbox lalu verifikasi." });
});

app.post("/api/auth/otp/send", async (c: any) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.email) {
    return c.json({ ok: false, error: "Email wajib diisi" }, 400);
  }

  const email = body.email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ ok: false, error: "Format email tidak benar" }, 400);
  }

  const db = readDb();
  const userExists = db.users.some((u) => u.email === email);

  if (!userExists) {
    return c.json({ ok: false, error: "Email belum terdaftar" }, 400);
  }

  const code = generateOtp();
  db.otps.push({
    email,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000,
    used: false,
    purpose: "login",
  });
  writeDb(db);

  sendOtpPlaceholder(email, code, "login");

  return c.json({ ok: true, message: "Kode OTP baru dikirim." });
});

app.post("/api/auth/otp/verify", async (c: any) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.email || !body.code) {
    return c.json({ ok: false, error: "Email dan kode OTP wajib diisi" }, 400);
  }

  const email = body.email.toLowerCase().trim();
  const code = String(body.code).trim();

  const db = readDb();
  const otp = db.otps.findLast((o) => o.email === email && !o.used);
  if (!otp) {
    return c.json({ ok: false, error: "Tidak ada kode OTP aktif untuk email ini" }, 400);
  }

  if (otp.expiresAt < Date.now()) {
    return c.json({ ok: false, error: "Kode OTP sudah kadaluarsa" }, 400);
  }

  if (otp.code !== code) {
    return c.json({ ok: false, error: "Kode OTP salah" }, 400);
  }

  otp.used = true;

  const user = db.users.find((u) => u.email === email);
  if (user) {
    user.verified = true;
    user.fullName = user.fullName || (body.fullName || "").trim() || "Pengguna";
  }

  writeDb(db);

  return c.json({
    ok: true,
    user: {
      id: user?.id,
      email: user?.email,
      fullName: user?.fullName,
      verified: user?.verified,
    },
  });
});

app.post("/api/auth/login", async (c: any) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.email || !body.password) {
    return c.json({ ok: false, error: "Email dan password wajib diisi" }, 400);
  }

  const email = body.email.toLowerCase().trim();
  const password = body.password;

  const db = readDb();
  const user = db.users.find((u) => u.email === email);
  if (!user) {
    return c.json({ ok: false, error: "Email belum terdaftar" }, 400);
  }

  if (user.passwordHash !== hashPassword(password)) {
    return c.json({ ok: false, error: "Password salah" }, 400);
  }

  if (!user.verified) {
    return c.json({ ok: false, error: "Akun belum diverifikasi OTP. Minta kode OTP lagi." }, 400);
  }

  return c.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      verified: user.verified,
    },
  });
});

app.post("/api/auth/google/login", async (c: any) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.email) {
    return c.json({ ok: false, error: "Email dari Google wajib ada" }, 400);
  }

  const email = body.email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ ok: false, error: "Format email tidak benar" }, 400);
  }

  const db = readDb();
  let user = db.users.find((u) => u.email === email);

  if (!user) {
    const id = crypto.randomUUID();
    user = {
      id,
      email,
      passwordHash: "",
      fullName: body.fullName?.trim() || email.split("@")[0],
      verified: true,
      createdAt: Date.now(),
    };
    db.users.push(user);
    writeDb(db);
  } else {
    user.verified = true;
    writeDb(db);
  }

  return c.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      verified: user.verified,
    },
    needsOtp: false,
  });
});

export default app;
