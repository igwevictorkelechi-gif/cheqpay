import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function AirtimeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
      <View className="px-6 py-4 flex-row items-center border-b border-gray-100">
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color="#1F2937" />
        </TouchableOpacity>
        <Text className="text-gray-800 text-2xl font-bold ml-4">Buy Airtime</Text>
      </View>

      <View className="flex-1 items-center justify-center px-6">
        <Ionicons name="call" size={64} color="#D1D5DB" />
        <Text className="text-gray-500 mt-4 text-center text-xl font-semibold">
          Airtime service coming soon
        </Text>
        <Text className="text-gray-400 mt-2 text-center">
          We're working on integrating airtime purchases. This feature will be available shortly.
        </Text>
      </View>
    </View>
  );
}
