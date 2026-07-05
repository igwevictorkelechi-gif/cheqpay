import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { supabase } from '@/services/supabase';
import { useAuthStore } from '@/store';

function Field({
  label,
  value,
  onChangeText,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
}) {
  const [show, setShow] = useState(false);
  return (
    <View className="rounded-2xl px-4 py-3 bg-card" style={{ borderWidth: 1, borderColor: colors.border }}>
      <Text className="text-muted text-xs mb-1">{label}</Text>
      <View className="flex-row items-center">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!show}
          autoCapitalize="none"
          className="text-ink text-base flex-1"
          style={{ padding: 0 }}
        />
        <TouchableOpacity onPress={() => setShow((s) => !s)} hitSlop={10}>
          <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.muted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function ChangePasswordScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const valid = next.length >= 8 && next === confirm && current.length > 0;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      // Re-authenticate to confirm the current password.
      if (user?.email) {
        const { error: reErr } = await supabase.auth.signInWithPassword({
          email: user.email,
          password: current,
        });
        if (reErr) {
          Alert.alert('Wrong password', 'Your current password is incorrect.');
          return;
        }
      }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      Alert.alert('Password updated', 'Your password has been changed.');
      router.back();
    } catch {
      Alert.alert('Could not update', 'Please try again.');
    } finally {
      setBusy(false);
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

        <Text className="text-ink text-4xl font-extrabold mt-6 mb-6">Change password</Text>

        <View style={{ gap: 14 }}>
          <Field label="Current password" value={current} onChangeText={setCurrent} />
          <Field label="New password" value={next} onChangeText={setNext} />
          <Field label="Confirm new password" value={confirm} onChangeText={setConfirm} />
        </View>

        {next.length > 0 && next.length < 8 && (
          <Text className="text-xs mt-3" style={{ color: '#F5A623' }}>Use at least 8 characters.</Text>
        )}
        {confirm.length > 0 && next !== confirm && (
          <Text className="text-xs mt-3" style={{ color: '#EF4444' }}>Passwords don’t match.</Text>
        )}

        <TouchableOpacity
          onPress={submit}
          disabled={!valid || busy}
          className="rounded-full py-4 items-center mt-6"
          style={{ backgroundColor: valid && !busy ? colors.brand : colors.circle }}
        >
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text className="text-white text-base font-bold">Update password</Text>}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
