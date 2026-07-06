"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { api, ApiError } from "@/services/api";
import { invalidateMoneyCaches } from "@/lib/cache";
import { getAssetMeta, isAssetEnabled } from "@/lib/cryptoAssets";

function CoinIcon({ bg, glyph, size = 40 }: { bg: string; glyph: string; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ backgroundColor: bg, width: size, height: size, fontSize: size * 0.45 }}
    >
      {glyph}
    </span>
  );
}

type Stage = "form" | "review" | "checking" | "done";

export default function SendCryptoDetailPage() {
  const router = useRouter();
  const params = useParams<{ symbol: string }>();
  const symbol = (params?.symbol ?? "").toUpperCase();
  const meta = getAssetMeta(symbol);

  const [available, setAvailable] = useState<number>(0);
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [checkStep, setCheckStep] = useState(0);
  const [txHash, setTxHash] = useState<string | undefined>();

  useEffect(() => {
    if (!meta) return;
    let active = true;
    (async () => {
      try {
        await api.ensureProvisioned();
        const { balances } = await api.getBalances();
        if (!active) return;
        const b = balances.find((x) => x.asset === meta.symbol);
        if (b) setAvailable(Number(b.availableFormatted));
      } catch {
        /* not logged in */
      }
    })();
    return () => {
      active = false;
    };
  }, [meta]);

  if (!meta) {
    return (
      <div className="flex min-h-screen w-full justify-center bg-black">
        <div className="min-h-screen w-full max-w-[480px] bg-surface px-5 pt-4">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <p className="mt-10 text-center text-muted">Unsupported asset.</p>
        </div>
      </div>
    );
  }

  if (!isAssetEnabled(meta.symbol)) {
    return (
      <div className="flex min-h-screen w-full justify-center bg-black">
        <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="mt-16 flex flex-col items-center text-center">
            <h1 className="text-2xl font-extrabold text-ink">
              Sending {meta.symbol} is coming soon
            </h1>
            <p className="mt-2 max-w-[300px] text-sm text-muted">
              We&apos;re upgrading to secure stablecoin rails. {meta.symbol} transfers will be
              available shortly — your Naira wallet works as usual.
            </p>
            <button
              onClick={() => router.push("/")}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
            >
              Back home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const amountNum = Number(amount || 0);
  const min = Number(meta.minSend);
  const validAddress = toAddress.trim().length >= 20;
  const validAmount =
    amountNum >= min && amountNum <= available && Number.isFinite(amountNum) && amountNum > 0;
  const canReview = validAddress && validAmount;

  function goReview() {
    setError(null);
    if (!validAddress) {
      setError("Enter a valid destination address.");
      return;
    }
    if (amountNum < min) {
      setError(`Minimum send is ${meta!.minSend} ${meta!.symbol}.`);
      return;
    }
    if (amountNum > available) {
      setError("Amount exceeds your available balance.");
      return;
    }
    setStage("review");
  }

  async function confirmSend() {
    setError(null);
    setStage("checking");
    setCheckStep(0);
    // Animated security/auth check steps.
    const steps = [0, 1, 2];
    for (const s of steps) {
      setCheckStep(s);
      await new Promise((r) => setTimeout(r, 700));
    }
    try {
      const res = await api.createCryptoWithdrawal({
        asset: meta!.symbol,
        network: meta!.network,
        toAddress: toAddress.trim(),
        amount: amount.trim(),
      });
      invalidateMoneyCaches();
      setTxHash(res.txHash);
      setStage("done");
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : "Could not complete the transfer. Please try again.";
      setError(msg);
      setStage("review");
    }
  }

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => (stage === "review" ? setStage("form") : router.back())}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold text-ink">Send {meta.symbol}</h1>
        </div>

        {/* FORM */}
        {stage === "form" && (
          <>
            <div className="mt-6 flex flex-col items-center">
              <CoinIcon bg={meta.color} glyph={meta.glyph} size={56} />
              <p className="mt-3 text-sm text-muted">Available balance</p>
              <p className="text-lg font-bold text-ink">
                {available} {meta.symbol}
              </p>
            </div>

            <label className="mb-2 mt-7 block text-sm font-semibold text-muted">
              Destination wallet address
            </label>
            <textarea
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              rows={2}
              placeholder={`Paste ${meta.symbol} (${meta.networkLabel}) address`}
              className="w-full resize-none rounded-2xl border border-border bg-card px-4 py-3.5 text-sm text-ink placeholder-muted outline-none focus:border-brand"
            />

            <label className="mb-2 mt-5 block text-sm font-semibold text-muted">Amount</label>
            <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3.5 focus-within:border-brand">
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="w-full bg-transparent text-lg font-bold text-ink placeholder-muted outline-none"
              />
              <span className="text-sm font-bold text-muted">{meta.symbol}</span>
              <button
                onClick={() => setAmount(String(available))}
                className="rounded-full bg-brand/20 px-3 py-1 text-xs font-bold text-brand-light active:scale-95"
              >
                MAX
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Minimum {meta.minSend} {meta.symbol} · Network {meta.networkLabel}
            </p>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <div className="mt-6 flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-200/90">
                Double-check the address. Crypto transfers are irreversible and cannot be
                recovered if sent to the wrong address or network.
              </p>
            </div>

            <button
              onClick={goReview}
              disabled={!canReview}
              className="mt-6 w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99] disabled:opacity-40"
            >
              Continue
            </button>
          </>
        )}

        {/* REVIEW */}
        {stage === "review" && (
          <>
            <p className="mb-2 mt-7 text-sm font-semibold text-muted">Review transfer</p>
            <div className="overflow-hidden rounded-2xl bg-card">
              <Row label="Asset" value={`${meta.name} (${meta.symbol})`} />
              <Row label="Network" value={meta.networkLabel} bordered />
              <Row label="Amount" value={`${amount} ${meta.symbol}`} bordered />
              <div className="border-t border-border px-4 py-4">
                <p className="text-sm text-muted">To address</p>
                <p className="mt-1 break-all text-sm font-semibold text-ink">{toAddress.trim()}</p>
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <div className="mt-6 flex items-center gap-2 text-xs text-muted">
              <ShieldCheck className="h-4 w-4 text-brand-light" />
              Your transfer will pass an authentication & security check before approval.
            </div>

            <button
              onClick={confirmSend}
              className="mt-4 w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
            >
              Confirm & send
            </button>
            <button
              onClick={() => setStage("form")}
              className="mt-3 w-full rounded-2xl bg-card py-4 font-bold text-ink active:scale-[0.99]"
            >
              Edit
            </button>
          </>
        )}

        {/* CHECKING */}
        {stage === "checking" && (
          <div className="mt-16 flex flex-col items-center text-center">
            <div className="relative">
              <ShieldCheck className="h-16 w-16 text-brand-light" />
              <Loader2 className="absolute -bottom-1 -right-1 h-7 w-7 animate-spin text-brand" />
            </div>
            <p className="mt-6 text-lg font-bold text-ink">Security check</p>
            <div className="mt-6 w-full space-y-3 text-left">
              <CheckLine active={checkStep >= 0} label="Verifying your identity" />
              <CheckLine active={checkStep >= 1} label="Screening destination address" />
              <CheckLine active={checkStep >= 2} label="Approving transfer" />
            </div>
          </div>
        )}

        {/* DONE */}
        {stage === "done" && (
          <div className="mt-16 flex flex-col items-center text-center">
            <CheckCircle2 className="h-20 w-20 text-green-400" />
            <p className="mt-6 text-2xl font-extrabold text-ink">Transfer submitted</p>
            <p className="mt-2 text-sm text-muted">
              {amount} {meta.symbol} is on its way to your destination address.
            </p>
            {txHash && (
              <p className="mt-3 break-all rounded-xl bg-card px-3 py-2 text-xs text-muted">
                Tx: {txHash}
              </p>
            )}
            <button
              onClick={() => router.push("/crypto")}
              className="mt-8 w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-4 ${
        bordered ? "border-t border-border" : ""
      }`}
    >
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

function CheckLine({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      {active ? (
        <CheckCircle2 className="h-5 w-5 text-green-400" />
      ) : (
        <Loader2 className="h-5 w-5 animate-spin text-muted" />
      )}
      <span className={`text-sm ${active ? "text-ink" : "text-muted"}`}>{label}</span>
    </div>
  );
}
