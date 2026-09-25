"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Home, RotateCw, WifiOff } from "lucide-react";

/**
 * The 404's buttons. If the device itself is offline, say so — "page not
 * found" and "no internet" look alike to a user, and the fix is different.
 */
export default function NotFoundActions() {
  const router = useRouter();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return (
    <>
      {offline && (
        <p className="relative mt-5 flex items-center gap-2 rounded-full bg-amber-500/15 px-4 py-2 text-sm font-semibold text-amber-500">
          <WifiOff className="h-4 w-4" /> You&apos;re offline — reconnect and try again.
        </p>
      )}
      <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-2 rounded-full bg-gradient-to-r from-brand to-brand-light px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand/30 active:scale-[0.98]"
        >
          <Home className="h-4 w-4" /> Back to home
        </button>
        <button
          onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          className="flex items-center gap-2 rounded-full bg-card px-6 py-3 text-sm font-bold text-ink active:scale-[0.98]"
        >
          <ArrowLeft className="h-4 w-4" /> Go back
        </button>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-bold text-ink active:scale-[0.98]"
        >
          <RotateCw className="h-4 w-4" /> Try again
        </button>
      </div>
    </>
  );
}
