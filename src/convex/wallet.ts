import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/* Fungsi-fungsi ini INTERNAL (tidak bisa dipanggil langsung dari browser) —
 * hanya dipakai oleh action di shop.ts lewat ctx.runMutation/runQuery. */

const REFERRAL_MIN_DEPOSIT = 10000;
const REFERRAL_BONUS = 5000;

/** Kode undangan acak 8 karakter (tanpa 0/O/1/I biar gampang diketik). */
function makeRefCode(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

/** Daftar customer sendiri (email = username). */
export const registerCustomer = internalMutation({
  args: {
    email: v.string(),
    password: v.string(),
    fullName: v.optional(v.string()),
    refCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: "Email tidak valid." };
    }
    if (args.password.length < 4) {
      return { success: false, error: "Password minimal 4 karakter." };
    }
    const existing = await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", email))
      .first();
    if (existing) {
      return { success: false, error: "Email sudah terdaftar. Silakan login." };
    }
    const name = (args.fullName || "").trim() || email.split("@")[0] || "Customer";

    // Kode undangan unik untuk akun baru (8 karakter acak).
    let refCode = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = makeRefCode();
      const dup = await ctx.db
        .query("appUsers")
        .filter((q) => q.eq(q.field("refCode"), candidate))
        .first();
      if (!dup) {
        refCode = candidate;
        break;
      }
    }

    // #3 referral: siapa pengundang (dari kode undangan teman).
    let referredBy: string | undefined;
    if (args.refCode && args.refCode.trim()) {
      const code = args.refCode.trim().toUpperCase();
      const referrer = await ctx.db
        .query("appUsers")
        .filter((q) => q.eq(q.field("refCode"), code))
        .first();
      if (referrer && referrer.role === "customer" && referrer.username !== email) {
        referredBy = referrer.username;
      }
    }

    const id = await ctx.db.insert("appUsers", {
      username: email,
      password: args.password,
      fullName: name,
      role: "customer",
      createdBy: "self-register",
      createdAt: Date.now(),
      balance: 0,
      refCode,
      ...(referredBy ? { referredBy } : {}),
    });
    return { success: true, id, refCode };
  },
});

/** Verifikasi login email + password. */
export const verifyCustomer = internalQuery({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", args.username.trim().toLowerCase()))
      .first();
    if (!user) return null;
    if (user.password !== args.password) return null;
    return {
      id: user._id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    };
  },
});

/** Potong saldo customer (dipanggil sebelum pesan nomor ke provider). */
export const charge = internalMutation({
  args: { userId: v.id("appUsers"), amount: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    const balance = Math.max(0, Math.floor(Number(user.balance) || 0));
    const amount = Math.max(0, Math.floor(args.amount));
    if (balance < amount) {
      return {
        ok: false,
        error: `Saldo tidak cukup: Rp ${balance.toLocaleString("id-ID")}. Silakan isi saldo (Deposit) dulu.`,
      };
    }
    await ctx.db.patch(user._id, { balance: balance - amount });
    return { ok: true, balance: balance - amount };
  },
});

/** Kembalikan saldo (dipakai saat order gagal / dibatalkan). */
export const refundCharge = internalMutation({
  args: { userId: v.id("appUsers"), amount: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    const balance = Math.max(0, Math.floor(Number(user.balance) || 0));
    const amount = Math.max(0, Math.floor(args.amount));
    await ctx.db.patch(user._id, { balance: balance + amount });
    return { ok: true, balance: balance + amount };
  },
});

/** Catat order nomor yang berhasil dibuat di provider. */
export const saveOrder = internalMutation({
  args: {
    userId: v.id("appUsers"),
    provider: v.string(),
    providerLabel: v.string(),
    serverLabel: v.optional(v.string()),
    country: v.string(),
    countryName: v.optional(v.string()),
    service: v.string(),
    serviceName: v.optional(v.string()),
    orderId: v.string(),
    sellPrice: v.number(),
    providerPrice: v.number(),
    number: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("nokosOrders", {
      userId: args.userId,
      provider: args.provider,
      providerLabel: args.providerLabel,
      serverLabel: args.serverLabel || undefined,
      country: args.country,
      countryName: args.countryName || undefined,
      service: args.service,
      serviceName: args.serviceName || undefined,
      orderId: args.orderId,
      sellPrice: Math.max(0, Math.floor(args.sellPrice)),
      providerPrice: Math.max(0, Math.floor(args.providerPrice)),
      number: args.number || undefined,
      status: "ordered",
      createdAt: Date.now(),
    });
    return { ok: true, id };
  },
});

