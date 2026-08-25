import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';
import UsdAccountPanel from '@/components/UsdAccountPanel';

/**
 * The dollar account on its own screen.
 *
 * "Verify my dollar account" used to land on the Naira deposit screen, where the
 * USD panel sat below an account number the user did not ask for. A USD account
 * hangs off the provider customer record, so identity verification has to come
 * first — an unverified user is sent straight to KYC rather than shown a form
 * that would fail.
 */
export default function UsdAccountScreen() {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.ensureProvisioned();
        const kyc = await api.getKyc();
        if (!active) return;
        // providerEnrolled is optional on older deployments, so it only blocks
        // when explicitly false.
        if (kyc.kycTier < 2 || kyc.providerEnrolled === false) {
          router.replace('/(app)/kyc');
          return;
        }
        setChecking(false);
      } catch (e) {
        if (!active) return;
        if (e instanceof ApiError && e.status === 401) setNeedsLogin(true);
        setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="flex-row items-center px-5 pt-3 pb-2">
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center"
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 20 }}>
        <Text className="text-ink dark:text-ink-dark text-3xl font-extrabold mt-4">Dollar account</Text>
        <Text className="text-muted dark:text-muted-dark text-sm mt-2">
          Receive US dollars from anywhere. Your dollars sit in their own balance and can be
          converted to Naira or crypto at any time.
        </Text>

        {checking ? (
          <View className="mt-10 items-center">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : needsLogin ? (
          <Text className="text-muted dark:text-muted-dark text-center mt-10">
            Please sign in to open your dollar account.
          </Text>
        ) : (
          <UsdAccountPanel defaultOpen />
        )}
      </ScrollView>
    </View>
  );
}
