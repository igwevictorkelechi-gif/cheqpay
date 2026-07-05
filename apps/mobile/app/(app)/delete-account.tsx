import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { useAuthStore } from '@/store';
import { authService } from '@/services/auth';
import { api, ApiError } from '@/services/api';

const consequences = [
  'Your wallets, balances and transaction history are erased',
  'Your virtual account and any crypto addresses are closed',
  'This cannot be undone — you’ll need to sign up again',
];

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuthStore();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const canDelete = confirm.trim().toUpperCase() === 'DELETE' && !busy;

  const doDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      await api.deleteAccount();
      try {
        await authService.logout();
      } catch {
        /* ignore — account is already gone */
      }
      logout();
      router.replace('/(auth)/login');
    } catch (e) {
      setBusy(false);
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert(
          'Withdraw your balance first',
          'You still have funds in your wallet. Please withdraw everything before deleting your account.'
        );
      } else {
        Alert.alert('Could not delete account', 'Something went wrong. Please try again.');
      }
    }
  };

  const confirmPrompt = () =>
    Alert.alert(
      'Delete account permanently?',
      'This will erase your CheqPay account and all its data. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: doDelete },
      ]
    );

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        <View className="w-16 h-16 rounded-3xl items-center justify-center mt-6" style={{ backgroundColor: 'rgba(239,68,68,0.15)' }}>
          <Ionicons name="trash" size={30} color="#EF4444" />
        </View>

        <Text className="text-ink text-4xl font-extrabold mt-5 mb-2">Delete account</Text>
        <Text className="text-muted text-base mb-6">
          We’re sorry to see you go. Deleting your account is permanent.
        </Text>

        <View className="bg-card rounded-3xl p-5" style={{ gap: 14 }}>
          {consequences.map((c) => (
            <View key={c} className="flex-row items-start">
              <Ionicons name="close-circle" size={18} color="#EF4444" style={{ marginTop: 2 }} />
              <Text className="text-ink text-sm ml-3 flex-1">{c}</Text>
            </View>
          ))}
        </View>

        <Text className="text-muted text-sm mt-6 mb-2">
          Type <Text className="text-ink font-bold">DELETE</Text> to confirm
        </Text>
        <TextInput
          value={confirm}
          onChangeText={setConfirm}
          autoCapitalize="characters"
          placeholder="DELETE"
          placeholderTextColor={colors.muted}
          className="rounded-2xl px-4 py-3.5 text-ink text-base bg-card"
          style={{ borderWidth: 1, borderColor: colors.border }}
        />

        <TouchableOpacity
          onPress={confirmPrompt}
          disabled={!canDelete}
          className="rounded-full py-4 items-center mt-6"
          style={{ backgroundColor: canDelete ? '#EF4444' : colors.circle }}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-white text-base font-bold">Permanently delete my account</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
