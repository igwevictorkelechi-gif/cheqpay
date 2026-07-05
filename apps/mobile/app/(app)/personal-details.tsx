import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { useAuthStore } from '@/store';
import { api, getAccessToken } from '@/services/api';

/** Read-only display field (used for verified-locked values). */
function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <View
      className="rounded-2xl px-4 py-3"
      style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(255,255,255,0.03)' }}
    >
      <Text className="text-muted text-xs">{label}</Text>
      <Text className="text-base mt-1" style={{ color: colors.muted }}>
        {value || '—'}
      </Text>
    </View>
  );
}

/** Editable field. */
function EditField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  return (
    <View className="rounded-2xl px-4 py-3 bg-card" style={{ borderWidth: 1, borderColor: colors.border }}>
      {!!value && <Text className="text-muted text-xs">{label}</Text>}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor={colors.muted}
        className="text-ink text-base"
        style={{ marginTop: value ? 4 : 0, padding: 0 }}
      />
    </View>
  );
}

export default function PersonalDetailsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [verified, setVerified] = useState(false);
  const [nextOfKin, setNextOfKin] = useState('');
  const [username, setUsername] = useState(
    '@' + (user?.email?.split('@')[0] || 'cheqpay')
  );

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const { kycTier } = await api.getKyc();
        setVerified(kycTier >= 2);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const fullName = user?.full_name || 'CheqPay User';

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

        <Text className="text-ink text-4xl font-extrabold mt-6 mb-5">Personal details</Text>

        <View style={{ gap: 14 }}>
          {verified ? (
            <LockedField label="Full Name" value={fullName} />
          ) : (
            <EditField label="Full Name" value={fullName} onChangeText={() => {}} />
          )}

          <EditField label="Username" value={username} onChangeText={setUsername} />

          <LockedField label="Date of birth" value="" />
          <LockedField label="Phone number" value={user?.phone || ''} />
          <LockedField label="Email address" value={user?.email || ''} />

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 6 }} />

          <EditField
            label="Next of Kin"
            value={nextOfKin}
            onChangeText={setNextOfKin}
            placeholder="Next of Kin"
          />
        </View>

        {verified && (
          <View
            className="flex-row items-center rounded-2xl p-4 mt-6 bg-card"
            style={{ borderWidth: 1.5, borderColor: colors.ink }}
          >
            <View className="w-7 h-7 rounded-full items-center justify-center" style={{ backgroundColor: colors.ink }}>
              <Ionicons name="alert" size={16} color={colors.surface} />
            </View>
            <Text className="text-muted text-sm ml-3 flex-1">
              You cannot edit some fields because your account has been verified.{' '}
              <Text style={{ color: colors.positive, fontWeight: '600' }} onPress={() => router.push('/(app)/settings')}>
                Contact support
              </Text>{' '}
              to make changes.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
