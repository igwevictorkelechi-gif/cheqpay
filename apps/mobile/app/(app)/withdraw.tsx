import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore, useWalletStore } from '@/store';
import { walletService } from '@/services/wallet';
import { NIGERIAN_BANKS } from '@cheqpay/shared';

export default function WithdrawScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const { wallet, updateBalance } = useWalletStore();
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [accountName, setAccountName] = useState('');
  const [loading, setLoading] = useState(false);
  const [showBankList, setShowBankList] = useState(false);

  const handleWithdraw = async () => {
    if (!bankCode || !accountNumber || !amount) {
      Alert.alert('Error', 'Please fill in all required fields');
      return;
    }

    const withdrawAmount = parseFloat(amount);
    if (withdrawAmount < 100) {
      Alert.alert('Error', 'Minimum withdrawal is ₦100');
      return;
    }

    if (withdrawAmount > (wallet?.balance || 0)) {
      Alert.alert('Error', 'Insufficient funds');
      return;
    }

    setLoading(true);
    try {
      const result = await walletService.initiateWithdrawal(user!.id, {
        bank_account_number: accountNumber,
        bank_code: bankCode,
        amount: withdrawAmount,
        narration: 'Wallet withdrawal',
      });

      if (result.success) {
        updateBalance((wallet?.balance || 0) - withdrawAmount);
        Alert.alert('Success', 'Withdrawal initiated! You will receive the funds shortly.', [
          { text: 'OK', onPress: () => router.push('/(app)/home') },
        ]);
      } else {
        Alert.alert('Error', 'Failed to process withdrawal. Please try again.');
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
          <Text className="text-gray-800 text-2xl font-bold ml-4">Withdraw</Text>
        </View>

        <View className="px-6 py-8">
          {/* Available Balance */}
          <View className="bg-green-50 rounded-lg p-4 mb-8">
            <Text className="text-green-600 text-sm font-semibold">Available Balance</Text>
            <Text className="text-gray-800 text-3xl font-bold mt-2">
              ₦{(wallet?.balance || 0).toLocaleString()}
            </Text>
          </View>

          {/* Bank Selection */}
          <View className="mb-6">
            <Text className="text-gray-700 font-semibold mb-3">Select Bank</Text>
            <TouchableOpacity
              className="border border-gray-300 rounded-lg px-4 py-3 flex-row justify-between items-center"
              onPress={() => setShowBankList(!showBankList)}
            >
              <Text className={bankCode ? 'text-gray-800' : 'text-gray-500'}>
                {bankCode ? NIGERIAN_BANKS.find(b => b.code === bankCode)?.name : 'Choose a bank'}
              </Text>
              <Ionicons name={showBankList ? 'chevron-up' : 'chevron-down'} size={20} color="#9CA3AF" />
            </TouchableOpacity>

            {showBankList && (
              <View className="border border-gray-300 border-t-0 rounded-b-lg max-h-48">
                {NIGERIAN_BANKS.map((bank) => (
                  <TouchableOpacity
                    key={bank.code}
                    className="px-4 py-3 border-b border-gray-200 flex-row justify-between"
                    onPress={() => {
                      setBankCode(bank.code);
                      setShowBankList(false);
                    }}
                  >
                    <Text className="text-gray-800">{bank.name}</Text>
                    {bankCode === bank.code && <Ionicons name="checkmark" size={20} color="#10B981" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Account Number */}
          <View className="mb-6">
            <Text className="text-gray-700 font-semibold mb-3">Account Number</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-base"
              placeholder="0123456789"
              keyboardType="number-pad"
              value={accountNumber}
              onChangeText={setAccountNumber}
              maxLength={10}
              editable={!loading}
            />
          </View>

          {/* Account Name */}
          <View className="mb-6">
            <Text className="text-gray-700 font-semibold mb-3">Account Name</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-base"
              placeholder="John Doe"
              value={accountName}
              onChangeText={setAccountName}
              editable={!loading}
            />
          </View>

          {/* Amount */}
          <View className="mb-8">
            <Text className="text-gray-700 font-semibold mb-3">Amount (₦)</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-4 py-3 text-base"
              placeholder="0.00"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              editable={!loading}
            />
            <Text className="text-gray-500 text-xs mt-2">Minimum: ₦100</Text>
          </View>

          {/* Withdraw Button */}
          <TouchableOpacity
            className={`${
              loading ? 'bg-green-400' : 'bg-green-600'
            } rounded-lg py-4 items-center`}
            onPress={handleWithdraw}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-bold text-lg">Withdraw Now</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
