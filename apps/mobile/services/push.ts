import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { api, getAccessToken } from './api';

// Show alerts/badges while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ask for permission, obtain the Expo push token for this device, and register
 * it with the backend so server-side events can reach the user. Best-effort:
 * silently no-ops on simulators, denied permission, or missing auth.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (!Device.isDevice) return; // push tokens are unavailable on simulators
    if (!(await getAccessToken())) return; // only for signed-in users

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const valid = typeof projectId === 'string' && projectId !== 'your-eas-project-id';

    const { data: token } = await Notifications.getExpoPushTokenAsync(
      valid ? { projectId } : undefined
    );
    if (token) await api.registerPushToken(token);
  } catch {
    /* best-effort — never block app startup */
  }
}
