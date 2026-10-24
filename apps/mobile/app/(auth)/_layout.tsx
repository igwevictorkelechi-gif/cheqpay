import { Stack } from 'expo-router';
import { useAuthStore } from '@/store';
import { colors } from '@/components/brand';

export default function AuthLayout() {
  const { isAuthenticated, loading } = useAuthStore();

  if (loading) {
    return null; // Show splash screen while loading
  }

  if (isAuthenticated) {
    return <Stack screenOptions={{ headerShown: false }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.backdrop },
        animation: 'default',
      }}
    >
      <Stack.Screen name="login" options={{ animation: 'none' }} />
      <Stack.Screen name="signup" />
      <Stack.Screen name="verify-otp" />
    </Stack>
  );
}
