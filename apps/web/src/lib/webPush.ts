"use client";

// Browser notifications: asking permission, subscribing this browser with the
// API, and turning it off again.
//
// The browser's permission prompt is only ever shown in response to a tap —
// never on page load. Browsers penalise sites that ask unprompted, and a
// "Block" answer is permanent until the user digs into settings.

import { api } from "@/services/api";

export type PushSupport =
  | "unsupported" // this browser can't do web push
  | "ios-needs-install" // iPhone/iPad Safari: only works from the Home Screen app
  | "denied" // the user blocked notifications for this site
  | "default" // not asked yet
  | "granted";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  const capable = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (!capable) return isIos() && !isStandalone() ? "ios-needs-install" : "unsupported";
  return Notification.permission as PushSupport;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.register("/sw.js");
}

/** True when this browser is subscribed right now. */
export async function isPushEnabled(): Promise<boolean> {
  if (pushSupport() !== "granted") return false;
  const sub = await (await registration()).pushManager.getSubscription();
  return !!sub;
}

/**
 * Ask permission (if needed), subscribe this browser, and register it with the
 * API. Call only from a tap. Resolves to the resulting permission state.
 */
export async function enablePush(): Promise<PushSupport> {
  const support = pushSupport();
  if (support === "unsupported" || support === "ios-needs-install" || support === "denied") {
    return support;
  }
  const permission = support === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return permission as PushSupport;

  const { publicKey } = await api.getWebPushKey();
  if (!publicKey) throw new Error("Browser notifications aren't available yet.");

  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));
  await api.subscribeWebPush(sub.toJSON());
  return "granted";
}

/** Stop notifications on this browser. */
export async function disablePush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api.unsubscribeWebPush(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
