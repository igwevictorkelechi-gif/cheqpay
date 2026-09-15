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
 * Why push registration did or did not happen.
 *
 * This exists because the previous version returned void and swallowed every
 * failure in a bare `catch {}`. Push can fail for six unrelated reasons, all
 * of them invisible: no hardware, no session, permission denied, no EAS
 * project id, Expo's token service unreachable, our own API rejecting it. A
 * silent no-op for each means nobody — user or engineer — can tell the
 * difference between "push is off" and "push is broken", which is exactly the
 * state this app was in.
 */
export type PushStatus =
  | 'registered'
  | 'simulator'
  | 'signed-out'
  | 'permission-denied'
  | 'no-project-id'
  | 'token-failed'
  | 'register-failed';

/** Human-readable explanation, for a settings screen or a log line. */
export const PUSH_STATUS_TEXT: Record<PushStatus, string> = {
  registered: 'This device is registered for notifications.',
  simulator: 'Push notifications need a real device — simulators cannot receive them.',
  'signed-out': 'Sign in to receive notifications.',
  'permission-denied':
    'Notifications are turned off for CheqPay. Enable them in your phone’s Settings.',
  'no-project-id':
    'Push is not configured for this build: the app has no EAS project id, so Expo cannot issue a token. Run `npx eas-cli init` in apps/mobile and commit the projectId it writes into app.json.',
  'token-failed': 'Could not get a push token from Expo. Check the network and try again.',
  'register-failed': 'Got a push token but the CheqPay server would not accept it.',
};

/** The last outcome, so a settings screen can show why push is quiet. */
let lastStatus: PushStatus | null = null;
export function lastPushStatus(): PushStatus | null {
  return lastStatus;
}

const PLACEHOLDER_PROJECT_ID = 'your-eas-project-id';

/**
 * Resolve the EAS project id Expo needs to mint a push token.
 *
 * app.json ships a placeholder, and `eas init` is what replaces it. Treating
 * the placeholder as absent matters: passing it through would have Expo reject
 * the token request with an opaque error instead of us saying plainly that the
 * project was never initialised.
 */
function easProjectId(): string | null {
  const id =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (typeof id !== 'string' || id.length === 0 || id === PLACEHOLDER_PROJECT_ID) return null;
  return id;
}

/**
 * Ask for permission, obtain the Expo push token for this device, and register
 * it with the backend so server-side events can reach the user.
 *
 * Still best-effort — it never throws, and never blocks startup — but it now
 * REPORTS. Every exit returns a reason, and anything that is a misconfiguration
 * rather than a user choice is logged as an error so it shows up in a device
 * log instead of being lost.
 */
export async function registerForPushNotifications(): Promise<PushStatus> {
  const finish = (status: PushStatus): PushStatus => {
    lastStatus = status;
    if (status === 'no-project-id' || status === 'token-failed' || status === 'register-failed') {
      // A real fault, not a user preference — say so loudly.
      console.error(`[push] not registered (${status}): ${PUSH_STATUS_TEXT[status]}`);
    }
    return status;
  };

  try {
    if (!Device.isDevice) return finish('simulator');
    if (!(await getAccessToken())) return finish('signed-out');

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
    if (status !== 'granted') return finish('permission-denied');

    const projectId = easProjectId();
    if (!projectId) {
      // Expo Go can sometimes mint a token without one, but a standalone build
      // cannot — so this is reported rather than papered over. Previously the
      // call was simply made without a projectId, which made a production
      // build's failure look like a network blip.
      return finish('no-project-id');
    }

    let token: string | undefined;
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    } catch {
      return finish('token-failed');
    }
    if (!token) return finish('token-failed');

    try {
      await api.registerPushToken(token);
    } catch {
      return finish('register-failed');
    }
    return finish('registered');
  } catch {
    return finish('token-failed');
  }
}