/** Simpan OTP / nomor / ubah status order di riwayat. */
export const setOrderResult = internalMutation({
  args: {
    orderId: v.string(),
    otp: v.optional(v.string()),
    number: v.optional(v.string()),
    status: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("nokosOrders")
      .withIndex("by_orderId", (q) => q.eq("orderId", args.orderId))
      .first();
    if (!row) return { ok: false, error: "Order tidak ditemukan di riwayat." };
    const patch: Record<string, string | number> = { updatedAt: Date.now() };
    if (args.otp != null) patch.otp = args.otp;
    if (args.number != null && !row.number) patch.number = args.number;
    if (args.status != null) patch.status = args.status;
    if (args.error != null) patch.error = args.error;
    await ctx.db.patch(row._id, patch);
    return { ok: true };
  },
});

/** Set deposit lunas + tambahkan saldo (idempotent: hanya sekali per deposit). */
export const settleDeposit = internalMutation({
  args: { referenceId: v.string() },
  handler: async (ctx, args) => {
    const dep = await ctx.db
      .query("nokosDeposits")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
      .first();
    if (!dep) return { ok: false, error: "Deposit tidak ditemukan." };
    if (dep.status === "paid") {
      return { ok: true, already: true };
    }
    if (dep.status === "voucher" || dep.channel === "voucher") {
      return { ok: false, error: "Voucher bukan deposit tunai." };
    }
    if (dep.status === "rejected") {
      return { ok: false, error: "Deposit ini sudah ditolak." };
    }
    const user = await ctx.db.get(dep.userId);
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    const balance = Math.max(0, Math.floor(Number(user.balance) || 0));
    const amount = Math.max(0, Math.floor(dep.amount));
    await ctx.db.patch(dep._id, { status: "paid", paidAt: Date.now() });
    await ctx.db.patch(user._id, { balance: balance + amount });

    // #3 bonus ajak teman: deposit pertama (>= Rp 10.000) dari akun baru yang
    // terdaftar lewat kode undangan -> dua-duanya dapat Rp 5.000 (sekali saja).
    if (amount >= REFERRAL_MIN_DEPOSIT && user.referredBy && !user.referralBonusAt) {
      const referrer = await ctx.db
        .query("appUsers")
        .withIndex("by_username", (q) => q.eq("username", user.referredBy!))
        .first();
      if (referrer && referrer.role === "customer" && String(referrer._id) !== String(user._id)) {
        const rb = Math.max(0, Math.floor(Number(referrer.balance) || 0));
        await ctx.db.patch(referrer._id, { balance: rb + REFERRAL_BONUS });
        const nb = balance + amount + REFERRAL_BONUS;
        await ctx.db.patch(user._id, { balance: nb, referralBonusAt: Date.now() });
        return { ok: true, balance: nb, bonus: REFERRAL_BONUS };
      }
      await ctx.db.patch(user._id, { referralBonusAt: Date.now() });
    }
    return { ok: true, balance: balance + amount };
  },
});

/** #2 kode promo/voucher: kredit saldo + catat pemakaian (dicek dulu di action). */
export const applyVoucher = internalMutation({
  args: {
    userId: v.id("appUsers"),
    code: v.string(),
    amount: v.number(),
    referenceId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    if (user.role !== "customer") return { ok: false, error: "Hanya akun customer yang bisa menukar kode." };
    const used = user.usedCodes || [];
    if (used.includes(args.code)) return { ok: false, error: "Kode ini sudah pernah dipakai akun kamu." };
    const amount = Math.max(0, Math.floor(args.amount));
    const balance = Math.max(0, Math.floor(Number(user.balance) || 0)) + amount;
    await ctx.db.patch(user._id, { balance, usedCodes: [...used, args.code] });
    await ctx.db.insert("nokosDeposits", {
      userId: user._id,
      referenceId: args.referenceId,
      amount,
      status: "voucher",
      channel: "voucher",
      createdAt: Date.now(),
    });
    return { ok: true, balance };
  },
});

