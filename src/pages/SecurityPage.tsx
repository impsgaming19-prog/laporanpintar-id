import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, Check, Fingerprint, AlertTriangle, AlertCircle } from "lucide-react";
import { useAuth, useTheme } from "@/contexts/AppContext";
import Button from "@/components/ui/Button";
import { isBiometricAvailable, registerCredential, hasCredential, removeCredential } from "@/lib/biometric";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function SecurityPage() {
  const { user, biometricEnabled, setBiometricEnabled } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioRegistered, setBioRegistered] = useState(false);
  const [bioStatus, setBioStatus] = useState<"idle" | "registering" | "success" | "failed">("idle");

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable);
    setBioRegistered(hasCredential());
  }, []);

  const card = isDark ? "bg-zinc-900 border-white/[0.06]" : "bg-white border-zinc-200 shadow-sm";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textSecondary = isDark ? "text-zinc-400" : "text-zinc-500";
  const textMuted = isDark ? "text-zinc-500" : "text-zinc-400";
  const inputCls = isDark
    ? "bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-zinc-500"
    : "bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder:text-zinc-400";

  const changePassword = useMutation(api.users.changePassword);

  const handlePasswordChange = async () => {
    setPasswordError("");
    if (!currentPassword || !newPassword) {
      setPasswordError("Isi semua field");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("Password baru tidak cocok");
      return;
    }
    if (newPassword.length < 4) {
      setPasswordError("Password baru minimal 4 karakter");
      return;
    }
    if (!user?.id) {
      setPasswordError("Tidak ada user login");
      return;
    }
    try {
      const result = await changePassword({
        userId: user.id as any,
        currentPassword,
        newPassword,
      });
      if (result.success) {
        setShowSuccess(true); setTimeout(() => setShowSuccess(false), 3000);
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      } else {
        setPasswordError(result.error || "Gagal mengubah password");
      }
    } catch {
      setPasswordError("Terjadi kesalahan, coba lagi");
    }
  };

  const handleBiometricToggle = async () => {
    if (biometricEnabled) {
      removeCredential();
      localStorage.removeItem("biometric_login_user");
      setBiometricEnabled(false);
      setBioRegistered(false);
      setBioStatus("idle");
      return;
    }
    if (!bioAvailable) return;
    setBioStatus("registering");
    try {
      const success = await registerCredential(user?.id || "1", user?.username || "admin");
      if (success) {
        localStorage.setItem("biometric_login_user", JSON.stringify({ id: user?.id, username: user?.username, fullName: user?.fullName, password: currentPassword || "" }));
        setBiometricEnabled(true);
        setBioRegistered(true);
        setBioStatus("success");
        setTimeout(() => setBioStatus("idle"), 2000);
      } else {
        setBioStatus("failed");
        setTimeout(() => setBioStatus("idle"), 2000);
      }
    } catch {
      setBioStatus("failed");
      setTimeout(() => setBioStatus("idle"), 2000);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-5 pt-5 pb-8 space-y-4">

      <h1 className={`text-[20px] font-bold ${textPrimary}`}>Keamanan</h1>
      <p className={`text-[13px] ${textMuted}`}>Kelola keamanan akun Anda</p>

      {/* Ubah Password */}
      <div className={`rounded-2xl border shadow-sm p-5 ${card}`}>
        <div className="flex items-center gap-2.5 mb-4">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? "bg-white/[0.04]" : "bg-zinc-50"}`}>
            <Lock className={`w-4 h-4 ${textMuted}`} />
          </div>
          <span className={`text-[14px] font-semibold ${textPrimary}`}>Ubah Password</span>
        </div>
        <div className="space-y-3">
          <div className="relative">
            <input type={showCurrent ? "text" : "password"} placeholder="Password saat ini" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
              className={`w-full rounded-xl px-4 py-2.5 text-[14px] transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 pr-10 ${inputCls}`} />
            <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer">
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="relative">
            <input type={showNew ? "text" : "password"} placeholder="Password baru" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className={`w-full rounded-xl px-4 py-2.5 text-[14px] transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 pr-10 ${inputCls}`} />
            <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer">
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="relative">
            <input type={showConfirm ? "text" : "password"} placeholder="Konfirmasi password baru" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
              className={`w-full rounded-xl px-4 py-2.5 text-[14px] transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 pr-10 ${inputCls}`} />
            <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer">
              {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {passwordError && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-[13px] text-red-500">
              <AlertCircle className="w-4 h-4" /> {passwordError}
            </motion.div>
          )}
          {showSuccess && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 text-[13px] text-emerald-500">
              <Check className="w-4 h-4" /> Password berhasil diubah!
            </motion.div>
          )}
          <Button onClick={handlePasswordChange} className="w-full" size="md">Simpan Password</Button>
        </div>
      </div>

      {/* Fingerprint */}
      <div className={`rounded-2xl border shadow-sm p-5 ${card}`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? "bg-blue-500/15" : "bg-blue-50"}`}>
              <Fingerprint className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <span className={`text-[14px] font-semibold ${textPrimary}`}>Fingerprint Login</span>
              <p className={`text-[12px] ${textMuted}`}>
                {!bioAvailable ? "Tidak didukung di browser ini"
                  : bioRegistered ? "Terdaftar & aktif"
                  : "Daftarkan sidik jari untuk login cepat"}
              </p>
            </div>
          </div>
          <button onClick={handleBiometricToggle}
            disabled={!bioAvailable || bioStatus === "registering"}
            className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
              biometricEnabled ? "bg-emerald-500"
                : !bioAvailable ? "bg-zinc-300 cursor-not-allowed"
                : isDark ? "bg-white/10" : "bg-zinc-200"
            }`}>
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${biometricEnabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
          </button>
        </div>

        {bioAvailable && !bioRegistered && (
          <motion.button whileTap={{ scale: 0.97 }} onClick={handleBiometricToggle}
            disabled={bioStatus === "registering"}
            className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-[14px] font-semibold transition-all cursor-pointer border ${
              bioStatus === "registering"
                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 animate-pulse"
                : isDark ? "bg-white/[0.04] text-zinc-400 border-white/[0.08] hover:border-white/[0.15]"
                         : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100"
            }`}>
            {bioStatus === "registering" ? (
              <><Fingerprint className="w-5 h-5 animate-pulse" /> Sentuh Sensor Fingerprint...</>
            ) : (
              <><Fingerprint className="w-5 h-5" /> Daftarkan Fingerprint</>
            )}
          </motion.button>
        )}

        {bioStatus === "success" && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5 text-[13px] text-emerald-500 mt-2">
            <Check className="w-4 h-4" /> Fingerprint berhasil didaftarkan!
          </motion.div>
        )}

        {bioStatus === "failed" && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2.5 text-[13px] text-red-500 mt-2">
            <AlertCircle className="w-4 h-4" /> Pendaftaran gagal. Coba lagi.
          </motion.div>
        )}

        {!bioAvailable && (
          <div className={`rounded-xl px-3 py-2.5 text-[13px] mt-2 ${isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-600"}`}>
            <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
            Browser/device ini tidak mendukung fingerprint sensor
          </div>
        )}
      </div>

      {/* Tips */}
      <div className={`rounded-2xl border shadow-sm p-5 ${isDark ? "bg-amber-500/5 border-amber-500/20" : "bg-amber-50 border-amber-200"}`}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className={`text-[14px] font-semibold ${textPrimary}`}>Tips Keamanan</p>
            <ul className={`text-[13px] ${textSecondary} mt-1.5 space-y-1`}>
              <li>• Gunakan password yang kuat (minimal 8 karakter)</li>
              <li>• Jangan gunakan password yang sama dengan akun lain</li>
              <li>• Aktifkan fingerprint untuk kemudahan login</li>
            </ul>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
