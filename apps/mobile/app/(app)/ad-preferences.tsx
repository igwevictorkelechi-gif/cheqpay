import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Switch } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, type AdPrefs } from '@/services/api';

/** Whether ads may use your activity, and which kinds of ads you never want to see. */
export default function AdPreferencesScreen() {
  const insets = useSafeAreaInsets();
  const [prefs, setPrefs] = useState<AdPrefs | null>(null);
  const [cats, setCats] = useState<{ key: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdPrefs().then((r) => { setPrefs(r.prefs); setCats(r.categories); }).catch(() => setError("Couldn't load your ad preferences."));
  }, []);

  async function save(next: AdPrefs) {
    setPrefs(next);
    try {
      setPrefs((await api.setAdPrefs(next)).prefs);
    } catch {
      setError("Couldn't save. Try again.");
    }
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
        <TouchableOpacity onPress={() => router.back()} className="h-11 w-11 rounded-full items-center justify-center" style={{ backgroundColor: colors.card }}>
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </TouchableOpacity>
        <Text className="text-ink dark:text-ink-dark font-extrabold mt-6" style={{ fontSize: 30 }}>Ad preferences</Text>
        <Text className="text-muted dark:text-muted-dark text-sm mt-1 mb-5">CheqPay shows a few ads from businesses. You choose how they&apos;re picked for you.</Text>
        {error ? <Text className="text-sm mb-3" style={{ color: '#F87171' }}>{error}</Text> : null}
        {!prefs ? (
          <ActivityIndicator style={{ marginTop: 60 }} color={colors.brand} />
        ) : (
          <>
            <View className="bg-card dark:bg-card-dark rounded-3xl p-4 mb-4 flex-row items-center">
              <View className="flex-1 pr-3">
                <Text className="text-ink dark:text-ink-dark text-lg font-bold">Personalised ads</Text>
                <Text className="text-muted dark:text-muted-dark text-sm mt-0.5">
                  {prefs.personalised
                    ? 'Ads can match how you use CheqPay (e.g. paying bills) and your rough location (about 5 km).'
                    : "Ads are only chosen by your state. We don't use your activity or location."}
                </Text>
              </View>
              <Switch value={prefs.personalised} onValueChange={(v) => save({ ...prefs, personalised: v })} trackColor={{ true: colors.brand, false: colors.circle }} />
            </View>
            <View className="bg-card dark:bg-card-dark rounded-3xl p-4">
              <Text className="text-ink dark:text-ink-dark text-lg font-bold">Never show me</Text>
              <Text className="text-muted dark:text-muted-dark text-sm mb-3">Tap a type of ad to hide it.</Text>
              <View className="flex-row flex-wrap">
                {cats.map((c) => {
                  const muted = prefs.mutedCategories.includes(c.key);
                  return (
                    <TouchableOpacity
                      key={c.key}
                      onPress={() => save({ ...prefs, mutedCategories: muted ? prefs.mutedCategories.filter((x) => x !== c.key) : [...prefs.mutedCategories, c.key] })}
                      className="rounded-full px-3.5 py-2 mr-2 mb-2"
                      style={{ borderWidth: 1, borderColor: muted ? 'rgba(248,113,113,0.5)' : colors.border, backgroundColor: muted ? 'rgba(239,68,68,0.1)' : 'transparent' }}
                    >
                      <Text className="text-sm font-semibold" style={{ color: muted ? '#FCA5A5' : colors.muted }}>{muted ? '✓ ' : ''}{c.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
