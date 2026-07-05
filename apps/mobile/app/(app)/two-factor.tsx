import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { colors } from '@/components/brand';
import { supabase } from '@/services/supabase';

type Mode = 'loading' | 'disabled' | 'enrolling' | 'enabled';

export default function TwoFactorScreen() {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<Mode>('loading');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    const verified = data?.totp?.find((f) => f.status === 'verified');
    setMode(verified ? 'enabled' : 'disabled');
    setFactorId(verified?.id ?? null);
  };

  useEffect(() => {
    refresh().catch(() => setMode('disabled'));
  }, []);

  const startEnroll = async () => {
    setBusy(true);
    try {
      // Clean up any dangling unverified factor first (`totp` lists only
      // verified factors, so look through `all`).
      const { data: list } = await supabase.auth.mfa.listFactors();
      const stale = list?.all?.find(
        (f) => f.factor_type === 'totp' && f.status === 'unverified'
      );
      if (stale) await supabase.auth.mfa.unenroll({ factorId: stale.id });

      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
      if (error || !data) throw error;
      setFactorId(data.id);
      setSecret(data.totp.secret);
      setUri(data.totp.uri);
      setMode('enrolling');
    } catch {
      Alert.alert('Could not start setup', 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!factorId || code.length !== 6) return;
    setBusy(true);
    try {
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
      if (cErr || !challenge) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code,
      });
      if (vErr) throw vErr;
      setCode('');
      await refresh();
      Alert.alert('2FA enabled', 'Two-step authentication is now protecting your account.');
    } catch {
      Alert.alert('Invalid code', 'That code didn’t match. Try the current one from your app.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    if (!factorId) return;
    Alert.alert('Turn off 2FA?', 'Your account will be less protected.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await supabase.auth.mfa.unenroll({ factorId });
            await refresh();
          } catch {
            Alert.alert('Could not disable', 'Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

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

        <Text className="text-ink text-4xl font-extrabold mt-6 mb-2">2-step authentication</Text>
        <Text className="text-muted text-base mb-6">
          Use an authenticator app like Google Authenticator for an extra layer of security.
        </Text>

        {mode === 'loading' && (
          <View className="py-12 items-center">
            <ActivityIndicator color={colors.brand} />
          </View>
        )}

        {mode === 'enabled' && (
          <>
            <View className="flex-row items-center bg-card rounded-3xl p-5">
              <View className="w-12 h-12 rounded-2xl items-center justify-center" style={{ backgroundColor: 'rgba(52,199,89,0.15)' }}>
                <Ionicons name="shield-checkmark" size={26} color={colors.positive} />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-ink text-lg font-bold">2FA is on</Text>
                <Text className="text-muted text-sm mt-0.5">Codes required at sign-in</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={disable}
              disabled={busy}
              className="rounded-full py-4 items-center mt-6"
              style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: '#EF4444' }}
            >
              {busy ? <ActivityIndicator color="#EF4444" /> : <Text className="text-base font-bold" style={{ color: '#EF4444' }}>Turn off 2FA</Text>}
            </TouchableOpacity>
          </>
        )}

        {mode === 'disabled' && (
          <TouchableOpacity
            onPress={startEnroll}
            disabled={busy}
            className="rounded-full py-4 items-center"
            style={{ backgroundColor: colors.brand }}
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-white text-base font-bold">Set up 2FA</Text>}
          </TouchableOpacity>
        )}

        {mode === 'enrolling' && (
          <>
            <Text className="text-ink text-base font-semibold mb-3">1. Scan this in your authenticator app</Text>
            <View className="items-center bg-white rounded-3xl p-6 self-center mb-4">
              {!!uri && <QRCode value={uri} size={200} />}
            </View>

            <Text className="text-muted text-sm mb-2">Or enter this key manually:</Text>
            <TouchableOpacity
              onPress={() => {
                Clipboard.setStringAsync(secret);
                Alert.alert('Copied', 'Setup key copied to clipboard.');
              }}
              className="flex-row items-center justify-between bg-card rounded-2xl px-4 py-3 mb-6"
            >
              <Text className="text-ink text-base font-mono flex-1" numberOfLines={1}>{secret}</Text>
              <Ionicons name="copy-outline" size={18} color={colors.muted} />
            </TouchableOpacity>

            <Text className="text-ink text-base font-semibold mb-3">2. Enter the 6-digit code</Text>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              placeholder="000000"
              placeholderTextColor={colors.muted}
              className="rounded-2xl px-4 py-3.5 text-ink text-2xl bg-card text-center tracking-widest"
              style={{ borderWidth: 1, borderColor: colors.border, letterSpacing: 8 }}
            />

            <TouchableOpacity
              onPress={verify}
              disabled={busy || code.length !== 6}
              className="rounded-full py-4 items-center mt-6"
              style={{ backgroundColor: code.length === 6 && !busy ? colors.brand : colors.circle }}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-white text-base font-bold">Verify & enable</Text>}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
