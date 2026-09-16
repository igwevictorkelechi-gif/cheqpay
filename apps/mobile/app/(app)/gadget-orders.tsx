import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors, Card } from '@/components/brand';
import { api, ApiError, type GadgetOrder, type GadgetOrderStatus } from '@/services/api';

const STATUS_LABEL: Record<GadgetOrderStatus, string> = {
  PAID: 'Order placed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
};

const STATUS_COLOR: Record<GadgetOrderStatus, string> = {
  PAID: '#6B5B95',
  PROCESSING: '#F5A623',
  SHIPPED: '#2E8BFF',
  DELIVERED: '#16A34A',
  CANCELLED: '#EF4444',
  REFUNDED: '#EF4444',
};

export default function GadgetOrdersScreen() {
  const insets = useSafeAreaInsets();
  const [orders, setOrders] = useState<GadgetOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getGadgetOrders()
      .then(({ orders }) => setOrders(orders))
      .catch((e) => {
        setError(e instanceof ApiError ? e.message : "Couldn't load your orders.");
        setOrders([]);
      });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          onPress={() => router.push('/(app)/gadgets')}
          style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}
        >
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </TouchableOpacity>

        <Text style={{ color: colors.ink, fontSize: 32, fontWeight: '800', marginTop: 12, marginBottom: 16 }}>My orders</Text>

        {orders === null ? (
          <ActivityIndicator color={colors.muted} style={{ marginTop: 60 }} />
        ) : error ? (
          <Card><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>{error}</Text></Card>
        ) : orders.length === 0 ? (
          <Card>
            <View style={{ paddingVertical: 28, alignItems: 'center' }}>
              <Ionicons name="cube-outline" size={40} color={colors.muted} />
              <Text style={{ color: colors.muted, marginTop: 12 }}>No orders yet.</Text>
              <TouchableOpacity
                onPress={() => router.push('/(app)/gadgets')}
                style={{ marginTop: 16, backgroundColor: colors.brandLight, borderRadius: 999, paddingHorizontal: 32, paddingVertical: 12 }}
              >
                <Text style={{ color: colors.white, fontWeight: '800' }}>Browse gadgets</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ) : (
          orders.map((o) => (
            <View key={o.id} style={{ marginBottom: 12 }}>
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }}>
                      {o.quantity} × {o.productName}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
                      {o.totalFormatted} · {new Date(o.createdAt).toLocaleDateString('en-NG')}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>
                      To {o.delivery.address}, {o.delivery.city}
                    </Text>
                  </View>
                  <View style={{ backgroundColor: STATUS_COLOR[o.status], borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{STATUS_LABEL[o.status]}</Text>
                  </View>
                </View>
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
