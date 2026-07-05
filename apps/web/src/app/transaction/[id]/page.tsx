"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Share2, Loader2 } from "lucide-react";
import { txnIcon, txnTitle, txnAmount } from "@/components/TxnRow";
import { shareReceiptImage } from "@/lib/receipt";
import { api, getAccessToken, type LedgerTransaction } from "@/services/api";

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "#34C759",
  PENDING: "#F5A623",
  PROCESSING: "#F5A623",
  FAILED: "#EF4444",
  REVERSED: "#EF4444",
};

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 8 }) : v;
};

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between border-t border-border py-3">
      <span className="text-sm text-muted">{label}</span>
      <span
        className={`ml-4 flex-1 text-right text-sm font-semibold text-ink ${mono ? "truncate font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

export default function TransactionDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [tx, setTx] = useState<LedgerTransaction | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken()) || !id) return;
        const { transaction } = await api.getTransaction(id);
        setTx(transaction);
      } catch {
        setNotFound(true);
      }
    })();
  }, [id]);

  const [sharing, setSharing] = useState(false);
  const share = async () => {
    if (!tx || sharing) return;
    setSharing(true);
    try {
      const result = await shareReceiptImage(tx);
      if (result === "downloaded") {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } finally {
      setSharing(false);
    }
  };

  const statusColor = tx ? STATUS_COLOR[tx.status] ?? "#9A93AD" : "#9A93AD";
  const Icon = tx ? txnIcon(tx.type).Icon : null;

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.back()}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          {tx && (
            <button
              onClick={share}
              disabled={sharing}
              className="flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold text-ink"
            >
              <Share2 className="h-4 w-4" />
              {sharing ? "…" : copied ? "Saved" : "Share"}
            </button>
          )}
        </div>

        {notFound ? (
          <p className="mt-20 text-center text-muted">Transaction not found.</p>
        ) : !tx ? (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        ) : (
          <>
            <div className="mb-2 mt-6 flex flex-col items-center">
              <span
                className="flex h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: txnIcon(tx.type).bg }}
              >
                {Icon && <Icon className="h-8 w-8" style={{ color: txnIcon(tx.type).color }} />}
              </span>
              <p
                className={`mt-4 text-3xl font-extrabold ${
                  txnAmount(tx).positive ? "text-green-400" : "text-ink"
                }`}
              >
                {txnAmount(tx).text}
              </p>
              <p className="mt-1 text-base text-muted">{txnTitle(tx)}</p>
              <span
                className="mt-3 rounded-full px-3 py-1 text-xs font-bold"
                style={{ backgroundColor: statusColor + "22", color: statusColor }}
              >
                {tx.status}
              </span>
            </div>

            <div className="mt-6 rounded-3xl bg-card px-4">
              <div className="flex items-start justify-between py-3">
                <span className="text-sm text-muted">Type</span>
                <span className="text-sm font-semibold text-ink">{tx.type}</span>
              </div>
              <Row label="Date" value={new Date(tx.createdAt).toLocaleString("en-NG")} />
              {tx.fromFormatted && tx.toFormatted && (
                <>
                  <Row label="From" value={`${num(tx.fromFormatted)} ${tx.fromAsset}`} />
                  <Row label="To" value={`${num(tx.toFormatted)} ${tx.toAsset}`} />
                </>
              )}
              {!!tx.rate && <Row label="Rate" value={tx.rate} />}
              {!!tx.network && <Row label="Network" value={tx.network} />}
              {!!tx.billerName && <Row label="Biller" value={tx.billerName} />}
              {!!tx.planName && <Row label="Plan" value={tx.planName} />}
              {!!tx.customer && <Row label="Recipient" value={tx.customer} />}
              {Number(tx.feeFormatted) > 0 && (
                <Row label="Fee" value={`${num(tx.feeFormatted)} ${tx.asset}`} />
              )}
              {!!tx.toAddress && <Row label="Address" value={tx.toAddress} mono />}
              {!!tx.txHash && <Row label="Tx hash" value={tx.txHash} mono />}
              <Row label="Reference" value={tx.id} mono />
            </div>

            <button
              onClick={share}
              disabled={sharing}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-4 text-base font-bold text-white disabled:opacity-70"
            >
              <Share2 className="h-5 w-5" />
              {sharing ? "Preparing…" : "Share receipt"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
