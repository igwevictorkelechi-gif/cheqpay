"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, Download, Loader2 } from "lucide-react";
import TxnRow from "@/components/TxnRow";
import { api, getAccessToken, type LedgerTransaction } from "@/services/api";

type WalletOpt = { asset: string; name: string; bg: string; fg: string };

const wallets: WalletOpt[] = [
  { asset: "NGN", name: "Naira", bg: "#0B7A3B", fg: "#FFFFFF" },
  { asset: "BTC", name: "Bitcoin", bg: "#F7931A", fg: "#FFFFFF" },
  { asset: "USDT", name: "Tether", bg: "#26A17B", fg: "#FFFFFF" },
];

export default function WalletStatementPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<WalletOpt | null>(null);
  const [txns, setTxns] = useState<LedgerTransaction[] | null>(null);

  useEffect(() => {
    if (!selected) return;
    setTxns(null);
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const { transactions } = await api.getTransactions(100);
        setTxns(transactions.filter((t) => t.asset === selected.asset));
      } catch {
        setTxns([]);
      }
    })();
  }, [selected]);

  const download = () => {
    if (!selected || !txns) return;
    const rows = [
      ["Date", "Type", "Amount", "Asset", "Status"],
      ...txns.map((t) => [
        new Date(t.createdAt).toISOString(),
        t.type,
        t.amountFormatted,
        t.asset,
        t.status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `cheqpay-${selected.asset}-statement.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = wallets.filter(
    (w) =>
      w.name.toLowerCase().includes(query.toLowerCase()) ||
      w.asset.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3">
        <button
          onClick={() => (selected ? setSelected(null) : router.back())}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {!selected ? (
          <>
            <h1 className="mb-5 mt-6 text-4xl font-extrabold text-ink">Select wallet</h1>

            <div className="mb-5 flex items-center gap-3 rounded-2xl border border-border px-4 py-3">
              <Search className="h-5 w-5 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                className="w-full bg-transparent text-base text-ink outline-none placeholder:text-muted"
              />
            </div>

            <div className="rounded-3xl bg-card px-4">
              {filtered.map((w, i) => (
                <button
                  key={w.asset}
                  onClick={() => setSelected(w)}
                  className={`flex w-full items-center py-4 text-left ${
                    i > 0 ? "border-t border-border" : ""
                  }`}
                >
                  <span
                    className="flex h-11 w-11 items-center justify-center rounded-full font-bold"
                    style={{ backgroundColor: w.bg, color: w.fg }}
                  >
                    {w.asset === "NGN" ? "₦" : w.asset[0]}
                  </span>
                  <span className="ml-3">
                    <span className="block text-lg font-bold text-ink">{w.name}</span>
                    <span className="block text-sm text-muted">{w.asset}</span>
                  </span>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">No wallets found.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="mb-5 mt-6 flex items-center justify-between">
              <h1 className="text-3xl font-extrabold text-ink">{selected.name}</h1>
              <button
                onClick={download}
                className="flex items-center gap-2 rounded-full bg-card px-4 py-2 text-sm font-semibold text-ink"
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>

            {!txns ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-brand" />
              </div>
            ) : txns.length === 0 ? (
              <div className="rounded-3xl bg-card p-6 text-center text-sm text-muted">
                No {selected.asset} transactions yet.
              </div>
            ) : (
              <div className="rounded-3xl bg-card px-4">
                {txns.map((t, i) => (
                  <TxnRow key={t.id} t={t} divider={i > 0} onClick={() => router.push(`/transaction/${t.id}`)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
