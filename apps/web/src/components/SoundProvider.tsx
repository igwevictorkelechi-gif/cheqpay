"use client";

import { useEffect } from "react";
import { useUIStore } from "@/store";

/**
 * A subtle click sound on button/link taps, app-wide.
 *
 * One delegated listener on the document plays a short synthesized tick when an
 * interactive element is activated — no audio assets to ship, works offline,
 * and (because it only ever fires inside a real click, which is a user gesture)
 * it never trips the browser's autoplay block. It reads the live preference from
 * the store, so the Settings toggle silences it immediately, and it is a no-op
 * where the Web Audio API isn't available.
 */
const INTERACTIVE =
  'button, a[href], [role="button"], summary, input[type="button"], input[type="submit"], ' +
  ".btn-primary, .btn-secondary, .btn-danger, .btn-ghost";

export default function SoundProvider() {
  useEffect(() => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    let ctx: AudioContext | null = null;

    function tick() {
      try {
        if (!ctx) ctx = new AudioCtx();
        // Some browsers start the context suspended until a gesture resumes it;
        // we are inside a click, so this is allowed.
        if (ctx.state === "suspended") void ctx.resume();

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        // A soft, low bass "thock" — a deep sine that drops in pitch and decays
        // quickly, so it reads as a subtle tactile thud rather than a beep.
        osc.type = "sine";
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.06);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.03, now + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
      } catch {
        /* audio unavailable — stay silent */
      }
    }

    function onClick(e: MouseEvent) {
      if (!useUIStore.getState().sound) return;
      const target = e.target as Element | null;
      if (!target || !target.closest) return;
      const el = target.closest(INTERACTIVE);
      if (!el) return;
      if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return;
      if (el.getAttribute("data-no-sound") !== null) return;
      tick();
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
