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
  /** Play a subtle click sound on button taps. */
  sound: boolean;
  toggleBalance: () => void;
  setDarkMode: (darkMode: boolean) => void;
  setSidebarOpen: (sidebarOpen: boolean) => void;
  setSound: (sound: boolean) => void;
}

const THEME_KEY = "cheqpay:theme";
const SOUND_KEY = "cheqpay:sound";

function initialSound(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Apply the theme to <html data-theme>. Dark is the default (no attribute). */
function applyTheme(dark: boolean) {
  if (typeof document === "undefined") return;
  if (dark) document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", "light");
}

function initialDarkMode(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(THEME_KEY) !== "light";
}

export const useUIStore = create<UIStore>((set) => ({
  showBalance: true,
  darkMode: initialDarkMode(),
  sidebarOpen: true,
  sound: initialSound(),
  toggleBalance: () => set((state) => ({ showBalance: !state.showBalance })),
  setDarkMode: (darkMode) => {
    try {
      window.localStorage.setItem(THEME_KEY, darkMode ? "dark" : "light");
    } catch {
      /* storage unavailable */
    }
    applyTheme(darkMode);
    set({ darkMode });
  },
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSound: (sound) => {
    try {
      window.localStorage.setItem(SOUND_KEY, sound ? "on" : "off");
    } catch {
      /* storage unavailable */
    }
    set({ sound });
  },
}));
