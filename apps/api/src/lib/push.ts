import { prisma } from "@cheqpay/db";
import {
  type NotificationCategory,
  resolvePrefs,
} from "./notifications";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

/** Valid Expo push tokens look like ExponentPushToken[xxxx] or ExpoPushToken[xxxx]. */
function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);
}

export interface PushMessage {
  title: string;
  body: string;
  /** Notification category — send is skipped if the user opted out of it. */
  category: NotificationCategory;
  /** Optional data payload delivered to the app. */
  data?: Record<string, unknown>;
}

/**
 * Best-effort push to all of a user's registered devices, gated by their
 * per-category opt-in. Never throws — push is a side effect and must not
 * break the request that triggered it. Returns the number of devices targeted.
 */
export async function sendPush(userId: string, msg: PushMessage): Promise<number> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushTokens: true, notificationPrefs: true },
    });
    if (!user) return 0;

    const prefs = resolvePrefs(user.notificationPrefs);
    if (!prefs[msg.category]) return 0;

    const tokens = (user.pushTokens ?? []).filter(isExpoToken);
    if (tokens.length === 0) return 0;

    const messages = tokens.map((to) => ({
      to,
      title: msg.title,
      body: msg.body,
      sound: "default" as const,
      data: { category: msg.category, ...(msg.data ?? {}) },
    }));

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      console.error("[push] Expo push failed", res.status, await res.text().catch(() => ""));
      return 0;
    }
    return tokens.length;
  } catch (err) {
    console.error("[push] send error", err);
    return 0;
  }
}

/** POST a batch of Expo messages (≤100). Best-effort; logs on failure. */
async function postExpo(messages: unknown[]): Promise<void> {
  const res = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
  if (!res.ok) {
    console.error("[push] Expo broadcast failed", res.status, await res.text().catch(() => ""));
  }
}

/**
 * Fan a single message out to every user opted into `msg.category` who has at
 * least one registered device. Batched to Expo's 100-message limit. Returns the
 * number of devices targeted. Best-effort — never throws.
 */
export async function broadcastPush(msg: PushMessage): Promise<number> {
  try {
    const users = await prisma.user.findMany({
      where: { NOT: { pushTokens: { isEmpty: true } } },
      select: { pushTokens: true, notificationPrefs: true },
    });

    const targets: string[] = [];
    for (const u of users) {
      if (!resolvePrefs(u.notificationPrefs)[msg.category]) continue;
      for (const t of u.pushTokens) if (isExpoToken(t)) targets.push(t);
    }
    if (targets.length === 0) return 0;

    for (let i = 0; i < targets.length; i += 100) {
      const batch = targets.slice(i, i + 100).map((to) => ({
        to,
        title: msg.title,
        body: msg.body,
        sound: "default" as const,
        data: { category: msg.category, ...(msg.data ?? {}) },
      }));
      await postExpo(batch);
    }
    return targets.length;
  } catch (err) {
    console.error("[push] broadcast error", err);
    return 0;
  }
}
