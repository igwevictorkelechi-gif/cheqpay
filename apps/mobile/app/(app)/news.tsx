import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Linking, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, type NewsItem } from '@/services/api';
import { useFeatures } from '@/lib/useFeatures';

/** Relative "2h ago" / "3d ago" from an ISO timestamp. */
function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** The in-app crypto news feed. Headlines come from public RSS feeds; tapping
 *  one opens the original article in the browser. */
export default function NewsScreen() {
  const insets = useSafeAreaInsets();
  const features = useFeatures();
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const { news } = await api.getNews();
      setNews(news);
    } catch {
      setNews([]);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2">
      <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card dark:bg-card-dark items-center justify-center">
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </TouchableOpacity>
      <Text className="text-ink dark:text-ink-dark text-lg font-bold ml-3">Crypto news</Text>
    </View>
  );

  if (!features.crypto_news) {
    return (
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        {Header}
        <View className="items-center py-16 px-8">
          <Ionicons name="newspaper-outline" size={36} color={colors.brandLight} />
          <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-4">Coming soon</Text>
          <Text className="text-muted dark:text-muted-dark text-sm mt-1 text-center">
            Crypto news isn’t switched on yet.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      {Header}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
      >
        {news === null ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 32 }} />
        ) : news.length === 0 ? (
          <Text className="text-muted dark:text-muted-dark text-sm mt-4 text-center">No headlines yet. Pull to refresh.</Text>
        ) : (
          news.map((n) => (
            <TouchableOpacity
              key={n.id}
              onPress={() => Linking.openURL(n.url).catch(() => {})}
              className="rounded-2xl p-4 mt-3"
              style={{ backgroundColor: colors.card }}
              activeOpacity={0.8}
            >
              <View className="flex-row items-center mb-1.5">
                <Text style={{ color: colors.brandLight, fontSize: 11, fontWeight: '700' }}>{n.source.toUpperCase()}</Text>
                <Text className="text-muted dark:text-muted-dark" style={{ fontSize: 11, marginLeft: 8 }}>· {ago(n.publishedAt)}</Text>
              </View>
              <Text className="text-ink dark:text-ink-dark font-bold" style={{ fontSize: 15, lineHeight: 20 }}>{n.title}</Text>
              {n.summary ? (
                <Text className="text-muted dark:text-muted-dark text-sm mt-1" numberOfLines={2}>{n.summary}</Text>
              ) : null}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}
