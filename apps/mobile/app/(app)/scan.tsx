import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Camera, type BarCodeScanningResult } from 'expo-camera';
import { colors } from '@/components/brand';
import { parsePayCode } from '@/lib/payCode';

/**
 * Scan a CheqPay pay code. The camera reads a QR, we pull the username out of it
 * (parsePayCode), and hand off to the Send screen pre-filled with that
 * recipient — which confirms the user server-side before anything moves. Codes
 * that aren't CheqPay links are rejected here so the payer sees it immediately.
 */
export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = Camera.useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  // One scan at a time: the camera fires onBarCodeScanned continuously.
  const handled = useRef(false);

  function onScan({ data }: BarCodeScanningResult) {
    if (handled.current) return;
    const username = parsePayCode(data);
    if (!username) {
      setError('That’s not a CheqPay code.');
      return;
    }
    handled.current = true;
    router.replace({ pathname: '/(app)/send-user', params: { to: username } });
  }

  const Header = (
    <View className="flex-row items-center px-5 pt-3 pb-2" style={{ paddingTop: insets.top + 6 }}>
      <TouchableOpacity
        onPress={() => router.back()}
        className="w-10 h-10 rounded-full items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      >
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </TouchableOpacity>
      <Text className="text-white text-lg font-bold ml-3">Scan to pay</Text>
    </View>
  );

  // Permission not yet decided.
  if (!permission) {
    return <View className="flex-1" style={{ backgroundColor: '#000' }} />;
  }

  // Permission denied — explain and offer a way to fix it.
  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        <Ionicons name="camera-outline" size={40} color={colors.brandLight} />
        <Text className="text-ink dark:text-ink-dark text-lg font-bold mt-4 text-center">Camera access needed</Text>
        <Text className="text-muted dark:text-muted-dark text-sm mt-2 text-center">
          CheqPay needs your camera to scan a pay code.
        </Text>
        <TouchableOpacity
          onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())}
          className="mt-6 px-6 py-3 rounded-full"
          style={{ backgroundColor: colors.brand }}
        >
          <Text className="text-white font-bold">
            {permission.canAskAgain ? 'Allow camera' : 'Open settings'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} className="mt-4">
          <Text className="text-muted dark:text-muted-dark font-semibold">Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1" style={{ backgroundColor: '#000' }}>
      <Camera
        style={{ flex: 1 }}
        barCodeScannerSettings={{ barCodeTypes: ['qr'] }}
        onBarCodeScanned={onScan}
      />
      {/* Overlay: header + a framing square + guidance, drawn over the preview. */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>{Header}</View>
      <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
        <View
          style={{
            width: 240,
            height: 240,
            borderWidth: 3,
            borderColor: '#fff',
            borderRadius: 24,
            backgroundColor: 'transparent',
          }}
        />
        <Text className="text-white text-sm mt-6 text-center px-10" style={{ opacity: 0.9 }}>
          Point your camera at a CheqPay pay code
        </Text>
        {error && (
          <View className="mt-4 px-4 py-2 rounded-full" style={{ backgroundColor: 'rgba(220,38,38,0.9)' }}>
            <Text className="text-white font-semibold text-sm">{error}</Text>
          </View>
        )}
      </View>
      {/* The receiver side: show your own code so someone can scan you. */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 24, alignItems: 'center' }}>
        <TouchableOpacity
          onPress={() => router.replace('/(app)/my-qr')}
          className="flex-row items-center px-5 py-3 rounded-full"
          style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
        >
          <Ionicons name="qr-code-outline" size={18} color="#fff" />
          <Text className="text-white font-bold ml-2">Show my pay code</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
