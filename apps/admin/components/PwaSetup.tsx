'use client';

import { useEffect } from 'react';

// Registers the dashboard's service worker (alerts, offline page) and keeps the
// browser's "install this app" offer for the Install button in the alerts menu.

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

declare global {
  interface Window {
    __cheqpayInstall?: InstallPrompt | null;
  }
}

export const INSTALL_READY_EVENT = 'cheqpay-install-ready';

export default function PwaSetup() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__cheqpayInstall = e as InstallPrompt;
      window.dispatchEvent(new Event(INSTALL_READY_EVENT));
    };
    const onInstalled = () => {
      window.__cheqpayInstall = null;
      window.dispatchEvent(new Event(INSTALL_READY_EVENT));
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return null;
}