/** Catat deposit pending saat invoice dibuat (paymentku QR / manual). */
export const recordDeposit = internalMutation({
  args: {
    userId: v.id("appUsers"),
    referenceId: v.string(),
    amount: v.number(),
    channel: v.optional(v.string()),
    methodId: v.optional(v.string()),
    methodLabel: v.optional(v.string()),
    methodDetail: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const channel = args.channel || "paymentku";
    await ctx.db.insert("nokosDeposits", {
      userId: args.userId,
      referenceId: args.referenceId,
      amount: Math.max(0, Math.floor(args.amount)),
      status: "pending",
      channel,
      ...(args.methodId ? { methodId: args.methodId } : {}),
      ...(args.methodLabel ? { methodLabel: args.methodLabel } : {}),
      ...(args.methodDetail ? { methodDetail: args.methodDetail } : {}),
      ...(args.note ? { note: args.note } : {}),
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Ambil satu deposit berdasarkan referenceId (untuk cek sebelum approve/tolak). */
export const depositByReference = internalQuery({
  args: { referenceId: v.string() },
  handler: async (ctx, args) => {
    const r = await ctx.db
      .query("nokosDeposits")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
      .first();
    if (!r) return null;
    return {
      id: r._id,
      userId: r.userId,
      referenceId: r.referenceId,
      amount: r.amount,
      status: r.status,
      channel: r.channel || "paymentku",
      methodLabel: r.methodLabel || null,
      createdAt: r.createdAt,
    };
  },
});

/** Tolak deposit manual yang belum dibayar/valid (admin). */
export const rejectDeposit = internalMutation({
  args: { referenceId: v.string() },
  handler: async (ctx, args) => {
    const r = await ctx.db
      .query("nokosDeposits")
      .withIndex("by_reference", (q) => q.eq("referenceId", args.referenceId))
      .first();
    if (!r) return { ok: false, error: "Deposit tidak ditemukan." };
    if (r.status === "paid") return { ok: false, error: "Deposit sudah lunas — tidak bisa ditolak." };
    if (r.status === "rejected") return { ok: false, error: "Deposit sudah ditolak." };
    await ctx.db.patch(r._id, { status: "rejected" });
    return { ok: true };
  },
});

/** Info saldo customer. */
export const wallet = internalQuery({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return {
      userId: user._id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      balance: Math.max(0, Math.floor(Number(user.balance) || 0)),
    };
  },
});

/** Riwayat order milik customer (terbaru dulu). */
export const listOrders = internalQuery({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("nokosOrders")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(40);
    return rows.map((r) => ({
      id: r._id,
      provider: r.provider,
      providerLabel: r.providerLabel,
      serverLabel: r.serverLabel ?? null,
      countryName: r.countryName ?? r.country,
      serviceName: r.serviceName ?? r.service,
      orderId: r.orderId,
      sellPrice: r.sellPrice,
      status: r.status,
      otp: r.otp ?? null,
      number: r.number ?? null,
      error: r.error ?? null,
      createdAt: r.createdAt,
    }));
  },
});

/* =====================================================================
 * ADMIN / OWNER — dipanggil action di shop.ts SETELAH cek peran pemanggil
 * ===================================================================== */

/** Catat waktu login terakhir (dipanggil action setelah verifikasi berhasil). */
export const touchLogin = internalMutation({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    if (!u) return { ok: false };
    await ctx.db.patch(u._id, { lastLoginAt: Date.now() });
    return { ok: true };
  },
});

/** Info peran pemanggil (owner / cs / customer). */
export const actorInfo = internalQuery({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    if (!u) return null;
    return { id: u._id, role: u.role, username: u.username, fullName: u.fullName };
  },
});

/** Detail akun (untuk fitur referral customer). */
export const userDetail = internalQuery({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    if (!u) return null;
    return {
      id: u._id,
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      balance: Math.max(0, Math.floor(Number(u.balance) || 0)),
      refCode: u.refCode || "",
      referredBy: u.referredBy || "",
      referralBonusAt: u.referralBonusAt || null,
      usedCodes: u.usedCodes || [],
    };
  },
});

/** Buat akun Owner pertama. Kode rahasia sudah dicek di action shop.ts. */
export const registerOwner = internalMutation({
  args: {
    email: v.string(),
    password: v.string(),
    fullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: "Email tidak valid." };
    }
    if (args.password.length < 4) {
      return { success: false, error: "Password minimal 4 karakter." };
    }
    const existing = await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", email))
      .first();
    if (existing) {
      return { success: false, error: "Email sudah terdaftar. Silakan login." };
    }
    const anyOwner = await ctx.db
      .query("appUsers")
      .filter((q) => q.eq(q.field("role"), "owner"))
      .first();
    if (anyOwner) {
      return { success: false, error: "Akun Owner sudah pernah dibuat." };
    }
    const id = await ctx.db.insert("appUsers", {
      username: email,
      password: args.password,
      fullName: (args.fullName || "").trim() || "Owner",
      role: "owner",
      createdBy: "owner-signup",
      createdAt: Date.now(),
      balance: 0,
    });
    return { success: true, id };
  },
});

