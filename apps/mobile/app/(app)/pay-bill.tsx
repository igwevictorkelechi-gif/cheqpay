import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { colors, TopBar, Card } from '@/components/brand';

type Service = {
  label: string;
  emoji: string;
  badge?: string;
  route?: string;
};

const services: Service[] = [
  { label: 'Airtime', emoji: '📲', route: '/(app)/bill/airtime' },
  { label: 'Data', emoji: '📶', route: '/(app)/bill/data' },
  { label: 'Betting', emoji: '🎰', route: '/(app)/bill/betting' },
  { label: 'Electricity', emoji: '💡', badge: 'New', route: '/(app)/bill/electricity' },
  { label: 'Cable TV', emoji: '📺', badge: 'New', route: '/(app)/bill/cabletv' },
  { label: 'Food delivery', emoji: '🛵', badge: 'New', route: '/(app)/bill/food' },
  { label: 'Vouchers', emoji: '🎟️' },
];

function ServiceTile({ service }: { service: Service }) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => service.route && router.push(service.route as never)}
      className="rounded-2xl p-4 mb-3"
      style={{ width: '48%', height: 96, backgroundColor: '#2A2440' }}
    >
      <View className="flex-row items-start justify-between">
        <Text style={{ fontSize: 26 }}>{service.emoji}</Text>
        {service.badge ? (
          <View
            className="rounded-full px-2 py-0.5"
            style={{ backgroundColor: colors.brand }}
          >
            <Text className="text-white text-xs font-semibold">{service.badge}</Text>
          </View>
        ) : null}
      </View>
      <Text className="text-ink font-bold text-base mt-auto">{service.label}</Text>
    </TouchableOpacity>
  );
}

export default function PayBillScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <TopBar
          name={user?.full_name}
          onAvatarPress={() => router.push('/(app)/profile')}
          icons={[{ name: 'search-outline' }, { name: 'notifications-outline' }]}
        />

        <Text className="text-ink font-extrabold px-5 mt-3 mb-5" style={{ fontSize: 32 }}>
          Quick payments
        </Text>

        {/* Services */}
        <View className="px-5 mb-5">
          <Card>
            <View className="flex-row items-center justify-between mb-5">
              <Text className="text-ink font-bold text-base">Showing services in</Text>
              <TouchableOpacity
                className="flex-row items-center rounded-full px-3 py-1.5"
                style={{ backgroundColor: colors.circle }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 14 }}>🇳🇬</Text>
                <Text className="text-ink font-semibold text-sm ml-1.5">Nigeria</Text>
                <Text className="text-muted ml-1">▾</Text>
              </TouchableOpacity>
            </View>

            <View className="flex-row flex-wrap justify-between">
              {services.map((service) => (
                <ServiceTile key={service.label} service={service} />
              ))}
            </View>
          </Card>
        </View>

        {/* Empty transactions */}
        <View className="px-5">
          <Card>
            <View className="flex-row items-center">
              <Text style={{ fontSize: 26 }}>🧾</Text>
              <View className="ml-4 flex-1">
                <Text className="text-ink font-bold text-lg">No transactions yet</Text>
                <Text className="text-muted text-sm mt-1">
                  Your first transaction will show up here, make it count!
                </Text>
              </View>
            </View>
          </Card>
        </View>
      </ScrollView>
    </View>
  );
}
