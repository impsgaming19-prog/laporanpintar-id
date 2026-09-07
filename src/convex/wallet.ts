import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/* Fungsi-fungsi ini INTERNAL (tidak bisa dipanggil langsung dari browser) —
 * hanya dipakai oleh action di shop.ts lewat ctx.runMutation/runQuery. */

/** Daftar customer sendiri (email = username). */
export const registerCustomer = internalMutation({
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
    const name = (args.fullName || "").trim() || email.split("@")[0] || "Customer";
    const id = await ctx.db.insert("appUsers", {
      username: email,
      password: args.password,
      fullName: name,
      role: "customer",
      createdBy: "self-register",
      createdAt: Date.now(),
      balance: 0,
    });
    return { success: true, id };
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
    country: v.string(),
    countryName: v.optional(v.string()),
    service: v.string(),
    serviceName: v.optional(v.string()),
    orderId: v.string(),
    sellPrice: v.number(),
    providerPrice: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("nokosOrders", {
      userId: args.userId,
      provider: args.provider,
      providerLabel: args.providerLabel,
      country: args.country,
      countryName: args.countryName || undefined,
      service: args.service,
      serviceName: args.serviceName || undefined,
      orderId: args.orderId,
      sellPrice: Math.max(0, Math.floor(args.sellPrice)),
      providerPrice: Math.max(0, Math.floor(args.providerPrice)),
      status: "ordered",
      createdAt: Date.now(),
    });
    return { ok: true, id };
  },
});

/** Simpan OTP / ubah status order di riwayat. */
export const setOrderResult = internalMutation({
  args: {
    orderId: v.string(),
    otp: v.optional(v.string()),
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
    const user = await ctx.db.get(dep.userId);
    if (!user) return { ok: false, error: "Akun tidak ditemukan." };
    const balance = Math.max(0, Math.floor(Number(user.balance) || 0));
    const amount = Math.max(0, Math.floor(dep.amount));
    await ctx.db.patch(dep._id, { status: "paid", paidAt: Date.now() });
    await ctx.db.patch(user._id, { balance: balance + amount });
    return { ok: true, balance: balance + amount };
  },
});

/** Catat deposit pending saat invoice dibuat. */
export const recordDeposit = internalMutation({
  args: {
    userId: v.id("appUsers"),
    referenceId: v.string(),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("nokosDeposits", {
      userId: args.userId,
      referenceId: args.referenceId,
      amount: Math.max(0, Math.floor(args.amount)),
      status: "pending",
      createdAt: Date.now(),
    });
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
      countryName: r.countryName ?? r.country,
      serviceName: r.serviceName ?? r.service,
      orderId: r.orderId,
      sellPrice: r.sellPrice,
      status: r.status,
      otp: r.otp ?? null,
      error: r.error ?? null,
      createdAt: r.createdAt,
    }));
  },
});

/* =====================================================================
 * ADMIN / OWNER — dipanggil action di shop.ts SETELAH cek peran pemanggil
 * ===================================================================== */

/** Info peran pemanggil (owner / cs / customer). */
export const actorInfo = internalQuery({
  args: { userId: v.id("appUsers") },
  handler: async (ctx, args) => {
    const u = await ctx.db.get(args.userId);
    if (!u) return null;
    return { id: u._id, role: u.role, username: u.username, fullName: u.fullName };
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
    const orders = await ctx.db.query("nokosOrders").order("desc").take(200);
    const customers = users.filter((u) => u.role === "customer");
    const totalBalance = customers.reduce((s, u) => s + Math.floor(Number(u.balance) || 0), 0);
    const sold = orders.filter((o) => !["refunded", "failed"].includes(o.status));
    const soldTotal = sold.reduce((s, o) => s + Math.floor(o.sellPrice || 0), 0);
    return {
      userCount: users.length,
      customerCount: customers.length,
      staffCount: users.filter((u) => u.role === "cs").length,
      ownerCount: users.filter((u) => u.role === "owner").length,
      orderCount: orders.length,
      activeOrderCount: orders.filter((o) => o.status === "ordered" || o.status === "otp").length,
      soldTotal,
      totalBalance,
    };
  },
});

/** Riwayat order semua customer (admin). */
export const adminOrdersList = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("nokosOrders").order("desc").take(150);
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
        countryName: r.countryName || r.country,
        serviceName: r.serviceName || r.service,
        orderId: r.orderId,
        sellPrice: r.sellPrice,
        providerPrice: r.providerPrice,
        status: r.status,
        otp: r.otp || null,
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
