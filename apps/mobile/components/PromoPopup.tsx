import { useEffect, useState } from 'react';
import { Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors } from '@/components/brand';
import { api } from '@/services/api';

type Popup = {
  id: string;
  title: string;
  message: string;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
};

const DISMISSED_KEY = 'cheqpay:popup:dismissed';

/**
 * Admin-published announcement/promo modal. Shown once per popup id —
 * dismissing stores the id, and a newly published popup (fresh id) shows again.
 */
export default function PromoPopup() {
  const router = useRouter();
  const [popup, setPopup] = useState<Popup | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [{ popup }, dismissed] = await Promise.all([
          api.getPopup(),
          AsyncStorage.getItem(DISMISSED_KEY),
        ]);
        if (!active || !popup || dismissed === popup.id) return;
        setPopup(popup);
      } catch {
        // Popup is best-effort — never block the home screen.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!popup) return null;

  const dismiss = () => {
    AsyncStorage.setItem(DISMISSED_KEY, popup.id).catch(() => {});
    setPopup(null);
  };

  const onButton = () => {
    const url = popup.buttonUrl?.trim();
    dismiss();
    if (!url) return;
    if (url.startsWith('/')) router.push(url as never);
    else if (url.startsWith('https://')) Linking.openURL(url).catch(() => {});
  };

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} />
        <View style={styles.card}>
          <Pressable onPress={dismiss} style={styles.close} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.white} />
          </Pressable>
          {popup.imageUrl ? (
            <Image source={{ uri: popup.imageUrl }} style={styles.image} resizeMode="cover" />
          ) : null}
          <View style={styles.body}>
            <Text style={styles.title}>{popup.title}</Text>
            <Text style={styles.message}>{popup.message}</Text>
            <Pressable onPress={onButton} style={styles.button}>
              <Text style={styles.buttonText}>{popup.buttonText || 'Got it'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  close: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: 160 },
  body: { padding: 20 },
  title: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  message: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 8 },
  button: {
    marginTop: 16,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: colors.brand,
  },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
});
