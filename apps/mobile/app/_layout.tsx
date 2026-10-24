import '@/lib/polyfills';
import { useEffect, useMemo } from 'react';
import { useFonts } from 'expo-font';
import { Stack, useRouter, useSegments } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { NativeWindStyleSheet } from 'nativewind';
import { useAuthStore, useUIStore } from '@/store';
import { authService } from '@/services/auth';
import { LockGate } from '@/components/LockGate';
import { applyPalette, colors } from '@/components/brand';
import TransactionPinProvider from '@/components/TransactionPinProvider';
import { FONTS } from '@/lib/fonts';

// Compile Tailwind classes to native styles on every platform (the default on
// web is CSS output, which needs a stylesheet this app doesn't ship), so the
// web preview renders the same as the phone.
NativeWindStyleSheet.setOutput({ default: 'native' });

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, loading, setUser, setLoading, setIsAuthenticated } = useAuthStore();
  const darkMode = useUIStore((s) => s.darkMode);
  const themeReady = useUIStore((s) => s.themeReady);
  const hydrateTheme = useUIStore((s) => s.hydrateTheme);
  // A font that fails to load leaves the system font in place rather than a
  // blank app, so an error counts as ready too.
  const [fontsLoaded, fontError] = useFonts(FONTS);
  const ready = themeReady && (fontsLoaded || !!fontError);

  // Two halves of the theme, applied before children render:
  //  - inline styles read the mutable `colors` palette (components/theme.ts)
  //  - Tailwind classes use dark: variants, switched by NativeWind
  // Both are idempotent, so running them each render is harmless.
  applyPalette(darkMode);
  NativeWindStyleSheet.setColorScheme(darkMode ? 'dark' : 'light');

  useEffect(() => {
    hydrateTheme();
  }, [hydrateTheme]);

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const user = await authService.getCurrentUser();
      if (user) {
        setUser(user);
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  // Gate the app: unauthenticated users can only be in the (auth) group. (We
  // don't force authenticated users out of (auth) here — the login/verify
  // screens navigate forward themselves, e.g. new sign-ups go to onboarding.)
  useEffect(() => {
    // Wait for the navigator to mount (it isn't rendered until `ready`).
    if (loading || !ready) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, loading, segments, ready]);

  // The navigator's own backdrop (behind screens during transitions, under
  // the tab bar) in the app's colours. Left on react-navigation's default it
  // is near-white, which flashes between dark screens.
  const navTheme = useMemo(() => {
    const base = darkMode ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: colors.surface, card: colors.surface, primary: colors.brand } };
  }, [darkMode]);

  // Nothing until the typeface and the saved theme are in, so the first frame
  // is already in the right font and colours.
  if (!ready) return null;

  return (
    <LockGate>
      {/* Wraps the navigator so any screen can ask for the transaction PIN
          before moving money, without each carrying its own sheet. */}
      <TransactionPinProvider>
      {/* Keyed on the theme so switching remounts the navigator and every
          screen re-reads the palette. Screens react-navigation is holding in
          the background would otherwise keep the old colours until refocused,
          which looks broken; a nav reset on a deliberate, rare action is the
          better trade. */}
      <ThemeProvider value={navTheme}>
        <Stack key={darkMode ? 'dark' : 'light'} screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack>
      </ThemeProvider>
      <StatusBar style={darkMode ? 'light' : 'dark'} />
      </TransactionPinProvider>
    </LockGate>
  );
}
