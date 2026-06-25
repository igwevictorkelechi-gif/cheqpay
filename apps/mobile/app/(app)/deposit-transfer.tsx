import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { colors, NairaFlag } from '@/components/brand';
import { useAuthStore } from '@/store';
import { depositService, VirtualAccount } from '@/services/deposit';

function Row({ label, children, top }: { label: string; children: React.ReactNode; top?: boolean }) {
  return (
    <View
      className="flex-row items-start justify-between py-3"
      style={top ? undefined : { borderTopWidth: 1, borderTopColor: colors.border }}
    >
      <Text className="text-muted text-sm">{label}</Text>
      <Text className="text-ink text-sm font-bold text-right" style={{ flex: 1, marginLeft: 16 }}>
        {children}
      </Text>
    </View>
  );
}

export default function DepositTransferScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { amount = '1000' } = useLocalSearchParams<{ amount: string }>();
  const amountNum = Number(amount) || 0;

  const [account, setAccount] = useState<VirtualAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    depositService
      .getVirtualAccount(user?.email, user?.full_name, amountNum)
      .then((acc) => active && setAccount(acc))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [user?.email, user?.full_name, amountNum]);

  const fee = account?.fee ?? 150;
  const toSend = amountNum + fee;
  const name = (user?.full_name || 'Cheqpay User').toUpperCase();

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        {/* Amount to send */}
        <View className="items-center mt-4">
          <NairaFlag size={56} />
          <Text className="text-muted text-sm mt-3">Amount to send</Text>
          <Text className="text-ink text-3xl font-extrabold mt-1">
            {toSend.toLocaleString('en-NG')} NGN
          </Text>
        </View>

        {/* Account details */}
        <View className="bg-card rounded-3xl p-5 mt-6">
          <TouchableOpacity
            className="flex-row items-center justify-between py-3"
            onPress={() => {
              if (account) Alert.alert('Copied', 'Account number copied');
            }}
          >
            <Text className="text-muted text-sm">Account number</Text>
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <Text className="text-ink text-base font-bold">
                {loading ? '••••••••••' : account?.account_number}
              </Text>
              <Ionicons name="copy-outline" size={16} color={colors.muted} />
            </View>
          </TouchableOpacity>
          <Row label="Bank name">{loading ? '…' : account?.bank_name}</Row>
          <Row label="Account name">{loading ? '…' : account?.account_name}</Row>
          <Row label="Deposit fee">{fee} NGN</Row>
          <Row label="You will receive">{amountNum.toLocaleString('en-NG')} NGN</Row>
        </View>

        {/* Deposit terms */}
        <View className="flex-row items-start bg-card rounded-3xl p-5 mt-4" style={{ gap: 12 }}>
          <Text style={{ fontSize: 22 }}>🔒</Text>
          <Text className="text-muted text-sm" style={{ flex: 1 }}>
            Only send money from a bank account with the same name as{' '}
            <Text className="text-ink font-semibold">{name}</Text>
          </Text>
        </View>
      </ScrollView>

      {/* CTA */}
      <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 12 }}>
        <TouchableOpacity
          onPress={() => router.push({ pathname: '/(app)/deposit-done', params: { amount } })}
          className="rounded-full py-4 items-center"
          style={{ backgroundColor: colors.brand }}
          activeOpacity={0.85}
        >
          <Text className="text-white text-base font-bold">I have made the transfer</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
