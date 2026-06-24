import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuthStore } from '@/store';
import { authService } from '@/services/auth';

export default function RootLayout() {
  const { setUser, setLoading, setIsAuthenticated } = useAuthStore();

  useEffect(() => {
    // Check if user is already logged in
    const checkAuth = async () => {
      const user = await authService.getCurrentUser();
      if (user) {
        setUser(user);
        setIsAuthenticated(true);
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="(auth)"
          options={{
            headerShown: false,
            animationEnabled: true,
          }}
        />
        <Stack.Screen
          name="(app)"
          options={{
            headerShown: false,
            animationEnabled: true,
          }}
        />
      </Stack>
      <StatusBar style="light" />
    </>
  );
}
