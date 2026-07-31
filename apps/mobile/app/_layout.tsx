import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { NativeWindStyleSheet } from 'nativewind';
import { useAuthStore, useUIStore } from '@/store';
import { authService } from '@/services/auth';
import { LockGate } from '@/components/LockGate';
import { applyPalette } from '@/components/brand';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, loading, setUser, setLoading, setIsAuthenticated } = useAuthStore();
  const darkMode = useUIStore((s) => s.darkMode);

  // Two halves of the theme, applied before children render:
  //  - inline styles read the mutable `colors` palette (components/theme.ts)
  //  - Tailwind classes use dark: variants, switched by NativeWind
  // Both are idempotent, so running them each render is harmless.
  applyPalette(darkMode);
  NativeWindStyleSheet.setColorScheme(darkMode ? 'dark' : 'light');

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
    if (loading) return;
    const inAuthGroup = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated, loading, segments]);

  return (
    <LockGate>
      {/* Keyed on the theme so switching remounts the navigator and every
          screen re-reads the palette. Screens react-navigation is holding in
          the background would otherwise keep the old colours until refocused,
          which looks broken; a nav reset on a deliberate, rare action is the
          better trade. */}
      <Stack key={darkMode ? 'dark' : 'light'} screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={darkMode ? 'light' : 'dark'} />
    </LockGate>
  );
}
