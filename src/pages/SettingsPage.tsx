import { useRef } from "react";
import { motion } from "framer-motion";
import { Camera, User, Palette, Fingerprint, Info, HelpCircle, Shield, LogOut } from "lucide-react";
import { useAuth, useTheme, type Theme } from "@/contexts/AppContext";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

export default function SettingsPage() {
  const { user, profilePhoto, setProfilePhoto, biometricEnabled, setBiometricEnabled, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const upsertUser = useMutation(api.chat.upsertUser);
  const isDark = theme === "dark";

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      // Compress before saving (Convex has ~1MB doc limit)
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxSize = 400;
        let w = img.width;
        let h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = (h / w) * maxSize; w = maxSize; }
          else { w = (w / h) * maxSize; h = maxSize; }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          setProfilePhoto(dataUrl);
          // Update favicon with profile photo
          const link = document.querySelector("link[rel='icon']") as HTMLLinkElement;
          if (link) {
            link.type = "image/png";
            link.href = dataUrl;
          }
          // Immediately sync to Convex so other users can see the photo
          if (user) {
            upsertUser({ userId: user.id, username: user.username, fullName: user.fullName, profilePhoto: dataUrl }).catch(() => {});
          }
        }
      };
      img.src = raw;
    };
    reader.readAsDataURL(file);
  };

  const themes: { id: Theme; label: string; desc: string; color: string }[] = [
    { id: "light", label: "Terang", desc: "Bersih & jelas", color: "bg-white border-gray-200" },
    { id: "dark", label: "Gelap", desc: "Elegan & modern", color: "bg-[#0f172a] border-white/10" },
  ];

  const card = isDark ? "bg-[#1e293b] border-white/[0.06]" : "bg-white border-gray-100";

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      className="max-w-lg mx-auto px-5 pt-5 pb-8 space-y-4">

      <h1 className={`text-[20px] font-bold ${isDark ? "text-white" : "text-gray-900"}`}>Pengaturan</h1>

      {/* Profile */}
      <div className={`rounded-2xl border shadow-sm p-5 ${card}`}>
        <div className="flex items-center gap-4">
          <div className="relative">
            {profilePhoto
              ? <img src={profilePhoto} alt="Avatar" className="w-16 h-16 rounded-2xl object-cover" />
              : <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                  <User className="w-8 h-8 text-white" />
                </div>
            }
            <button onClick={() => fileInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center shadow-lg cursor-pointer">
              <Camera className="w-3.5 h-3.5 text-white" />
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
          </div>
          <div>
            <p className={`text-[15px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>{user?.fullName}</p>
            <p className={`text-[13px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>@{user?.username}</p>
            <button onClick={() => fileInputRef.current?.click()} className="text-[13px] text-emerald-500 font-medium mt-0.5 cursor-pointer">Ubah Foto</button>
          </div>
        </div>
      </div>

      {/* Theme */}
      <div className={`rounded-2xl border shadow-sm p-5 ${card}`}>
        <div className="flex items-center gap-2 mb-3">
          <Palette className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-gray-400"}`} />
          <span className={`text-[14px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Tema</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {themes.map((t) => (
            <motion.button whileTap={{ scale: 0.95 }} key={t.id} onClick={() => setTheme(t.id)}
              className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                theme === t.id
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                  : isDark ? "bg-[#0f172a] border-white/[0.06] text-slate-400 hover:border-white/[0.12]"
                           : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100"
              }`}>
              <div className={`w-8 h-8 rounded-lg border flex-shrink-0 ${t.color}`} />
              <div className="text-left">
                <p className="text-[13px] font-semibold">{t.label}</p>
                <p className={`text-[11px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{t.desc}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>

      {/* Biometric */}
      <div className={`rounded-2xl border shadow-sm p-5 ${card}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? "bg-blue-500/15" : "bg-blue-50"}`}>
              <Fingerprint className="w-4 h-4 text-blue-500" />
            </div>
            <div>
              <span className={`text-[14px] font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Fingerprint Login</span>
              <p className={`text-[12px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>Aktifkan login dengan sidik jari</p>
            </div>
          </div>
          <button onClick={() => setBiometricEnabled(!biometricEnabled)}
            className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${biometricEnabled ? "bg-emerald-500" : isDark ? "bg-white/10" : "bg-gray-200"}`}>
            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${biometricEnabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
          </button>
        </div>
      </div>

      {/* Menu Items */}
      <div className={`rounded-2xl border shadow-sm overflow-hidden ${card}`}>
        <MenuItem icon={<Shield className="w-4 h-4" />} label="Keamanan" desc="Ubah password & PIN" isDark={isDark} />
        <MenuItem icon={<HelpCircle className="w-4 h-4" />} label="Bantuan" desc="FAQ & panduan" isDark={isDark} />
        <MenuItem icon={<Info className="w-4 h-4" />} label="Tentang" desc="Versi 1.0.0" isDark={isDark} />
      </div>

      {/* Logout */}
      <motion.button whileTap={{ scale: 0.97 }} onClick={logout}
        className={`w-full flex items-center justify-center gap-2 py-3 rounded-2xl text-[14px] font-semibold transition-all cursor-pointer border
          ${isDark ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/15" : "bg-red-50 text-red-500 border-red-200 hover:bg-red-100"}`}>
        <LogOut className="w-4 h-4" /> Keluar
      </motion.button>
    </motion.div>
  );
}

function MenuItem({ icon, label, desc, isDark }: { icon: React.ReactNode; label: string; desc: string; isDark: boolean }) {
  return (
    <div className={`flex items-center gap-3 px-5 py-3.5 border-b last:border-b-0 cursor-pointer transition-colors
      ${isDark ? "border-white/[0.04] active:bg-white/[0.03]" : "border-gray-50 active:bg-gray-50"}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDark ? "bg-white/[0.04] text-slate-500" : "bg-gray-50 text-gray-400"}`}>{icon}</div>
      <div>
        <p className={`text-[14px] font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{label}</p>
        <p className={`text-[12px] ${isDark ? "text-slate-500" : "text-gray-400"}`}>{desc}</p>
      </div>
    </div>
  );
}
