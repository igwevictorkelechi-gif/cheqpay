"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Receipt } from "lucide-react";
import AppShell from "@/components/AppShell";
import TxnRow from "@/components/TxnRow";
import { api, getAccessToken, type LedgerTransaction } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";

const TX_CACHE = "cheqpay:txns";

export default function TransactionsPage() {
  const router = useRouter();
  const [txns, setTxns] = useState<LedgerTransaction[]>(
    () => readCache<LedgerTransaction[]>(TX_CACHE) ?? []
  );
  const [loading, setLoading] = useState(() => !readCache<LedgerTransaction[]>(TX_CACHE));
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          setNeedsLogin(true);
          return;
        }
        const run = () => api.getTransactions(100);
        let res;
        try {
          res = await run();
        } catch {
          await api.ensureProvisioned();
          res = await run();
        }
        if (!active) return;
        setTxns(res.transactions);
        writeCache(TX_CACHE, res.transactions);
      } catch {
        if (active && txns.length === 0) setNeedsLogin(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AppShell>
      <div className="px-5 pb-4 pt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold text-ink">Transactions</h1>
        </div>

        <div className="mt-6">
          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-card" />
              ))}
            </div>
          ) : needsLogin ? (
            <div className="py-16 text-center">
              <Receipt className="mx-auto mb-4 h-12 w-12 text-muted" />
              <p className="text-muted">Sign in to see your transactions.</p>
            </div>
          ) : txns.length === 0 ? (
            <div className="py-16 text-center">
              <Receipt className="mx-auto mb-4 h-12 w-12 text-muted" />
              <p className="text-muted">No transactions yet.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl bg-card">
              {txns.map((t, i) => (
                <TxnRow key={t.id} t={t} divider={i > 0} />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
