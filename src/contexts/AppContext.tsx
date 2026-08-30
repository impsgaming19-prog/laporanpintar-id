import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type { User, Transaction } from "@/lib/types";
import { generateId } from "@/lib/utils";
import {
  type AppNotification,
  getNotifications,
  getUnreadCount,
  markAllRead as storeMarkAllRead,
  addNotification as storeAddNotification,
  requestNotificationPermission,
} from "@/lib/notifications";

export type Theme = "light" | "dark" | "blue" | "green";

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => boolean;
  register: (username: string, password: string, fullName: string) => boolean;
  loginFromConvex: (username: string, password: string, convexUser: { id: string; username: string; fullName: string; role: string }) => boolean;
  logout: () => void;
  isAuthenticated: boolean;
  isOwner: boolean;
  profilePhoto: string | null;
  setProfilePhoto: (photo: string | null) => void;
  biometricEnabled: boolean;
  setBiometricEnabled: (enabled: boolean) => void;
}

interface DataContextType {
  transactions: Transaction[];
  addTransaction: (tx: Omit<Transaction, "id" | "userId" | "createdAt">) => void;
  updateTransaction: (id: string, tx: Partial<Transaction>) => void;
  deleteTransaction: (id: string) => void;
  notifications: AppNotification[];
  unreadCount: number;
  markAllRead: () => void;
  refreshNotifications: () => void;
}

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);
const DataContext = createContext<DataContextType | null>(null);
const ThemeContext = createContext<ThemeContextType | null>(null);

