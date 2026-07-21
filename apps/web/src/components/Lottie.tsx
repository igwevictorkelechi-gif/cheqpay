"use client";

import dynamic from "next/dynamic";
import successAnim from "@/assets/lottie/success.json";
import loadingAnim from "@/assets/lottie/loading.json";

// lottie-web touches `document` at import time — must stay client-only.
const LottiePlayer = dynamic(() => import("lottie-react"), { ssr: false });

/** Brand success animation: circle pop + check draw + ring flash. Plays once. */
export function SuccessAnimation({ size = 130 }: { size?: number }) {
  return (
    <LottiePlayer
      animationData={successAnim}
      loop={false}
      autoplay
      style={{ width: size, height: size }}
      aria-label="Success"
    />
  );
}

/** Brand three-dot loading animation. Loops. */
export function LoadingAnimation({ size = 90 }: { size?: number }) {
  return (
    <LottiePlayer
      animationData={loadingAnim}
      loop
      autoplay
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}

/** Full-screen route loading state (used by Next.js loading.tsx). */
export function LoadingScreen() {
  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="flex min-h-screen w-full max-w-[480px] flex-col items-center justify-center bg-surface">
        <LoadingAnimation />
        <p className="-mt-2 text-sm font-semibold text-muted">Loading…</p>
      </div>
    </div>
  );
}
