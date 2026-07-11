"use client";

import { useEffect, useState } from "react";
import { api, type FeatureFlags } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";

const CACHE = "cheqpay:features";

/** Everything ON — the safe default when flags haven't loaded (or ever fail):
 *  the server still enforces switched-off features, the UI just won't pre-hide. */
export const ALL_ON: FeatureFlags = {
  ngn_deposits: true,
  ngn_withdrawals: true,
  crypto_trading: true,
  crypto_deposits: true,
  crypto_withdrawals: true,
  bill_payments: true,
};

/**
 * Admin feature switches for gating the consumer UI. Paints instantly from the
 * last-known cache, then refreshes from the API. Switched-off features are
 * hidden entirely (the server independently blocks them regardless).
 */
export function useFeatures(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(
    () => ({ ...ALL_ON, ...(readCache<Partial<FeatureFlags>>(CACHE) ?? {}) })
  );

  useEffect(() => {
    let active = true;
    api
      .getFeatures()
      .then(({ features }) => {
        if (!active) return;
        setFlags({ ...ALL_ON, ...features });
        writeCache(CACHE, features);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return flags;
}
