import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { User, Wallet, VirtualAccount } from '@cheqpay/shared';

interface AuthState {
  user: User | null;
  loading: boolean;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  setIsAuthenticated: (isAuthenticated: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  isAuthenticated: false,
  setUser: (user) => set({ user }),
  setLoading: (loading) => set({ loading }),
  setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  logout: () => set({ user: null, isAuthenticated: false }),
}));

interface WalletState {
  wallet: Wallet | null;
  virtualAccount: VirtualAccount | null;
  loading: boolean;
  setWallet: (wallet: Wallet | null) => void;
  setVirtualAccount: (va: VirtualAccount | null) => void;
  setLoading: (loading: boolean) => void;
  updateBalance: (amount: number) => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  wallet: null,
  virtualAccount: null,
  loading: false,
  setWallet: (wallet) => set({ wallet }),
  setVirtualAccount: (virtualAccount) => set({ virtualAccount }),
  setLoading: (loading) => set({ loading }),
  updateBalance: (amount) =>
    set((state) => ({
      wallet: state.wallet ? { ...state.wallet, balance: amount } : null,
    })),
}));

interface UIState {
  showBalance: boolean;
  darkMode: boolean;
  /** The saved theme has been read; until then the root renders nothing, so the
   *  app never flashes the wrong theme on launch. */
  themeReady: boolean;
  toggleBalance: () => void;
  setDarkMode: (darkMode: boolean) => void;
  hydrateTheme: () => Promise<void>;
}

/** Same key and meaning as the website: dark unless the person picked light. */
const THEME_KEY = 'cheqpay:theme';

export const useUIStore = create<UIState>((set) => ({
  showBalance: true,
  // Dark is CheqPay's default look, as on the website.
  darkMode: true,
  themeReady: false,
  toggleBalance: () => set((state) => ({ showBalance: !state.showBalance })),
  setDarkMode: (darkMode) => {
    set({ darkMode });
    AsyncStorage.setItem(THEME_KEY, darkMode ? 'dark' : 'light').catch(() => undefined);
  },
  hydrateTheme: async () => {
    try {
      const saved = await AsyncStorage.getItem(THEME_KEY);
      set({ darkMode: saved !== 'light', themeReady: true });
    } catch {
      set({ themeReady: true });
    }
  },
}));
