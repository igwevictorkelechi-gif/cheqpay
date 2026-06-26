import { useState } from 'react';
import { View, Text, TouchableOpacity, Switch, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useUIStore } from '@/store';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { darkMode, setDarkMode } = useUIStore();
  const [notifications, setNotifications] = useState(true);
  const [biometrics, setBiometrics] = useState(false);

  return (
    <ScrollView className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      {/* Header */}
      <View className="px-6 py-4 flex-row items-center border-b border-gray-100">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color="#1F2937" />
        </TouchableOpacity>
        <Text className="text-gray-800 text-2xl font-bold ml-4">Settings</Text>
      </View>

      {/* Notifications */}
      <View className="border-b border-gray-100">
        <View className="px-6 py-4 flex-row justify-between items-center">
          <View className="flex-row items-center flex-1">
            <Ionicons name="notifications" size={24} color="#10B981" />
            <Text className="text-gray-800 font-medium ml-4">Notifications</Text>
          </View>
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ false: '#E5E7EB', true: '#A7F3D0' }}
            thumbColor={notifications ? '#10B981' : '#9CA3AF'}
          />
        </View>
      </View>

      {/* Biometrics */}
      <View className="border-b border-gray-100">
        <View className="px-6 py-4 flex-row justify-between items-center">
          <View className="flex-row items-center flex-1">
            <Ionicons name="finger-print" size={24} color="#10B981" />
            <Text className="text-gray-800 font-medium ml-4">Biometric Login</Text>
          </View>
          <Switch
            value={biometrics}
            onValueChange={setBiometrics}
            trackColor={{ false: '#E5E7EB', true: '#A7F3D0' }}
            thumbColor={biometrics ? '#10B981' : '#9CA3AF'}
          />
        </View>
      </View>

      {/* Dark Mode */}
      <View className="border-b border-gray-100">
        <View className="px-6 py-4 flex-row justify-between items-center">
          <View className="flex-row items-center flex-1">
            <Ionicons name="moon" size={24} color="#10B981" />
            <Text className="text-gray-800 font-medium ml-4">Dark Mode</Text>
          </View>
          <Switch
            value={darkMode}
            onValueChange={setDarkMode}
            trackColor={{ false: '#E5E7EB', true: '#A7F3D0' }}
            thumbColor={darkMode ? '#10B981' : '#9CA3AF'}
          />
        </View>
      </View>

      {/* About */}
      <View className="px-6 py-6 mt-4">
        <Text className="text-gray-600 text-sm">Version 1.0.0</Text>
        <Text className="text-gray-500 text-xs mt-4">
          © 2024 CheqPay. All rights reserved.
        </Text>
      </View>
    </ScrollView>
  );
}
