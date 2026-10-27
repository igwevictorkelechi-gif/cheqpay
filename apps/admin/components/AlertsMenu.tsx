'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Download, Loader2, Share, X } from 'lucide-react';
import { INSTALL_READY_EVENT } from '@/components/PwaSetup';

// Alerts on this device: a notification when something needs this admin, such
// as a gift card sent for review (if they can open Gift cards). Also offers to
// install the dashboard as an app; on iPhone that's required for alerts.

type State = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export default function AlertsMenu() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (!supported) {
      setState(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub || Notification.permission !== 'granted') {
        setState('off');
        return;
      }
      const r = await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      setState(d.subscribed ? 'on' : 'off');
    } catch {
      setState('off');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onInstall = () => setCanInstall(!!window.__cheqpayInstall);
    onInstall();
    window.addEventListener(INSTALL_READY_EVENT, onInstall);
    return () => window.removeEventListener(INSTALL_READY_EVENT, onInstall);
  }, [refresh]);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const keyRes = await fetch('/api/push', { cache: 'no-store' });
      const { publicKey } = await keyRes.json().catch(() => ({}));
      if (!publicKey) throw new Error('Alerts aren’t set up on the server yet.');
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
        }));
      const r = await fetch('/api/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not turn on alerts.');
      setState('on');
      setMessage('Alerts are on for this device.');
    } catch (e) {
      setMessage((e as Error).message || 'Could not turn on alerts.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => false);
      }
      setState('off');
      setMessage('Alerts are off for this device.');
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    const prompt = window.__cheqpayInstall;
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice.catch(() => undefined);
    window.__cheqpayInstall = null;
    setCanInstall(false);
  };

  const Icon = state === 'on' ? BellRing : state === 'denied' ? BellOff : Bell;

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
        aria-label="Alerts"
        title="Alerts on this device"
      >
        <Icon size={20} className={state === 'on' ? 'text-brand-600' : 'text-gray-600'} />
        {state === 'on' && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-green-500" />}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-200 bg-white p-4 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-gray-900">Alerts on this device</p>
            <button onClick={() => setOpen(false)} aria-label="Close" className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Get a notification when something needs you, like a new gift card to review. You only hear about the
            sections you can open.
          </p>

          <div className="mt-3">
            {state === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            {state === 'on' && (
              <button
                onClick={turnOff}
                disabled={busy}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {busy ? 'Turning off…' : 'Turn off alerts'}
              </button>
            )}
            {state === 'off' && (
              <button
                onClick={turnOn}
                disabled={busy}
                className="w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {busy ? 'Turning on…' : 'Turn on alerts'}
              </button>
            )}
            {state === 'denied' && (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.
              </p>
            )}
            {state === 'ios-install' && (
              <p className="flex items-start gap-2 rounded-lg bg-brand-50 p-3 text-sm text-brand-800">
                <Share size={16} className="mt-0.5 shrink-0" />
                <span>
                  On iPhone, alerts need the app: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
                  Open CheqPay Admin from your home screen and turn alerts on there.
                </span>
              </p>
            )}
            {state === 'unsupported' && (
              <p className="rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
                This browser can’t show alerts. Try Chrome, Edge, Firefox or Safari.
              </p>
            )}
          </div>

          {canInstall && (
            <button
              onClick={install}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
            >
              <Download size={16} /> Install the admin app
            </button>
          )}
          {message && <p className="mt-3 text-xs text-gray-500">{message}</p>}
        </div>
      )}
    </div>
  );
}
