import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { colors, TopBar } from '@/components/brand';
import { useFeatures } from '@/lib/useFeatures';
import SponsoredCard from '@/components/SponsoredCard';
import { api, type BillCashback, type BillServiceConfig } from '@/services/api';
import { BILL_SECTIONS, maskCustomer, payAgainParams, pctLabel, recentBills, tileFor, type RecentBill } from '@/lib/billServices';

const contrast = (hex: string) => {
  const h = hex.replace('#', '');
  const l = (0.299 * parseInt(h.slice(0, 2), 16) + 0.587 * parseInt(h.slice(2, 4), 16) + 0.114 * parseInt(h.slice(4, 6), 16)) / 255;
  return l > 0.6 ? '#111111' : '#FFFFFF';
};

/**
 * Pay bills: "Pay again" for the billers you use, services grouped by what
 * they're for, cashback shown where it applies, and the sponsored slot last.
 */
export default function PayBillScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const features = useFeatures();
  const [catalog, setCatalog] = useState<BillServiceConfig[]>([]);
  const [cashback, setCashback] = useState<BillCashback | null>(null);
  const [recent, setRecent] = useState<RecentBill[]>([]);

  useEffect(() => {
    let live = true;
    api.getBillCatalog().then((r) => { if (live) { setCatalog(r.services); setCashback(r.cashback ?? null); } }).catch(() => undefined);
    api.getTransactions(50, 'NGN').then((r) => live && setRecent(recentBills(r.transactions))).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const back = cashback?.enabled && cashback.billBps > 0 ? pctLabel(cashback.billBps) : null;
  const sections = useMemo(
    () => BILL_SECTIONS.map((s) => ({ ...s, tiles: s.tiles.filter((t) => !t.flag || features[t.flag]) })).filter((s) => s.tiles.length),
    [features],
  );
  const billerFor = (r: RecentBill) => {
    const billers = catalog.find((c) => c.service === r.service)?.billers ?? [];
    return billers.find((b) => b.id === r.billerId) ?? billers.find((b) => b.name.toLowerCase() === r.billerName.toLowerCase()) ?? null;
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <TopBar
          name={user?.full_name}
          onAvatarPress={() => router.push('/(app)/profile')}
          icons={[{ name: 'search-outline' }, { name: 'notifications-outline' }]}
        />

        <View className="flex-row items-center justify-between px-5 mt-3 mb-5">
          <Text className="text-ink dark:text-ink-dark font-extrabold" style={{ fontSize: 30 }}>Pay bills</Text>
          <View className="flex-row items-center rounded-full px-3 py-1.5" style={{ backgroundColor: colors.circle }}>
            <Text style={{ fontSize: 14 }}>🇳🇬</Text>
            <Text className="text-ink dark:text-ink-dark font-semibold text-sm ml-1.5">Nigeria</Text>
          </View>
        </View>

        {recent.length > 0 ? (
          <View className="mb-6">
            <View className="flex-row items-center justify-between px-5 mb-2.5">
              <View className="flex-row items-center">
                <Ionicons name="refresh-outline" size={16} color={colors.brand} />
                <Text className="text-ink dark:text-ink-dark font-bold text-base ml-2">Pay again</Text>
              </View>
              <TouchableOpacity onPress={() => router.push('/(app)/transactions' as never)}>
                <Text style={{ color: colors.brand }} className="font-semibold text-sm">History</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20 }}>
              {recent.map((r) => {
                const b = billerFor(r);
                const tile = tileFor(r.service)!;
                return (
                  <TouchableOpacity
                    key={`${r.service}|${r.customer}`}
                    activeOpacity={0.8}
                    onPress={() => router.push({ pathname: `/(app)/bill/${r.service}`, params: payAgainParams(r, b && !b.comingSoon ? b.id : null) } as never)}
                    className="bg-card dark:bg-card-dark rounded-2xl p-3.5 mr-3"
                    style={{ width: 156 }}
                  >
                    <View className="flex-row items-center justify-between">
                      {b ? (
                        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: b.color }}>
                          <Text style={{ color: contrast(b.color), fontWeight: '800', fontSize: 10 }}>{b.short}</Text>
                        </View>
                      ) : (
                        <View className="w-9 h-9 rounded-xl items-center justify-center" style={{ backgroundColor: `${tile.color}22` }}>
                          <Ionicons name={tile.icon} size={18} color={tile.color} />
                        </View>
                      )}
                      <Text className="text-muted dark:text-muted-dark font-semibold" style={{ fontSize: 11 }}>{tile.label}</Text>
                    </View>
                    <Text numberOfLines={1} className="text-ink dark:text-ink-dark font-bold text-sm mt-2.5">{b?.name ?? r.billerName}</Text>
                    <Text numberOfLines={1} className="text-muted dark:text-muted-dark text-xs">{maskCustomer(r.customer)}</Text>
                    <View className="flex-row items-center justify-between mt-2">
                      <Text numberOfLines={1} className="text-ink dark:text-ink-dark font-extrabold text-sm" style={{ flexShrink: 1 }}>
                        {r.planName && r.service === 'data' ? r.planName.split('·')[0].trim() : r.amountFormatted}
                      </Text>
                      <Text style={{ color: colors.brand }} className="font-semibold text-xs">Pay ›</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {back ? (
          <View className="px-5 mb-6">
            <View className="flex-row items-center rounded-3xl p-4" style={{ borderWidth: 1, borderColor: 'rgba(251,191,36,0.35)', backgroundColor: 'rgba(251,191,36,0.10)' }}>
              <View className="w-11 h-11 rounded-2xl items-center justify-center mr-3" style={{ backgroundColor: '#FBBF24' }}>
                <Text style={{ fontWeight: '900', fontSize: 18, color: '#111' }}>%</Text>
              </View>
              <View className="flex-1">
                <Text className="text-ink dark:text-ink-dark font-bold">Get {back} back on every bill</Text>
                <Text className="text-muted dark:text-muted-dark text-xs">
                  Airtime, data, power, TV and more{cashback && cashback.maxNgn > 0 ? ` · up to ₦${cashback.maxNgn.toLocaleString('en-NG')} each time` : ''}. Added to your balance.
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        {sections.map((s) => (
          <View key={s.title} className="px-5 mb-6">
            <Text className="text-muted dark:text-muted-dark font-bold text-xs mb-3" style={{ letterSpacing: 1.6 }}>{s.title.toUpperCase()}</Text>
            <View className="flex-row flex-wrap" style={{ marginHorizontal: -5 }}>
              {s.tiles.map((t) => (
                <View key={t.key} style={{ width: '25%', padding: 5 }}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    disabled={!t.route}
                    onPress={() => t.route && router.push(t.route as never)}
                    className="bg-card dark:bg-card-dark rounded-2xl items-center pt-3.5 pb-3 px-1"
                  >
                    <View className="w-12 h-12 rounded-2xl items-center justify-center" style={{ backgroundColor: `${t.color}22` }}>
                      <Ionicons name={t.icon} size={24} color={t.color} />
                    </View>
                    <Text numberOfLines={2} className="text-ink dark:text-ink-dark font-semibold text-center mt-2" style={{ fontSize: 12, lineHeight: 15 }}>{t.label}</Text>
                  </TouchableOpacity>
                  {t.bill && back ? (
                    <View className="absolute rounded-full px-1.5 py-0.5" style={{ top: 0, right: 4, backgroundColor: '#FBBF24' }}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: '#111' }}>{back} back</Text>
                    </View>
                  ) : t.badge ? (
                    <View className="absolute rounded-full px-1.5 py-0.5" style={{ top: 0, right: 4, backgroundColor: t.badge === 'Soon' ? colors.circle : colors.brand }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: t.badge === 'Soon' ? colors.muted : '#fff' }}>{t.badge}</Text>
                    </View>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ))}

        <View className="px-5 mb-5">
          <SponsoredCard placement="paybills" />
        </View>
      </ScrollView>
    </View>
  );
}
