import { create } from "zustand";
import type { User, Wallet, VirtualAccount, Transaction } from "@cheqpay/shared";

// Auth Store
interface AuthStore {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setIsAuthenticated: (isAuthenticated: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loading: true,
  isAuthenticated: false,
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setLoading: (loading) => set({ loading }),
  setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  logout: () => set({ user: null, isAuthenticated: false }),
}));

// Wallet Store
interface WalletStore {
  wallet: Wallet | null;
  virtualAccount: VirtualAccount | null;
  transactions: Transaction[];
  loading: boolean;
  setWallet: (wallet: Wallet | null) => void;
  setVirtualAccount: (virtualAccount: VirtualAccount | null) => void;
  setTransactions: (transactions: Transaction[]) => void;
  setLoading: (loading: boolean) => void;
  updateBalance: (amount: number) => void;
  addTransaction: (transaction: Transaction) => void;
}

export const useWalletStore = create<WalletStore>((set) => ({
  wallet: null,
  virtualAccount: null,
  transactions: [],
  loading: true,
  setWallet: (wallet) => set({ wallet }),
  setVirtualAccount: (virtualAccount) => set({ virtualAccount }),
  setTransactions: (transactions) => set({ transactions }),
  setLoading: (loading) => set({ loading }),
  updateBalance: (amount) =>
    set((state) =>
      state.wallet ? { wallet: { ...state.wallet, balance: state.wallet.balance + amount } } : {}
    ),
  addTransaction: (transaction) =>
    set((state) => ({
      transactions: [transaction, ...state.transactions],
    })),
}));

// UI Store
interface UIStore {
  showBalance: boolean;
  darkMode: boolean;
  sidebarOpen: boolean;
  toggleBalance: () => void;
  setDarkMode: (darkMode: boolean) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  showBalance: true,
  darkMode: false,
  sidebarOpen: true,
  toggleBalance: () => set((state) => ({ showBalance: !state.showBalance })),
  setDarkMode: (darkMode) => set({ darkMode }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));