/** Buat akun staff (CS) oleh Owner. */
export const createStaff = internalMutation({
  args: {
    username: v.string(),
    password: v.string(),
    fullName: v.string(),
    role: v.string(),
  },
  handler: async (ctx, args) => {
    const username = args.username.trim().toLowerCase();
    if (args.password.length < 4) {
      return { success: false, error: "Password minimal 4 karakter." };
    }
    const existing = await ctx.db
      .query("appUsers")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();
    if (existing) {
      return { success: false, error: "Username sudah dipakai." };
    }
    const id = await ctx.db.insert("appUsers", {
      username,
      password: args.password,
      fullName: (args.fullName || "").trim() || "Staff",
      role: args.role === "cs" ? "cs" : "customer",
      createdBy: "owner",
      createdAt: Date.now(),
      balance: 0,
    });
    return { success: true, id };
  },
});

/** Hapus akun staff (CS) oleh Owner (akun yang sudah punya riwayat tidak dihapus, hanya nonaktif via delete). */
export const deleteStaff = internalMutation({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    if (!u) return { ok: false, error: "Akun tidak ditemukan." };
    if (u.role !== "cs") return { ok: false, error: "Hanya akun CS yang bisa dihapus di sini." };
    await ctx.db.delete(args.userId);
    return { ok: true };
  },
});

/** Daftar semua akun (admin: owner/cs). */
export const listAllUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("appUsers").order("desc").take(300);
  },
});

/** Ubah saldo customer (delta boleh minus; hasil tidak pernah negatif). */
export const adjustBalance = internalMutation({
  args: { userId: v.id("appUsers"), delta: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    if (user.role === "owner") return { ok: false, error: "Saldo Owner tidak diubah lewat panel." };
    const delta = Math.floor(args.delta) || 0;
    if (delta === 0) return { ok: true, balance: Math.max(0, Math.floor(Number(user.balance) || 0)) };
    const balance = Math.max(0, Math.floor(Number(user.balance) || 0) + delta);
    await ctx.db.patch(user._id, { balance });
    return { ok: true, balance };
  },
});

/** Statistik ringkas untuk panel admin. */
export const statsOverview = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("appUsers").collect();
    const orders = await ctx.db.query("nokosOrders").order("desc").take(1000);
    const deposits = await ctx.db.query("nokosDeposits").order("desc").take(500);
    const customers = users.filter((u) => u.role === "customer");
    const totalBalance = customers.reduce((s, u) => s + Math.floor(Number(u.balance) || 0), 0);
    const sold = orders.filter((o) => !["refunded", "failed"].includes(o.status));
    const soldTotal = sold.reduce((s, o) => s + Math.floor(o.sellPrice || 0), 0);
    // Untung kotor per order = harga jual - harga provider (margin ±30% dari jual).
    const profitGross = sold.reduce((s, o) => s + (Math.floor(o.sellPrice || 0) - Math.floor(o.providerPrice || 0)), 0);
    const paidDeps = deposits.filter((d) => d.status === "paid");
    const depositTotal = paidDeps.reduce((s, d) => s + Math.floor(d.amount || 0), 0);
    const refunded = orders.filter((o) => o.status === "refunded");
    const refundTotal = refunded.reduce((s, o) => s + Math.floor(o.sellPrice || 0), 0);
    const countByStatus: Record<string, number> = {};
    for (const o of orders) countByStatus[o.status] = (countByStatus[o.status] || 0) + 1;
    return {
      userCount: users.length,
      customerCount: customers.length,
      staffCount: users.filter((u) => u.role === "cs").length,
      ownerCount: users.filter((u) => u.role === "owner").length,
      orderCount: orders.length,
      activeOrderCount: (countByStatus.ordered || 0) + (countByStatus.otp || 0),
      soldTotal,
      profitGross,
      totalBalance,
      depositCount: paidDeps.length,
      depositTotal,
      depositPending: deposits.filter((d) => d.status === "pending").length,
      refundCount: refunded.length,
      refundTotal,
      statusBreakdown: countByStatus,
    };
  },
});

