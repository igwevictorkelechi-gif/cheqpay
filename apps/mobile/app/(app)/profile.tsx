import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '@/store';
import { authService } from '@/services/auth';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, setUser, setIsAuthenticated } = useAuthStore();

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      {
        text: 'Cancel',
        onPress: () => {},
        style: 'cancel',
      },
      {
        text: 'Logout',
        onPress: async () => {
          const result = await authService.logout();
          if (result.success) {
            setUser(null);
            setIsAuthenticated(false);
            router.replace('/(auth)/login');
          }
        },
        style: 'destructive',
      },
    ]);
  };

  const profileItems = [
    {
      id: 'kyc',
      label: 'KYC Verification',
      icon: 'checkmark-circle',
      action: () => router.push('/(app)/kyc'),
      badge: user?.kyc_status === 'approved' ? '✓' : 'Pending',
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'settings',
      action: () => router.push('/(app)/settings'),
    },
    {
      id: 'support',
      label: 'Support & Help',
      icon: 'help-circle',
      action: () => Alert.alert('Support', 'Contact us at support@cheqpay.com'),
    },
    {
      id: 'about',
      label: 'About Cheqpay',
      icon: 'information-circle',
      action: () => Alert.alert('About', 'Cheqpay v1.0.0'),
    },
  ];

  return (
    <ScrollView className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* Profile Header */}
      <View className="px-6 py-8 items-center border-b border-gray-100">
        <View className="w-24 h-24 rounded-full bg-gradient-to-br from-green-600 to-green-500 items-center justify-center mb-4">
          <Ionicons name="person" size={48} color="white" />
        </View>
        <Text className="text-gray-800 text-2xl font-bold">{user?.full_name}</Text>
        <Text className="text-gray-500 text-sm mt-1">{user?.phone}</Text>
        <Text className="text-gray-500 text-sm">{user?.email}</Text>

        {/* KYC Status Badge */}
        <View className="mt-4 px-4 py-2 bg-amber-100 rounded-full">
          <Text className="text-amber-700 font-semibold text-sm">
            KYC Status: {user?.kyc_status === 'approved' ? '✓ Verified' : 'Pending'}
          </Text>
        </View>
      </View>

      {/* Profile Menu */}
      <View className="mt-4">
        {profileItems.map((item) => (
          <TouchableOpacity
            key={item.id}
            className="flex-row items-center justify-between px-6 py-4 border-b border-gray-100"
            onPress={item.action}
          >
            <View className="flex-row items-center flex-1">
              <Ionicons name={item.icon as any} size={24} color="#10B981" />
              <Text className="text-gray-800 font-medium ml-4">{item.label}</Text>
            </View>
            <View className="flex-row items-center">
              {item.badge && (
                <Text className="text-gray-500 text-sm mr-2">{item.badge}</Text>
              )}
              <Ionicons name="chevron-forward" size={20} color="#9CA3AF" />
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Logout Button */}
      <View className="px-6 py-8 mt-8">
        <TouchableOpacity
          className="bg-red-500 rounded-lg py-4 items-center"
          onPress={handleLogout}
        >
          <Text className="text-white font-bold text-lg">Logout</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <View className="items-center py-6 border-t border-gray-100">
        <Text className="text-gray-500 text-xs">Cheqpay v1.0.0</Text>
      </View>
    </ScrollView>
  );
}
