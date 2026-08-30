export interface User {
  id: string;
  username: string;
  fullName: string;
  role?: string;
}

export interface Transaction {
  id: string;
  userId: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  date: string;
  createdAt: number;
  image?: string;
}

export interface DateFilter {
  startDate: string;
  endDate: string;
}

export type ViewMode = "dashboard" | "add" | "transactions" | "reports" | "settings" | "budget" | "security" | "chat" | "notifications" | "gallery" | "owner";