/** Riwayat deposit customer (owner) — isi saldo via QR. */
export const adminDepositsList = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("nokosDeposits").order("desc").take(500);
    const out: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const u = r.userId ? await ctx.db.get(r.userId) : null;
      out.push({
        id: r._id,
        userId: r.userId,
        username: u?.username || "",
        fullName: u?.fullName || "",
        referenceId: r.referenceId,
        amount: r.amount,
        status: r.status,
        channel: r.channel || "paymentku",
        methodLabel: r.methodLabel || null,
        methodDetail: r.methodDetail || null,
        note: r.note || null,
        createdAt: r.createdAt,
        paidAt: r.paidAt || null,
      });
    }
    return out;
  },
});

/** Riwayat order semua customer (admin). */
export const adminOrdersList = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("nokosOrders").order("desc").take(500);
    const out: Array<Record<string, unknown>> = [];
    for (const r of rows) {
      const u = r.userId ? await ctx.db.get(r.userId) : null;
      out.push({
        id: r._id,
        userId: r.userId,
        username: u?.username || "",
        fullName: u?.fullName || "",
        provider: r.provider,
        providerLabel: r.providerLabel,
        serverLabel: r.serverLabel ?? null,
        countryName: r.countryName || r.country,
        serviceName: r.serviceName || r.service,
        orderId: r.orderId,
        sellPrice: r.sellPrice,
        providerPrice: r.providerPrice,
        status: r.status,
        otp: r.otp || null,
        number: r.number || null,
        error: r.error || null,
        createdAt: r.createdAt,
      });
    }
    return out;
  },
});

/** Ambil satu order dari riwayat berdasarkan id provider. */
export const orderByProviderId = internalQuery({
  args: { orderId: v.string() },
  handler: async (ctx, args) => {
    const r = await ctx.db
      .query("nokosOrders")
      .withIndex("by_orderId", (q) => q.eq("orderId", args.orderId))
      .first();
    if (!r) return null;
    return {
      id: r._id,
      userId: r.userId,
      provider: r.provider,
      providerLabel: r.providerLabel,
      orderId: r.orderId,
      status: r.status,
      otp: r.otp || null,
      number: r.number || null,
      sellPrice: r.sellPrice,
      createdAt: r.createdAt,
    };
  },
});

/** Ambil satu order dari riwayat berdasarkan id dokumen. */
export const orderByRowId = internalQuery({
  args: { rowId: v.id("nokosOrders") },
  handler: async (ctx, args) => {
    const r = await ctx.db.get(args.rowId);
    if (!r) return null;
    return {
      id: r._id,
      userId: r.userId,
      provider: r.provider,
      providerLabel: r.providerLabel,
      orderId: r.orderId,
      status: r.status,
      otp: r.otp || null,
      number: r.number || null,
      sellPrice: r.sellPrice,
      createdAt: r.createdAt,
    };
  },
});

/** Owner mengganti email/password akunnya sendiri (cek password lama di action). */
export const ownerUpdateLogin = internalMutation({
  args: {
    userId: v.id("appUsers"),
    newUsername: v.optional(v.string()),
    newPassword: v.optional(v.string()),
    newFullName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    if (!u) return { ok: false, error: "Akun tidak ditemukan." };
    const patch: Record<string, string> = {};
    if (args.newUsername) {
      const email = args.newUsername.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Email tidak valid." };
      const dup = await ctx.db.query("appUsers").withIndex("by_username", (q) => q.eq("username", email)).first();
      if (dup && dup._id !== u._id) return { ok: false, error: "Email sudah dipakai akun lain." };
      patch.username = email;
    }
    if (args.newPassword) {
      if (args.newPassword.length < 4) return { ok: false, error: "Password baru minimal 4 karakter." };
      patch.password = args.newPassword;
    }
    if (args.newFullName) patch.fullName = args.newFullName.trim();
    if (Object.keys(patch).length === 0) return { ok: false, error: "Tidak ada yang diubah." };
    await ctx.db.patch(u._id, patch);
    return { ok: true };
  },
});

/** Baca semua pengaturan toko. */
export const getSettings = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("nokosSettings").collect();
    const map: Record<string, unknown> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  },
});

/** Simpan/ubah satu pengaturan toko. */
export const setSettings = internalMutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("nokosSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { value: args.value });
    } else {
      await ctx.db.insert("nokosSettings", { key: args.key, value: args.value });
    }
    return { ok: true };
  },
});
