"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { API_BASE } from "@/services/api";

/**
 * The venue screen player: open mycheqpay.com/screen full-screen on a TV,
 * Android TV box or tablet at a partner venue.
 *
 * First run: it shows a 6-digit code; a CheqPay admin enters it against the
 * venue to pair this screen. After that it loops today's approved ads (10 s
 * each, with a QR code for the advertiser's link), reports a heartbeat every
 * minute (the venue is paid for days the screen was on), keeps the screen
 * awake, and carries on from its last playlist if the internet drops.
 */

type Item = { campaignId: string; businessName: string; headline: string; body: string; image: string; linkUrl: string | null; cta: string };
type State =
  | { paired: false; code: string | null; expiresAt: string | null }
  | { paired: true; venue: { id: string; name: string; city: string }; playlist: Item[]; refreshSeconds: number };

const TOKEN_KEY = "cheqpay:screen-token";
const CACHE_KEY = "cheqpay:screen-playlist";
const SLIDE_MS = 10_000;

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode: works for this session only */
    }
  },
};

async function call<T>(path: string, token: string | null, init: RequestInit = {}): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Screen ${token}` } : {}), ...(init.headers ?? {}) },
      cache: "no-store",
    });
    return { status: res.status, data: (await res.json().catch(() => null)) as T | null };
  } catch {
    return { status: 0, data: null };
  }
}

export default function ScreenPlayer() {
  const [state, setState] = useState<State | null>(null);
  const [index, setIndex] = useState(0);
  const [offline, setOffline] = useState(false);
  const [needsTap, setNeedsTap] = useState(true);
  const token = useRef<string | null>(null);
  const plays = useRef<Map<string, number>>(new Map());

  const pairNew = useCallback(async () => {
    const r = await call<{ token: string; code: string; expiresAt: string }>("/api/screens/pair", null, { method: "POST" });
    if (r.status === 201 && r.data) {
      token.current = r.data.token;
      store.set(TOKEN_KEY, r.data.token);
      setState({ paired: false, code: r.data.code, expiresAt: r.data.expiresAt });
    } else setOffline(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!token.current) return pairNew();
    const r = await call<State>("/api/screens/state", token.current);
    if (r.status === 401) {
      // This screen was removed (or never existed): start over with a new code.
      store.set(TOKEN_KEY, null);
      token.current = null;
      return pairNew();
    }
    if (r.status !== 200 || !r.data) {
      setOffline(true);
      return;
    }
    setOffline(false);
    if (!r.data.paired && !r.data.code) {
      // Code expired before anyone paired it.
      store.set(TOKEN_KEY, null);
      token.current = null;
      return pairNew();
    }
    setState(r.data);
    if (r.data.paired) store.set(CACHE_KEY, JSON.stringify(r.data));
  }, [pairNew]);

  // Boot: reuse this device's token, or ask for a code. Show the cached playlist meanwhile.
  useEffect(() => {
    token.current = store.get(TOKEN_KEY);
    const cached = store.get(CACHE_KEY);
    if (cached && token.current) {
      try {
        setState(JSON.parse(cached) as State);
      } catch {
        /* ignore */
      }
    }
    void refresh();
  }, [refresh]);

  // Poll: fast while waiting to be paired, every few minutes once playing.
  useEffect(() => {
    const ms = state?.paired ? (state.refreshSeconds || 300) * 1000 : 5000;
    const id = setInterval(() => void refresh(), ms);
    return () => clearInterval(id);
  }, [state?.paired, state, refresh]);

  // Heartbeat every minute with the plays since the last one.
  useEffect(() => {
    const id = setInterval(async () => {
      if (!token.current) return;
      const batch = [...plays.current.entries()].map(([campaignId, n]) => ({ campaignId, n }));
      const r = await call("/api/screens/heartbeat", token.current, { method: "POST", body: JSON.stringify({ plays: batch }) });
      if (r.status === 200) {
        plays.current.clear();
        setOffline(false);
      } else setOffline(true);
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Rotate slides and count each as a play.
  // Same ads in the same order → same array, so a refresh doesn't restart or double-count the slide.
  const playlistKey = state?.paired ? state.playlist.map((p) => p.campaignId).join(",") : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const playlist = useMemo(() => (state?.paired ? state.playlist : []), [playlistKey]);
  useEffect(() => {
    if (!playlist.length) return;
    const current = playlist[index % playlist.length];
    plays.current.set(current.campaignId, (plays.current.get(current.campaignId) ?? 0) + 1);
    const id = setTimeout(() => setIndex((i) => (i + 1) % playlist.length), SLIDE_MS);
    return () => clearTimeout(id);
  }, [index, playlist]);

  // Keep the screen awake; re-acquire when the tab comes back.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const grab = async () => {
      try {
        if (nav.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen");
      } catch {
        /* not supported */
      }
    };
    void grab();
    const onVis = () => void grab();
    document.addEventListener("visibilitychange", onVis);
    // A daily reload keeps long-running TV browsers fresh.
    const reload = setTimeout(() => location.reload(), 12 * 3600_000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearTimeout(reload);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  function goFull() {
    setNeedsTap(false);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  const brand = (
    <div className="flex items-center gap-2 text-white/80">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/cheqpay-icon.png" alt="" className="h-7 w-7 rounded-full" />
      <span className="text-sm font-bold tracking-wide">CheqPay Ads</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[9999] cursor-none overflow-hidden bg-black text-white" onClick={goFull} data-testid="screen-player">
      {!state ? (
        <div className="flex h-full items-center justify-center text-white/60">Starting…</div>
      ) : !state.paired ? (
        <div className="flex h-full flex-col items-center justify-center gap-6 bg-gradient-to-br from-[#1a1530] via-[#0E0C14] to-black p-8 text-center">
          {brand}
          <p className="text-[2.2vw] font-semibold text-white/70">Pair this screen</p>
          <p className="font-mono text-[12vw] font-extrabold leading-none tracking-[0.15em] text-white" data-testid="pair-code">
            {state.code ?? "······"}
          </p>
          <p className="max-w-[60vw] text-[1.6vw] text-white/60">
            Give this code to your CheqPay partner manager. The screen starts showing ads as soon as it&apos;s paired.
          </p>
        </div>
      ) : playlist.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-8 bg-gradient-to-br from-[#2a2142] via-[#0E0C14] to-black p-10 text-center">
          {brand}
          <p className="text-[5vw] font-extrabold leading-tight">Your ad could be here</p>
          <p className="text-[2vw] text-white/70">Advertise to everyone at {state.venue.name} — book in minutes on CheqPay.</p>
          <div className="rounded-3xl bg-white p-4">
            <QRCodeSVG value="https://mycheqpay.com/advertise/" size={220} />
          </div>
          <p className="text-[1.6vw] text-white/60">Scan, or visit mycheqpay.com/advertise</p>
        </div>
      ) : (
        (() => {
          const ad = playlist[index % playlist.length];
          return (
            <div key={`${ad.campaignId}-${index}`} className="relative h-full w-full animate-[fadein_.6s_ease]">
              {/* blurred fill behind, the real image contained on top */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ad.image} alt="" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ad.image} alt="" className="absolute inset-0 h-full w-full object-contain pb-[18vh]" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 bg-gradient-to-t from-black via-black/85 to-transparent px-[4vw] pb-[4vh] pt-[8vh]">
                <div className="min-w-0">
                  <p className="text-[1.5vw] font-semibold uppercase tracking-[0.2em] text-white/70">Sponsored · {ad.businessName}</p>
                  <p className="mt-2 text-[4vw] font-extrabold leading-tight">{ad.headline}</p>
                  {ad.body && <p className="mt-1 text-[2vw] text-white/80">{ad.body}</p>}
                </div>
                {ad.linkUrl && (
                  <div className="flex shrink-0 flex-col items-center gap-2">
                    <div className="rounded-2xl bg-white p-3">
                      <QRCodeSVG value={ad.linkUrl} size={160} />
                    </div>
                    <p className="text-[1.3vw] font-semibold text-white/80">Scan to {ad.cta.toLowerCase()}</p>
                  </div>
                )}
              </div>
              <div className="absolute left-[2vw] top-[2vh]">{brand}</div>
              <div className="absolute right-[2vw] top-[2.5vh] flex gap-1.5">
                {playlist.map((p, i) => (
                  <span key={p.campaignId + i} className={`h-1.5 w-6 rounded-full ${i === index % playlist.length ? "bg-white" : "bg-white/30"}`} />
                ))}
              </div>
            </div>
          );
        })()
      )}
      {offline && <div className="absolute bottom-2 left-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">Reconnecting…</div>}
      {needsTap && state?.paired && (
        <div className="absolute bottom-2 right-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">Tap anywhere for full screen</div>
      )}
      <style>{`@keyframes fadein{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  );
}
