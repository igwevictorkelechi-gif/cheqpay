import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api } from '@/services/api';

type Channel = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  href: string;
};

export default function SupportScreen() {
  const insets = useSafeAreaInsets();
  const [contact, setContact] = useState({ email: 'support@cheqpay.com', phone: '', whatsapp: '' });

  useEffect(() => {
    api.getSupportContact().then(setContact).catch(() => undefined);
  }, []);

  const channels: Channel[] = [
    contact.email && {
      icon: 'mail' as const,
      title: 'Email us',
      subtitle: contact.email,
      href: `mailto:${contact.email}`,
    },
    contact.whatsapp && {
      icon: 'logo-whatsapp' as const,
      title: 'WhatsApp',
      subtitle: 'Chat with our team',
      href: `https://wa.me/${contact.whatsapp.replace(/[^\d]/g, '')}`,
    },
    contact.phone && {
      icon: 'call' as const,
      title: 'Call us',
      subtitle: contact.phone,
      href: `tel:${contact.phone.replace(/\s/g, '')}`,
    },
  ].filter(Boolean) as Channel[];

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View className="flex-row items-center px-5 pt-3 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card items-center justify-center">
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="text-ink text-lg font-bold ml-3">Help & Support</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 32 }}>
        <Text className="text-muted text-sm mt-1 mb-4">We&apos;re here to help, 24/7.</Text>

        {/* AI assistant */}
        <TouchableOpacity
          onPress={() => router.push('/(app)/support-chat')}
          activeOpacity={0.9}
          className="flex-row items-center rounded-3xl p-4"
          style={{ backgroundColor: colors.brand }}
        >
          <View className="w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.2)' }}>
            <Ionicons name="sparkles" size={22} color="#FFFFFF" />
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-white font-bold text-base">Chat with Cheq</Text>
            <Text className="text-white/80 text-sm">Instant answers from our AI assistant</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#FFFFFF" />
        </TouchableOpacity>

        <View className="mt-3" style={{ gap: 12 }}>
          {channels.map((c) => (
            <TouchableOpacity
              key={c.title}
              onPress={() => Linking.openURL(c.href).catch(() => undefined)}
              className="flex-row items-center bg-card rounded-2xl p-4"
              activeOpacity={0.8}
            >
              <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(107,91,149,0.2)' }}>
                <Ionicons name={c.icon} size={20} color={colors.brandLight} />
              </View>
              <View className="flex-1 ml-3">
                <Text className="text-ink font-bold">{c.title}</Text>
                <Text className="text-muted text-sm">{c.subtitle}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View className="bg-card rounded-2xl p-4 mt-6">
          <Text className="text-ink font-bold mb-1">Before you reach out</Text>
          <Text className="text-muted text-sm leading-5">
            For the fastest help, include your registered email and the transaction reference.
            Never share your password, OTP or PIN with anyone — CheqPay staff will never ask for them.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
