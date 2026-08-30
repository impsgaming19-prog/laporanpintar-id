import { useState, useEffect, type FormEvent } from "react";
import { motion } from "framer-motion";
import { User, Lock, Eye, EyeOff, ArrowRight, AlertCircle, DollarSign, Fingerprint, Check } from "lucide-react";
import { useAuth } from "@/contexts/AppContext";
import Button from "@/components/ui/Button";
import { isBiometricAvailable, hasCredential, authenticate } from "@/lib/biometric";

export default function LoginPage() {
  const { login, loginFromConvex } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Fingerprint state
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioRegistered, setBioRegistered] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [bioStatus, setBioStatus] = useState<"idle" | "success" | "failed">("idle");

  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable);
    setBioRegistered(hasCredential());
  }, []);

  const CONVEX_URL = "https://adamant-hedgehog-160.convex.cloud";

  const verifyConvexUser = async (u: string, p: string): Promise<{ id: string; username: string; fullName: string; role: string } | null> => {
    try {
      const res = await fetch(`${CONVEX_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "users:verifyLogin", args: { username: u, password: p } }),
      });
      const data = await res.json();
      return data.value || null;
    } catch {
      return null;
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    // Always verify against Convex first (real password check)
    const convexResult = await verifyConvexUser(username, password);
    if (convexResult) {
      loginFromConvex(username, password, convexResult);
      setIsLoading(false);
      return;
    }

    // Convex not found — try localStorage fallback
    const ok = login(username, password);
    if (ok) {
      setIsLoading(false);
    } else {
      setError("Username atau password salah");
      setIsLoading(false);
    }
  };

  const handleFingerprint = async () => {
    setBioLoading(true);
    setError("");
    try {
      const success = await authenticate();
      if (success) {
        setBioStatus("success");
        const bioUserStr = localStorage.getItem("biometric_login_user");
        if (bioUserStr) {
          const bioUser = JSON.parse(bioUserStr);
          // Always try to get Convex ID first for consistent chat IDs
          if (bioUser.username) {
            // Use Convex query to verify and get real ID
            const convexResult = await new Promise<{ id: string; username: string; fullName: string; role: string } | null>((resolve) => {
              // We'll use a direct fetch to Convex for fingerprint login
              const convexUrl = "https://adamant-hedgehog-160.convex.cloud";
              fetch(`${convexUrl}/api/query`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  path: "users:verifyLogin",
                  args: { username: bioUser.username, password: bioUser.password || bioUser.storedPassword || "" }
                })
              }).then(r => r.json()).then(d => resolve(d.value)).catch(() => resolve(null));
            });
            if (convexResult) {
              const userObj = { id: convexResult.id, username: convexResult.username, fullName: convexResult.fullName, role: convexResult.role };
              localStorage.setItem("auth_user", JSON.stringify(userObj));
              window.location.reload();
              return;
            }
          }
          // Fallback to stored ID
          const userObj = { id: bioUser.id || "1", username: bioUser.username, fullName: bioUser.fullName || bioUser.username };
          localStorage.setItem("auth_user", JSON.stringify(userObj));
          window.location.reload();
        } else {
          setError("Tidak ada akun terdaftar untuk fingerprint. Daftarkan fingerprint di menu Keamanan.");
          setBioStatus("failed");
        }
      } else {
        setBioStatus("failed");
        setError("Fingerprint gagal. Coba lagi atau login manual.");
        setTimeout(() => setBioStatus("idle"), 2000);
      }
    } catch {
      setBioStatus("failed");
      setError("Fingerprint tidak tersedia di device ini.");
      setTimeout(() => setBioStatus("idle"), 2000);
    }
    setBioLoading(false);
  };

  const fieldCls = "w-full bg-white/[0.06] border border-white/[0.08] rounded-xl py-3.5 text-[15px] text-white placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all";

  return (
    <div className="min-h-screen bg-zinc-950 relative">
      {/* Ambient glow */}
      <div className="absolute top-[-150px] left-1/2 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-emerald-500/[0.07] blur-[100px] pointer-events-none" />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="flex items-center gap-3 px-5 pt-12 pb-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center shadow-lg shadow-black/40 flex-shrink-0 border border-white/10">
            <DollarSign className="w-6 h-6 text-white" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[22px] font-extrabold text-white tracking-tight">LaporanPintarID</h1>
            <p className="text-[12px] text-zinc-400">Kelola keuangan pribadi Anda</p>
          </div>
        </motion.div>

        {/* Card */}
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}
          className="flex-1 bg-zinc-900/80 backdrop-blur-xl border-t border-white/[0.06] rounded-t-3xl px-5 pt-5 pb-6">

          {/* Title */}
          <h2 className="text-[18px] font-bold text-white mb-5">Masuk ke Akun</h2>

          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-[13px] text-red-400 mb-4">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </motion.div>
          )}

          {bioStatus === "success" && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-[13px] text-emerald-400 mb-4">
              <Check className="w-4 h-4 flex-shrink-0" /> Fingerprint berhasil! Masuk...
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username field */}
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-zinc-500 pointer-events-none" />
              <input type="text" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} required
                className={`${fieldCls} pl-11 pr-4`} />
            </div>

            {/* Password field */}
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-zinc-500 pointer-events-none" />
              <input type={showPassword ? "text" : "password"} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required
                className={`${fieldCls} pl-11 pr-12`} />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors">
                {showPassword ? <EyeOff className="w-[18px] h-[18px]" /> : <Eye className="w-[18px] h-[18px]" />}
              </button>
            </div>

            <Button type="submit" className="w-full mt-2" size="lg" disabled={isLoading}>
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              ) : (
                <>Masuk <ArrowRight className="w-4 h-4 ml-1" /></>
              )}
            </Button>

            {/* Fingerprint Button */}
            {bioAvailable && bioRegistered && (
              <button type="button" onClick={handleFingerprint} disabled={bioLoading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-[14px] font-semibold transition-all cursor-pointer border border-white/[0.08] hover:bg-white/[0.06] text-zinc-300">
                {bioLoading ? (
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <Fingerprint className="w-5 h-5 text-emerald-400" />
                )}
                Login dengan Fingerprint
              </button>
            )}
          </form>

          <p className="text-center text-[12px] text-zinc-600 mt-6">
            Hubungi admin untuk membuat akun baru
          </p>

          <p className="text-center text-[11px] text-zinc-600 mt-5">LaporanPintarID &copy; 2026</p>
        </motion.div>
      </div>
    </div>
  );
}
