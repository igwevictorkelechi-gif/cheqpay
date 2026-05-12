import React from 'react';
import { Stack } from 'expo-router';
import { useAuthStore } from '@/store';

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
        cardStyle: { backgroundColor: 'white' },
        animationEnabled: true,
      }}
    >
      <Stack.Screen name="login" options={{ animationEnabled: false }} />
      <Stack.Screen name="signup" />
      <Stack.Screen name="verify-otp" />
    </Stack>
  );
}
