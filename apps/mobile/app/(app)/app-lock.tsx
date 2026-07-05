import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Switch, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import {
  isAppLockEnabled,
  setPin,
  disableAppLock,
  isBiometricEnabled,
  setBiometricEnabled,
  hasBiometricHardware,
} from '@/lib/applock';

export default function AppLockScreen() {
  const insets = useSafeAreaInsets();
  const [enabled, setEnabled] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioOn, setBioOn] = useState(false);
  const [settingPin, setSettingPin] = useState(false);
  const [pin, setPinValue] = useState('');
  const [confirm, setConfirm] = useState('');

  const load = async () => {
    setEnabled(await isAppLockEnabled());
    setBioAvailable(await hasBiometricHardware());
    setBioOn(await isBiometricEnabled());
  };

  useEffect(() => {
    load();
  }, []);

  const savePin = async () => {
    if (pin.length < 4) {
      Alert.alert('PIN too short', 'Use at least 4 digits.');
      return;
    }
    if (pin !== confirm) {
      Alert.alert('PINs don’t match', 'Please re-enter the same PIN.');
      return;
    }
    await setPin(pin);
    setPinValue('');
    setConfirm('');
    setSettingPin(false);
    await load();
    Alert.alert('App lock on', 'You’ll be asked to unlock CheqPay when you open it.');
  };

  const turnOff = () => {
    Alert.alert('Turn off app lock?', 'Anyone with your phone will be able to open CheqPay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: async () => {
          await disableAppLock();
          await load();
        },
      },
    ]);
  };

  const toggleBio = async (on: boolean) => {
    await setBiometricEnabled(on);
    setBioOn(on);
  };

  return (
    <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top + 8 }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          className="w-11 h-11 rounded-full bg-card items-center justify-center"
        >
          <Ionicons name="arrow-back" size={22} color={colors.ink} />
        </TouchableOpacity>

        <Text className="text-ink text-4xl font-extrabold mt-6 mb-2">App lock</Text>
        <Text className="text-muted text-base mb-6">
          Require a PIN or Face ID each time you open CheqPay.
        </Text>

        {settingPin ? (
          <View style={{ gap: 14 }}>
            <View className="rounded-2xl px-4 py-3 bg-card" style={{ borderWidth: 1, borderColor: colors.border }}>
              <Text className="text-muted text-xs mb-1">Enter a PIN (4–6 digits)</Text>
              <TextInput
                value={pin}
                onChangeText={(t) => setPinValue(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                secureTextEntry
                className="text-ink text-2xl"
                style={{ padding: 0, letterSpacing: 8 }}
              />
            </View>
            <View className="rounded-2xl px-4 py-3 bg-card" style={{ borderWidth: 1, borderColor: colors.border }}>
              <Text className="text-muted text-xs mb-1">Confirm PIN</Text>
              <TextInput
                value={confirm}
                onChangeText={(t) => setConfirm(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                secureTextEntry
                className="text-ink text-2xl"
                style={{ padding: 0, letterSpacing: 8 }}
              />
            </View>
            <TouchableOpacity
              onPress={savePin}
              className="rounded-full py-4 items-center mt-2"
              style={{ backgroundColor: colors.brand }}
            >
              <Text className="text-white text-base font-bold">Save PIN</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View className="flex-row items-center bg-card rounded-3xl p-5">
              <View
                className="w-12 h-12 rounded-2xl items-center justify-center"
                style={{ backgroundColor: enabled ? 'rgba(52,199,89,0.15)' : colors.circle }}
              >
                <Ionicons name={enabled ? 'lock-closed' : 'lock-open'} size={24} color={enabled ? colors.positive : colors.muted} />
              </View>
              <View className="ml-4 flex-1">
                <Text className="text-ink text-lg font-bold">App lock is {enabled ? 'on' : 'off'}</Text>
                <Text className="text-muted text-sm mt-0.5">{enabled ? 'PIN required to open the app' : 'Set a PIN to enable'}</Text>
              </View>
            </View>

            {enabled && bioAvailable && (
              <View className="flex-row items-center justify-between bg-card rounded-2xl p-4 mt-4">
                <View className="flex-1 pr-3">
                  <Text className="text-ink text-base font-semibold">Unlock with Face ID</Text>
                  <Text className="text-muted text-xs mt-0.5">Use biometrics instead of your PIN</Text>
                </View>
                <Switch
                  value={bioOn}
                  onValueChange={toggleBio}
                  trackColor={{ false: colors.circle, true: colors.brand }}
                  thumbColor={colors.white}
                />
              </View>
            )}

            {enabled ? (
              <View style={{ gap: 12 }} className="mt-6">
                <TouchableOpacity
                  onPress={() => setSettingPin(true)}
                  className="rounded-full py-4 items-center bg-card"
                  style={{ borderWidth: 1, borderColor: colors.border }}
                >
                  <Text className="text-ink text-base font-bold">Change PIN</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={turnOff}
                  className="rounded-full py-4 items-center bg-card"
                  style={{ borderWidth: 1, borderColor: '#EF4444' }}
                >
                  <Text className="text-base font-bold" style={{ color: '#EF4444' }}>Turn off app lock</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setSettingPin(true)}
                className="rounded-full py-4 items-center mt-6"
                style={{ backgroundColor: colors.brand }}
              >
                <Text className="text-white text-base font-bold">Set up app lock</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
