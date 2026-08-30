import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Users, UserPlus, Trash2, Crown, X, Eye, EyeOff, Copy, Check } from "lucide-react";
import { useAuth, useTheme } from "@/contexts/AppContext";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function OwnerPage() {
  const { user } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [showCreate, setShowCreate] = useState(false);
  const [showPasswordList, setShowPasswordList] = useState(false);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const createUser = useMutation(api.users.createUser);
  const deleteUser = useMutation(api.users.deleteUser);
  const upsertChatUser = useMutation(api.chat.upsertUser);
  const convexUsers = useQuery(api.users.listUsers);

  const handleCreate = async () => {
    setError("");
    setSuccess("");
    if (!newUsername.trim() || !newPassword.trim() || !newFullName.trim()) {
      setError("Semua field harus diisi");
      return;
    }
    if (newPassword.length < 4) {
      setError("Password minimal 4 karakter");
      return;
    }
    // Frontend duplicate check
    if (convexUsers && convexUsers.some(u => u.username.toLowerCase() === newUsername.trim().toLowerCase())) {
      setError("Username sudah digunakan, pilih username lain");
      return;
    }

    const result = await createUser({
      username: newUsername.trim(),
      password: newPassword,
      fullName: newFullName.trim(),
      createdBy: user?.username || "unknown",
    });

    if (result.success) {
      // Also register in chat system so user appears in search
      await upsertChatUser({
        userId: result.id || newUsername.trim(),
        username: newUsername.trim(),
        fullName: newFullName.trim(),
      });
      setSuccess(`Akun "${newFullName}" berhasil dibuat & terdaftar di chat!`);
      setNewUsername("");
      setNewPassword("");
      setNewFullName("");
      setShowCreate(false);
      setTimeout(() => setSuccess(""), 3000);
    } else {
      setError(result.error || "Gagal membuat akun");
    }
  };

  const handleDelete = async (userId: string, name: string) => {
    if (!confirm(`Hapus akun "${name}"?`)) return;
    await deleteUser({ userId: userId as any });
    setSuccess(`Akun "${name}" berhasil dihapus`);
    setTimeout(() => setSuccess(""), 3000);
  };

  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";
  const textMuted = isDark ? "text-zinc-500" : "text-zinc-400";
  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const inputCls = isDark
    ? "bg-white/[0.04] border-white/[0.08] text-white placeholder:text-zinc-500"
    : "bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400";

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-5 pt-5 pb-8 space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
          <Crown className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className={`text-[22px] font-bold tracking-tight ${textPrimary}`}>Panel Owner</h1>
          <p className={`text-[13px] mt-0.5 ${textSecondary}`}>Kelola akun pengguna</p>
        </div>
      </div>

      {/* Success/Error */}
      {success && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-[13px] text-emerald-500 font-medium">
          ✅ {success}
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-[13px] text-red-500 font-medium">
          ❌ {error}
        </div>
      )}

      {/* Create Button */}
      <button onClick={() => setShowCreate(!showCreate)}
        className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[14px] font-semibold cursor-pointer transition-all
          ${isDark ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/15" : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100"}`}>
        <UserPlus className="w-4 h-4" />
        Buat Akun Baru
      </button>

      {/* Create Form */}
      {showCreate && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
          className={`rounded-2xl border p-5 space-y-3 ${card}`}>
          <div className="flex items-center justify-between">
            <p className={`text-[14px] font-semibold ${textPrimary}`}>Akun Baru</p>
            <button onClick={() => setShowCreate(false)}
              className={`w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer ${isDark ? "text-zinc-400 hover:bg-white/[0.06]" : "text-zinc-400 hover:bg-zinc-100"}`}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <input type="text" value={newFullName}
            onChange={(e) => setNewFullName(e.target.value)}
            placeholder="Nama Lengkap"
            className={`w-full rounded-xl border px-4 py-3 text-[14px] outline-none ${inputCls}`} />
          <input type="text" value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="Username"
            className={`w-full rounded-xl border px-4 py-3 text-[14px] outline-none ${inputCls}`} />
          <input type="password" value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Password"
            className={`w-full rounded-xl border px-4 py-3 text-[14px] outline-none ${inputCls}`} />
          <button onClick={handleCreate}
            className="w-full py-3 rounded-xl bg-emerald-500 text-white text-[14px] font-semibold cursor-pointer shadow-sm shadow-emerald-500/20 hover:bg-emerald-600 transition-colors">
            Buat Akun
          </button>
        </motion.div>
      )}

      {/* Users List - Only from Convex */}
      <div className={`rounded-2xl border overflow-hidden ${card}`}>
        <div className={`flex items-center gap-2 px-5 py-3.5 border-b ${isDark ? "border-white/[0.06]" : "border-zinc-100"}`}>
          <Users className={`w-4 h-4 ${textMuted}`} />
          <span className={`text-[14px] font-semibold ${textPrimary}`}>
            Akun Customer ({convexUsers ? convexUsers.filter(u => u.role !== "owner").length : 0})
          </span>
        </div>

        {!convexUsers ? (
          <p className={`text-center text-[13px] py-8 ${textMuted}`}>Memuat...</p>
        ) : (
          <>
            {/* Show owner account */}
            {convexUsers.filter(u => u.role === "owner").map((u) => (
              <div key={u._id} className={`flex items-center gap-3 px-5 py-3.5 ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-zinc-50"} transition-colors`}>
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-amber-400 to-amber-600 flex-shrink-0">
                  <span className="text-[14px] font-bold text-white">{u.fullName.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[14px] font-semibold truncate ${textPrimary}`}>{u.fullName}</p>
                  <p className={`text-[12px] truncate ${textMuted}`}>@{u.username}</p>
                </div>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-amber-500/10 text-amber-500">
                  👑 Owner
                </span>
              </div>
            ))}

            {/* Show customer accounts */}
            {convexUsers.filter(u => u.role !== "owner").length === 0 ? (
              <div className="text-center py-12 px-5">
                <p className={`text-[14px] ${textPrimary}`}>Belum ada akun customer</p>
                <p className={`text-[13px] mt-1 ${textSecondary}`}>
                  Buat akun baru dengan tombol di atas.
                  {"\n"}Akun yang dibuat akan muncul di sini.
                </p>
              </div>
            ) : (
              convexUsers.filter(u => u.role !== "owner").map((u) => (
                <div key={u._id} className={`flex items-center gap-3 px-5 py-3.5 border-t ${isDark ? "border-white/[0.04]" : "border-zinc-50"} ${isDark ? "hover:bg-white/[0.02]" : "hover:bg-zinc-50"} transition-colors`}>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600 flex-shrink-0">
                    <span className="text-[14px] font-bold text-white">{u.fullName.charAt(0)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] font-semibold truncate ${textPrimary}`}>{u.fullName}</p>
                    <p className={`text-[12px] truncate ${textMuted}`}>@{u.username}</p>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-500">
                    👤 Customer
                  </span>
                  <button onClick={() => handleDelete(u._id, u.fullName)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer text-red-400 hover:bg-red-500/10 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* List Semua Pengguna + Password */}
      <button onClick={() => setShowPasswordList(!showPasswordList)}
        className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[14px] font-semibold cursor-pointer transition-all
          ${isDark ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15" : "bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100"}`}>
        <Eye className="w-4 h-4" />
        {showPasswordList ? "Tutup List Pengguna" : "👁️ Lihat Semua Pengguna + Password"}
      </button>

      {showPasswordList && convexUsers && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
          className={`rounded-2xl border overflow-hidden ${card}`}>
          <div className={`px-5 py-3.5 border-b ${isDark ? "border-white/[0.06]" : "border-zinc-100"}`}>
            <p className={`text-[14px] font-semibold ${textPrimary}`}>📋 Daftar Semua Pengguna</p>
            <p className={`text-[11px] ${textMuted} mt-0.5`}>Username & password untuk login</p>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {convexUsers.map((u) => (
              <div key={u._id} className="px-5 py-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${u.role === "owner" ? "bg-gradient-to-br from-amber-400 to-amber-600" : "bg-gradient-to-br from-emerald-400 to-emerald-600"}`}>
                      <span className="text-[13px] font-bold text-white">{u.fullName.charAt(0)}</span>
                    </div>
                    <div>
                      <p className={`text-[13px] font-semibold ${textPrimary}`}>{u.fullName}</p>
                      <p className={`text-[11px] ${textMuted}`}>@{u.username} {u.role === "owner" && "👑"}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowPasswords(p => ({ ...p, [u._id]: !p[u._id] }))}
                      className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer text-zinc-400 hover:bg-white/[0.06]">
                      {showPasswords[u._id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => {
                      navigator.clipboard.writeText(`Username: ${u.username}\nPassword: ${u.password}`);
                      setCopiedId(u._id);
                      setTimeout(() => setCopiedId(null), 1500);
                    }} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer text-zinc-400 hover:bg-white/[0.06]">
                      {copiedId === u._id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div className="mt-2 ml-12 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] ${textMuted} w-16`}>Username:</span>
                    <span className={`text-[12px] font-mono px-2 py-0.5 rounded ${isDark ? "bg-white/[0.06] text-white" : "bg-zinc-100 text-zinc-800"}`}>{u.username}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] ${textMuted} w-16`}>Password:</span>
                    <span className={`text-[12px] font-mono px-2 py-0.5 rounded ${isDark ? "bg-white/[0.06] text-white" : "bg-zinc-100 text-zinc-800"}`}>
                      {showPasswords[u._id] ? u.password : "••••••••"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className={`px-5 py-3 border-t ${isDark ? "border-white/[0.06]" : "border-zinc-100"}`}>
            <p className={`text-[11px] ${textMuted}`}>💡 Klik 👁 untuk show/hide password, 📋 untuk copy</p>
          </div>
        </motion.div>
      )}

      {/* Info */}
      <div className={`rounded-2xl border p-4 ${card}`}>
        <p className={`text-[12px] ${textMuted}`}>
          💡 Yang muncul di sini hanya akun yang dibuat dari Panel Owner ini.
          {"\n"}Akun daftar sendiri (sebelumnya) tidak terlihat di sini karena tersimpan di HP masing-masing.
        </p>
      </div>
    </motion.div>
  );
}
