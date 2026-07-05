import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { useAuthStore } from '@/store';
import { api, ApiError, getAccessToken, type Me } from '@/services/api';

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
        autoCapitalize="none"
      />
    </View>
  );
}

export default function PersonalDetailsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [me, setMe] = useState<Me | null>(null);
  const [username, setUsername] = useState('');
  const [dob, setDob] = useState('');
  const [nextOfKin, setNextOfKin] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const data = await api.getMe();
        setMe(data);
        setUsername(data.username ?? '@' + (data.email?.split('@')[0] ?? 'cheqpay'));
        setDob(data.dateOfBirth ?? '');
        setNextOfKin(data.nextOfKin ?? '');
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const verified = (me?.kycTier ?? 0) >= 2;
  const fullName = user?.full_name || 'CheqPay User';

  const dirty =
    !!me &&
    (username.replace(/^@+/, '') !== (me.username ?? '').replace(/^@+/, '') ||
      (!verified && dob !== (me.dateOfBirth ?? '')) ||
      nextOfKin !== (me.nextOfKin ?? ''));

  const save = async () => {
    if (!me || !dirty) return;
    setSaving(true);
    try {
      const patch: { username?: string; dateOfBirth?: string; nextOfKin?: string } = {};
      const normUser = username.replace(/^@+/, '');
      if (normUser !== (me.username ?? '')) patch.username = normUser;
      if (!verified && dob !== (me.dateOfBirth ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        patch.dateOfBirth = dob;
      }
      if (nextOfKin !== (me.nextOfKin ?? '')) patch.nextOfKin = nextOfKin;
      const updated = await api.updateProfile(patch);
      setMe(updated);
      Alert.alert('Saved', 'Your details were updated.');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        Alert.alert('Username taken', 'That username is already in use. Try another.');
      } else if (e instanceof ApiError && e.status === 403) {
        Alert.alert('Locked', 'Date of birth cannot be changed on a verified account.');
      } else {
        Alert.alert('Could not save', 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
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

        <Text className="text-ink text-4xl font-extrabold mt-6 mb-5">Personal details</Text>

        {!me ? (
          <View className="py-12 items-center">
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : (
          <>
            <View style={{ gap: 14 }}>
              <LockedField label="Full Name" value={fullName} />
              <EditField label="Username" value={username} onChangeText={setUsername} />

              {verified ? (
                <LockedField label="Date of birth" value={dob} />
              ) : (
                <EditField label="Date of birth" value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
              )}

              <LockedField label="Phone number" value={me.phone || ''} />
              <LockedField label="Email address" value={me.email || ''} />

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

            <TouchableOpacity
              onPress={save}
              disabled={!dirty || saving}
              className="rounded-full py-4 items-center mt-6"
              style={{ backgroundColor: dirty && !saving ? colors.brand : colors.circle }}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text className="text-white text-base font-bold">Save changes</Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