const DEMO_USERS: { username: string; password: string; user: User }[] = [];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("auth_user");
    return saved ? JSON.parse(saved) : null;
  });
  const [profilePhoto, setProfilePhotoState] = useState<string | null>(() => {
    return localStorage.getItem("profile_photo") || null;
  });
  const [biometricEnabled, setBiometricEnabled] = useState<boolean>(() => {
    return localStorage.getItem("biometric_enabled") === "true";
  });

  // Set favicon from saved profile photo on mount
  useEffect(() => {
    if (profilePhoto) {
      const link = document.querySelector("link[rel='icon']") as HTMLLinkElement;
      if (link) {
        link.type = "image/png";
        link.href = profilePhoto;
      }
    }
  }, []);

  const setProfilePhoto = useCallback((photo: string | null) => {
    setProfilePhotoState(photo);
    if (photo) localStorage.setItem("profile_photo", photo);
    else localStorage.removeItem("profile_photo");
  }, []);

  const setBiometric = useCallback((enabled: boolean) => {
    setBiometricEnabled(enabled);
    localStorage.setItem("biometric_enabled", String(enabled));
  }, []);

  const login = useCallback((username: string, password: string): boolean => {
    // Check registered users (localStorage)
    const registered: { username: string; password: string; user: User }[] = JSON.parse(localStorage.getItem("registered_users") || "[]");
    const regFound = registered.find((u) => u.username === username && u.password === password);
    if (regFound) {
      setUser(regFound.user);
      localStorage.setItem("auth_user", JSON.stringify(regFound.user));
      return true;
    }
    return false;
  }, []);

  const loginFromConvex = useCallback((username: string, password: string, convexUser: { id: string; username: string; fullName: string; role: string }): boolean => {
    const newUser: User = { id: convexUser.id, username: convexUser.username, fullName: convexUser.fullName, role: convexUser.role };
    setUser(newUser);
    localStorage.setItem("auth_user", JSON.stringify(newUser));
    return true;
  }, []);

  const register = useCallback((username: string, password: string, fullName: string): boolean => {
    // Check if username already exists
    const allUsers = JSON.parse(localStorage.getItem("registered_users") || "[]") as { username: string }[];
    if (allUsers.some((u) => u.username === username)) return false;
    const newUser: User = { id: generateId(), username, fullName };
    const registered: { username: string; password: string; user: User }[] = JSON.parse(localStorage.getItem("registered_users") || "[]");
    registered.push({ username, password, user: newUser });
    localStorage.setItem("registered_users", JSON.stringify(registered));
    setUser(newUser);
    localStorage.setItem("auth_user", JSON.stringify(newUser));
    return true;
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem("auth_user");
  }, []);

  const isOwner = user?.username === "Owner01" || user?.role === "owner";

  return (
    <AuthContext.Provider value={{ user, login, register, loginFromConvex, logout, isAuthenticated: !!user, isOwner, profilePhoto, setProfilePhoto, biometricEnabled, setBiometricEnabled: setBiometric }}>
      {children}
    </AuthContext.Provider>
  );
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem("transactions");
    return saved ? JSON.parse(saved) : [];
  });
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    localStorage.setItem("transactions", JSON.stringify(transactions));
  }, [transactions]);

  // Refresh notifications from storage
  const refreshNotifications = useCallback(() => {
    if (!user) return;
    const notifs = getNotifications(user.id);
    setNotifications(notifs);
    setUnreadCount(getUnreadCount(user.id));
  }, [user]);

  // Load notifications on mount and when user changes
  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  // Auto-check notifications when transactions change
  useEffect(() => {
    if (!user) return;

    // Load budgets & savings from localStorage
    const budgets: { id: string; category: string; amount: number }[] = JSON.parse(localStorage.getItem("budgets") || "[]");
    const savingsTargets: { id: string; name: string; target: number; current: number }[] = JSON.parse(localStorage.getItem("savings_targets") || "[]");

    // 1. Check recent transactions (last 24h) — create notification for each
    const dayAgo = Date.now() - 86400000;
    const recentTx = transactions.filter((tx) => tx.createdAt > dayAgo);
    const existing = getNotifications(user.id);
    const existingIds = new Set(existing.map((n) => n.id));

    recentTx.forEach((tx) => {
      const notifId = `tx-${tx.id}`;
      if (!existingIds.has(notifId)) {
        const icon = tx.type === "income" ? "📈" : "📉";
        const typeLabel = tx.type === "income" ? "Pemasukan" : "Pengeluaran";
        storeAddNotification(user.id, {
          id: notifId,
          title: `${icon} Transaksi Baru`,
          desc: `${typeLabel} ${formatCurrencyHelper(tx.amount)} dari ${tx.description}`,
          time: formatTimeAgoHelper(tx.createdAt),
          timestamp: tx.createdAt,
          color: tx.type === "income" ? "emerald" : "red",
          type: "transaction",
        });
      }
    });

    // 2. Check budget warnings
    if (budgets.length > 0) {
      const categoryExpenses = new Map<string, number>();
      transactions
        .filter((tx) => tx.type === "expense")
        .forEach((tx) => {
          categoryExpenses.set(tx.category, (categoryExpenses.get(tx.category) || 0) + tx.amount);
        });

      budgets.forEach((budget) => {
        const spent = categoryExpenses.get(budget.category) || 0;
        const pct = (spent / budget.amount) * 100;

        if (pct >= 80 && pct < 100) {
          const notifId = `budget-warn-${budget.category}`;
          if (!existingIds.has(notifId)) {
            storeAddNotification(user.id, {
              id: notifId,
              title: "⚠️ Budget Hampir Habis",
              desc: `Budget ${budget.category} sudah ${Math.round(pct)}% (${formatCurrencyHelper(spent)} / ${formatCurrencyHelper(budget.amount)})`,
              time: "Baru saja",
              timestamp: Date.now(),
              color: "amber",
              type: "budget",
            });
          }
        } else if (pct >= 100) {
          const notifId = `budget-over-${budget.category}`;
          if (!existingIds.has(notifId)) {
            storeAddNotification(user.id, {
              id: notifId,
              title: "🚨 Budget Melebihi Batas!",
              desc: `Budget ${budget.category} sudah ${Math.round(pct)}%! Segera atur pengeluaran.`,
              time: "Baru saja",
              timestamp: Date.now(),
              color: "red",
              type: "budget",
            });
          }
        }
      });
    }

    // 3. Check savings targets
    if (savingsTargets.length > 0) {
      savingsTargets.forEach((target) => {
        if (target.current >= target.target && target.target > 0) {
          const notifId = `target-${target.name}`;
          if (!existingIds.has(notifId)) {
            storeAddNotification(user.id, {
              id: notifId,
              title: "🎯 Target Tercapai!",
              desc: `Tabungan "${target.name}" sudah tercapai! ${formatCurrencyHelper(target.current)} / ${formatCurrencyHelper(target.target)}`,
              time: "Baru saja",
              timestamp: Date.now(),
              color: "blue",
              type: "target",
            });
          }
        }
      });
    }

    refreshNotifications();
  }, [transactions, user, refreshNotifications]);

  const markAllRead = useCallback(() => {
    if (!user) return;
    storeMarkAllRead(user.id);
    refreshNotifications();
  }, [user, refreshNotifications]);

  const addTransaction = useCallback(
    (tx: Omit<Transaction, "id" | "userId" | "createdAt">) => {
      if (!user) return;
      setTransactions((prev) => [{ ...tx, id: generateId(), userId: user.id, createdAt: Date.now() }, ...prev]);
    },
    [user]
  );

  const updateTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
    setTransactions((prev) => prev.map((tx) => (tx.id === id ? { ...tx, ...updates } : tx)));
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((tx) => tx.id !== id));
  }, []);

  // Request notification permission on first load
  useEffect(() => {
    if (user) {
      requestNotificationPermission();
    }
  }, [user]);

  const userTransactions = transactions.filter((tx) => tx.userId === user?.id);

  return (
    <DataContext.Provider value={{ transactions: userTransactions, addTransaction, updateTransaction, deleteTransaction, notifications, unreadCount, markAllRead, refreshNotifications }}>
      {children}
    </DataContext.Provider>
  );
}

function formatCurrencyHelper(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatTimeAgoHelper(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  if (hours < 24) return `${hours} jam lalu`;
  return `${days} hari lalu`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("app_theme");
    return (saved as Theme) || "light";
  });

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem("app_theme", t);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
