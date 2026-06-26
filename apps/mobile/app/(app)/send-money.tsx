import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore, useWalletStore } from '@/store';
import { walletService } from '@/services/wallet';

export default function SendMoneyScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { wallet, updateBalance } = useWalletStore();
  const [recipientPhone, setRecipientPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [narration, setNarration] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendMoney = async () => {
    if (!recipientPhone || recipientPhone.length < 10) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    const transferAmount = parseFloat(amount);
    if (!transferAmount || transferAmount < 50) {
      Alert.alert('Error', 'Minimum transfer amount is ₦50');
      return;
    }

    if (transferAmount > (wallet?.balance || 0)) {
      Alert.alert('Error', 'Insufficient funds');
      return;
    }

    setLoading(true);
    try {
      const result = await walletService.sendMoney(user!.id, {
        recipient_phone: recipientPhone,
        amount: transferAmount,
        narration,
      });

      if (result.success) {
        updateBalance((wallet?.balance || 0) - transferAmount);
        Alert.alert('Success', 'Money sent successfully!', [
          { text: 'OK', onPress: () => router.push('/(app)/home') },
        ]);
      } else {
        Alert.alert('Error', 'Failed to send money. Please try again.');
      }
    } catch (error) {
      Alert.alert('Error', 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
      <ScrollView className="flex-1 bg-white" contentContainerStyle={{ paddingTop: insets.top }}>
        {/* Header */}
        <View className="px-6 py-4 flex-row items-center">
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={28} color="#1F2937" />
          </TouchableOpacity>
          <Text className="text-gray-800 text-2xl font-bold ml-4">Send Money</Text>
        </View>

        <View className="px-6 py-8">
          {/* Recipient Phone */}
          <View className="mb-6">
            <Text className="text-gray-700 font-semibold mb-3">Recipient's Phone</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-base"
              placeholder="08012345678"
              keyboardType="phone-pad"
              value={recipientPhone}
              onChangeText={setRecipientPhone}
              editable={!loading}
            />
          </View>

          {/* Amount */}
          <View className="mb-6">
            <Text className="text-gray-700 font-semibold mb-3">Amount (₦)</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-base"
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              editable={!loading}
            />
            <Text className="text-gray-500 text-xs mt-2">
              Available: ₦{(wallet?.balance || 0).toLocaleString()}
            </Text>
          </View>

          {/* Narration */}
          <View className="mb-8">
            <Text className="text-gray-700 font-semibold mb-3">Description (Optional)</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-base"
              placeholder="What is this payment for?"
              value={narration}
              onChangeText={setNarration}
              multiline
              numberOfLines={3}
              editable={!loading}
              style={{ textAlignVertical: 'top' }}
            />
          </View>

          {/* Send Button */}
          <TouchableOpacity
            className={`${
              loading ? 'bg-green-400' : 'bg-green-600'
            } rounded-lg py-4 items-center`}
            onPress={handleSendMoney}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold text-lg">Send Money</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
