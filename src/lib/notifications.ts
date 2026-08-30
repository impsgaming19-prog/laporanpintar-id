import { formatCurrency } from "./utils";

export interface AppNotification {
  id: string;
  title: string;
  desc: string;
  time: string;
  timestamp: number;
  color: "emerald" | "amber" | "blue" | "red" | "slate";
  read: boolean;
  type: "transaction" | "budget" | "target" | "system";
}

const STORAGE_KEY = "app_notifications";

function getStorageKey(userId: string): string {
  return `${STORAGE_KEY}_${userId}`;
}

export function getNotifications(userId: string): AppNotification[] {
  const data = localStorage.getItem(getStorageKey(userId));
  return data ? JSON.parse(data) : [];
}

export function getUnreadCount(userId: string): number {
  return getNotifications(userId).filter((n) => !n.read).length;
}

export function markAllRead(userId: string): void {
  const notifications = getNotifications(userId).map((n) => ({ ...n, read: true }));
  localStorage.setItem(getStorageKey(userId), JSON.stringify(notifications));
}

export function addNotification(userId: string, notif: Omit<AppNotification, "read"> & { id?: string }): void {
  const notifications = getNotifications(userId);
  // Avoid duplicate notifications within 5 seconds
  const recent = notifications.find(
    (n) => n.title === notif.title && n.desc === notif.desc && Date.now() - n.timestamp < 5000
  );
  if (recent) return;

  const newNotif: AppNotification = {
    ...notif,
    id: notif.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    read: false,
  };
  notifications.unshift(newNotif);
  // Keep max 50 notifications
  if (notifications.length > 50) notifications.pop();
  localStorage.setItem(getStorageKey(userId), JSON.stringify(notifications));

  // Send browser push notification
  sendPushNotification(newNotif);
}

// Generate notifications from real data
export function checkAndGenerateNotifications(
  userId: string,
  transactions: { id: string; type: "income" | "expense"; amount: number; description: string; category: string; createdAt: number }[],
  budgets: { category: string; limit: number }[],
  savingsTargets: { name: string; target: number; current: number }[]
): void {
  const existing = getNotifications(userId);
  const existingIds = new Set(existing.map((n) => n.id));

  // 1. Check recent transactions (last 24h) that don't have notifications yet
  const dayAgo = Date.now() - 86400000;
  const recentTx = transactions.filter((tx) => tx.createdAt > dayAgo);

  recentTx.forEach((tx) => {
    const notifId = `tx-${tx.id}`;
    if (!existingIds.has(notifId)) {
      const icon = tx.type === "income" ? "📈" : "📉";
      const typeLabel = tx.type === "income" ? "Pemasukan" : "Pengeluaran";
      addNotification(userId, {
        id: notifId,
        title: `${icon} Transaksi Baru`,
        desc: `${typeLabel} ${formatCurrency(tx.amount)} dari ${tx.description}`,
        time: formatTimeAgo(tx.createdAt),
        timestamp: tx.createdAt,
        color: tx.type === "income" ? "emerald" : "red",
        type: "transaction",
      });
    }
  });

  // 2. Check budget usage - alert when >80%
  if (budgets.length > 0) {
    const categoryExpenses = new Map<string, number>();
    transactions
      .filter((tx) => tx.type === "expense")
      .forEach((tx) => {
        categoryExpenses.set(tx.category, (categoryExpenses.get(tx.category) || 0) + tx.amount);
      });

    budgets.forEach((budget) => {
      const spent = categoryExpenses.get(budget.category) || 0;
      const pct = (spent / budget.limit) * 100;

      if (pct >= 80 && pct < 100) {
        const notifId = `budget-warn-${budget.category}`;
        if (!existingIds.has(notifId)) {
          addNotification(userId, {
            id: notifId,
            title: "⚠️ Budget Hampir Habis",
            desc: `Budget ${budget.category} sudah ${Math.round(pct)}% (${formatCurrency(spent)} / ${formatCurrency(budget.limit)})`,
            time: "Baru saja",
            timestamp: Date.now(),
            color: "amber",
            type: "budget",
          });
        }
      } else if (pct >= 100) {
        const notifId = `budget-over-${budget.category}`;
        if (!existingIds.has(notifId)) {
          addNotification(userId, {
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

  // 3. Check savings targets - alert when reached
  if (savingsTargets.length > 0) {
    savingsTargets.forEach((target) => {
      if (target.current >= target.target && target.target > 0) {
        const notifId = `target-${target.name}`;
        if (!existingIds.has(notifId)) {
          addNotification(userId, {
            id: notifId,
            title: "🎯 Target Tercapai!",
            desc: `Tabungan "${target.name}" sudah tercapai! ${formatCurrency(target.current)} / ${formatCurrency(target.target)}`,
            time: "Baru saja",
            timestamp: Date.now(),
            color: "blue",
            type: "target",
          });
        }
      }
    });
  }
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  if (hours < 24) return `${hours} jam lalu`;
  return `${days} hari lalu`;
}

// Browser push notification
function sendPushNotification(notif: AppNotification): void {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const colors: Record<string, string> = {
    emerald: "#10b981",
    amber: "#f59e0b",
    blue: "#3b82f6",
    red: "#ef4444",
    slate: "#64748b",
  };

  try {
    new Notification(notif.title, {
      body: notif.desc,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: notif.id,
    });
  } catch {
    // Notification failed silently
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}
