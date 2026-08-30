import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogOut, LayoutDashboard, ArrowLeftRight, Target, FileText,
  Shield, Settings, Menu, X, DollarSign, Moon, Sun, Bell, MessageCircle, Image,
} from "lucide-react";
import { useAuth, useTheme } from "@/contexts/AppContext";
import { useData } from "@/contexts/AppContext";
import type { ViewMode } from "@/lib/types";
import { Crown } from "lucide-react";

interface NavbarProps { currentView: ViewMode; onNavigate: (view: ViewMode) => void; }

export default function Navbar({ currentView, onNavigate }: NavbarProps) {
  const { user, logout, profilePhoto, isOwner } = useAuth();
  const { theme, setTheme } = useTheme();
  const { unreadCount } = useData();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDark = theme === "dark";

  const menuItems: { view: ViewMode; label: string; icon: React.ReactNode }[] = [
    { view: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-[22px] h-[22px]" /> },
    { view: "transactions", label: "Transaksi", icon: <ArrowLeftRight className="w-[22px] h-[22px]" /> },
    { view: "chat", label: "Chat", icon: <MessageCircle className="w-[22px] h-[22px]" /> },
    { view: "budget", label: "Budget & Target", icon: <Target className="w-[22px] h-[22px]" /> },
    { view: "reports", label: "Laporan & Export", icon: <FileText className="w-[22px] h-[22px]" /> },
  ];

  const navCls = isDark
    ? "bg-zinc-900/80 backdrop-blur-xl border-b border-white/[0.06]"
    : "bg-white/80 backdrop-blur-xl border-b border-zinc-200";
  const sidebarBg = isDark ? "bg-zinc-900" : "bg-white";
  const textPrimary = isDark ? "text-white" : "text-zinc-900";
  const textMuted = isDark ? "text-zinc-500" : "text-zinc-400";

  return (
    <>
      {/* Top Nav */}
      <nav className={`sticky top-0 z-40 ${navCls}`}>
        <div className="max-w-lg mx-auto px-5">
          <div className="flex items-center justify-between h-[52px]">
            <button onClick={() => setSidebarOpen(true)}
              className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
                isDark ? "text-zinc-400 hover:bg-white/[0.06]" : "text-zinc-500 hover:bg-zinc-100"
              }`}>
              <Menu className="w-5 h-5" />
            </button>
            <span className={`text-[15px] font-bold tracking-tight ${textPrimary}`}>LaporanPintarID</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setTheme(isDark ? "light" : "dark")}
                className={`w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer transition-colors ${
                  isDark ? "text-amber-400 hover:bg-white/[0.06]" : "text-zinc-500 hover:bg-zinc-100"
                }`}>
                {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
              </button>

            </div>
          </div>
        </div>
      </nav>

      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 z-50 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)} />

            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className={`fixed left-0 top-0 bottom-0 w-[280px] z-50 flex flex-col shadow-2xl ${sidebarBg}`}>

              {/* Header */}
              <div className={`flex items-center gap-3 px-5 py-5 border-b ${
                isDark ? "border-white/[0.06]" : "border-zinc-100"
              }`}>
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center shadow-lg shadow-black/30 flex-shrink-0 border border-white/10">
                  <DollarSign className="w-5 h-5 text-white" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-[16px] font-bold ${textPrimary}`}>LaporanPintarID</p>
                  <p className={`text-[12px] ${textMuted}`}>Kelola keuangan pribadi</p>
                </div>
                <button onClick={() => setSidebarOpen(false)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer flex-shrink-0 transition-colors ${
                    isDark ? "text-zinc-500 hover:bg-white/[0.06]" : "text-zinc-400 hover:bg-zinc-100"
                  }`}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Menu */}
              <div className="flex-1 p-4 space-y-1 overflow-y-auto">
                {menuItems.map((item) => {
                  const active = currentView === item.view;
                  return (
                    <button key={item.view}
                      onClick={() => { onNavigate(item.view); setSidebarOpen(false); }}
                      className={`flex items-center gap-3.5 w-full px-4 py-3.5 rounded-xl text-[15px] font-medium transition-all cursor-pointer ${
                        active
                          ? isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                          : isDark ? "text-zinc-300 hover:bg-white/[0.04]" : "text-zinc-600 hover:bg-zinc-50"
                      }`}>
                      <span className={`flex-shrink-0 relative ${active ? "text-emerald-500" : isDark ? "text-zinc-500" : "text-zinc-400"}`}>
                        {item.icon}
                        {item.view === "notifications" && unreadCount > 0 && (
                          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] rounded-full bg-emerald-500 flex items-center justify-center px-0.5">
                            <span className="text-[8px] font-bold text-white leading-none">{unreadCount > 9 ? "9+" : unreadCount}</span>
                          </span>
                        )}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}

                <div className={`my-3 border-t ${isDark ? "border-white/[0.04]" : "border-zinc-100"}`} />

                {isOwner && (
                  <button onClick={() => { onNavigate("owner"); setSidebarOpen(false); }}
                    className={`flex items-center gap-3.5 w-full px-4 py-3.5 rounded-xl text-[15px] font-medium transition-all cursor-pointer ${
                      currentView === "owner"
                        ? isDark ? "bg-amber-500/10 text-amber-400" : "bg-amber-50 text-amber-600"
                        : isDark ? "text-zinc-300 hover:bg-white/[0.04]" : "text-zinc-600 hover:bg-zinc-50"
                    }`}>
                    <span className={`flex-shrink-0 ${currentView === "owner" ? "text-amber-500" : isDark ? "text-zinc-500" : "text-zinc-400"}`}>
                      <Crown className="w-[22px] h-[22px]" />
                    </span>
                    <span className="truncate">Panel Owner 👑</span>
                  </button>
                )}

                <button onClick={() => { onNavigate("security"); setSidebarOpen(false); }}
                  className={`flex items-center gap-3.5 w-full px-4 py-3.5 rounded-xl text-[15px] font-medium transition-all cursor-pointer ${
                    currentView === "security"
                      ? isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : isDark ? "text-zinc-300 hover:bg-white/[0.04]" : "text-zinc-600 hover:bg-zinc-50"
                  }`}>
                  <span className={`flex-shrink-0 ${currentView === "security" ? "text-emerald-500" : isDark ? "text-zinc-500" : "text-zinc-400"}`}>
                    <Shield className="w-[22px] h-[22px]" />
                  </span>
                  <span className="truncate">Keamanan</span>
                </button>
                <button onClick={() => { onNavigate("settings"); setSidebarOpen(false); }}
                  className={`flex items-center gap-3.5 w-full px-4 py-3.5 rounded-xl text-[15px] font-medium transition-all cursor-pointer ${
                    currentView === "settings"
                      ? isDark ? "bg-emerald-500/10 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                      : isDark ? "text-zinc-300 hover:bg-white/[0.04]" : "text-zinc-600 hover:bg-zinc-50"
                  }`}>
                  <span className={`flex-shrink-0 ${currentView === "settings" ? "text-emerald-500" : isDark ? "text-zinc-500" : "text-zinc-400"}`}>
                    <Settings className="w-[22px] h-[22px]" />
                  </span>
                  <span className="truncate">Pengaturan</span>
                </button>
              </div>

              {/* User */}
              <div className={`mt-auto p-4 border-t ${isDark ? "border-white/[0.06]" : "border-zinc-100"}`}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-400 to-emerald-600 flex-shrink-0">
                    {profilePhoto
                      ? <img src={profilePhoto} className="w-full h-full object-cover" alt="" />
                      : <span className="text-[15px] font-bold text-white">{user?.fullName?.charAt(0) || "U"}</span>
                    }
                  </div>
                  <div className="min-w-0">
                    <p className={`text-[14px] font-semibold truncate ${textPrimary}`}>{user?.fullName}</p>
                    <p className={`text-[12px] truncate ${textMuted}`}>@{user?.username}</p>
                  </div>
                </div>
                <button onClick={() => { logout(); setSidebarOpen(false); }}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-[13px] font-medium text-red-400 hover:bg-red-500/10 cursor-pointer transition-colors">
                  <LogOut className="w-4 h-4" />Keluar
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
