"use client";

import { useEffect, useState } from "react";
import { api } from "@/services/api";

export interface LiveCryptoEntry {
  asset: string;
  address: string;
  network: string;
  networkLabel: string;
}

/**
 * Which crypto assets are live right now (manual custody: the admin has set a
 * deposit wallet for them). Everything else renders as "Coming soon".
 */
export function useCryptoAvailability() {
  const [entries, setEntries] = useState<Record<string, LiveCryptoEntry>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { addresses } = await api.getCryptoDepositAddresses();
        if (!active) return;
        const map: Record<string, LiveCryptoEntry> = {};
        for (const e of addresses) map[e.asset] = e;
        setEntries(map);
      } catch {
        /* signed out or offline — nothing live */
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { entries, loaded };
}
