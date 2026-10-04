import { useEffect, useState } from 'react';
import { api, type FeatureFlags } from '@/services/api';

/** Everything ON — safe default while flags load (server enforces anyway). */
export const ALL_ON: FeatureFlags = {
  ngn_deposits: true,
  ngn_withdrawals: true,
  crypto_trading: true,
  crypto_deposits: true,
  crypto_withdrawals: true,
  bill_payments: true,
  virtual_cards: true,
  p2p_transfers: true,
  gadgets: true,
  events: true,
  // New and off by default: stay hidden until the server says they're on.
  gift_cards_sell: false,
  gift_cards_buy: false,
};

/** Admin feature switches for hiding disabled features in the app UI. */
export function useFeatures(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(ALL_ON);

  useEffect(() => {
    let active = true;
    api
      .getFeatures()
      .then(({ features }) => {
        if (active) setFlags({ ...ALL_ON, ...features });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return flags;
}
