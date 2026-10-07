import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, type ViewStyle } from 'react-native';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';

const IDEAS: Record<string, string[]> = {
  airtime: ["My line", "Mum's line", "Dad's line"],
  data: ['My data', 'Home router'],
  electricity: ['Home meter', 'Shop meter'],
  cabletv: ['Living room TV', 'Bedroom TV'],
  betting: ['My wallet'],
};

/** After a successful bill: keep it in Pay bills under the user's own name. */
export default function SaveBillCard(props: { service: string; billerId: string; customer: string; planId?: string | null; amount?: string | null; style?: ViewStyle }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveBill({ service: props.service, billerId: props.billerId, customer: props.customer, nickname: name.trim(), planId: props.planId ?? null, amount: props.amount ?? null });
      setSaved(name.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (saved) {
    return (
      <View className="rounded-2xl px-4 py-3" style={[{ backgroundColor: 'rgba(34,197,94,0.12)' }, props.style]}>
        <Text style={{ color: '#4ADE80', fontWeight: '600', textAlign: 'center' }}>✓ Saved as &ldquo;{saved}&rdquo; in Pay bills</Text>
      </View>
    );
  }
  return (
    <View className="bg-card dark:bg-card-dark rounded-3xl p-4" style={props.style}>
      <Text className="text-ink dark:text-ink-dark font-bold">Save this bill?</Text>
      <Text className="text-muted dark:text-muted-dark text-xs mb-3">Pay it again in one tap, see when it&apos;s due, or switch on autopay.</Text>
      <View className="flex-row">
        <TextInput
          value={name}
          onChangeText={(v) => setName(v.slice(0, 40))}
          placeholder="Name it, e.g. Mum's line"
          placeholderTextColor={colors.muted}
          style={{ flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, marginRight: 8 }}
        />
        <TouchableOpacity onPress={save} disabled={busy || !name.trim()} className="rounded-2xl px-5 items-center justify-center" style={{ backgroundColor: colors.brand, opacity: busy || !name.trim() ? 0.4 : 1 }}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>}
        </TouchableOpacity>
      </View>
      <View className="flex-row flex-wrap mt-2">
        {(IDEAS[props.service] ?? []).map((n) => (
          <TouchableOpacity key={n} onPress={() => setName(n)} className="rounded-full px-3 py-1.5 mr-2 mb-2" style={{ backgroundColor: colors.circle }}>
            <Text className="text-ink dark:text-ink-dark text-xs font-semibold">{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {error ? <Text className="text-xs mt-1" style={{ color: '#F87171' }}>{error}</Text> : null}
    </View>
  );
}
