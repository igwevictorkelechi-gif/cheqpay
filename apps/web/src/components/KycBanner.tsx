"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, ChevronRight, X } from "lucide-react";
import { api, getAccessToken } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";

const TIER_CACHE = "cheqpay:kyctier";

/**
 * Amber alert bar shown when the signed-in user is not yet verified (tier < 2).
 * Self-fetches the tier, paints instantly from cache, and links to /kyc.
 */
export default function KycBanner() {
  const router = useRouter();
  const [tier, setTier] = useState<number | null>(() => readCache<number>(TIER_CACHE));
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const { kycTier } = await api.getKyc();
        setTier(kycTier);
        writeCache(TIER_CACHE, kycTier);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  if (dismissed || tier === null || tier >= 2) return null;

  return (
    <div className="px-5 pb-2 pt-1">
      <button
        onClick={() => router.push("/kyc")}
        className="flex w-full items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-left active:scale-[0.99]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20">
          <ShieldAlert className="h-5 w-5 text-amber-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-200">Verify your identity</p>
          <p className="text-xs text-amber-200/80">
            Your account isn&apos;t verified yet. Verify to raise limits and unlock withdrawals.
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-amber-300" />
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-amber-300/70 active:scale-90"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </span>
      </button>
    </div>
  );
}
