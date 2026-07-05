import { Redirect } from 'expo-router';
import { useAuthStore } from '@/store';

// Entry route: send users to the app or the login screen based on auth state.
export default function Index() {
  const { isAuthenticated, loading } = useAuthStore();
  if (loading) return null;
  return <Redirect href={isAuthenticated ? '/(app)/home' : '/(auth)/login'} />;
}
