"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, CheckCircle2, ChevronLeft, Loader2, Send } from "lucide-react";
import { SuccessAnimation } from "@/components/Lottie";
import { api, ApiError, type Balance } from "@/services/api";
import { useFeatures } from "@/lib/useFeatures";
import DesktopSidebar from "@/components/DesktopSidebar";

type Step = "form" | "done";

/**
 * Send NGN or crypto to another CheqPay user by username. The recipient is
 * confirmed before any money moves — the equivalent of a bank name enquiry.
 */
export default function SendToUserPage() {
  const router = useRouter();
  const features = useFeatures();

  const [step, setStep] = useState<Step>("form");
  const [balances, setBalances] = useState<Balance[]>([]);
  const [asset, setAsset] = useState("NGN");
  const [username, setUsername] = useState("");
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ amount: string; asset: string; to: string } | null>(null);

  useEffect(() => {
    api
      .getBalances()
      .then(({ balances }) => setBalances(balances))
      .catch(() => {});
  }, []);

  const held = balances.find((b) => b.asset === asset);
  const available = Number(held?.availableFormatted ?? 0);

  /** Confirm the username exists (and isn't the sender) before sending. */
  async function check() {
    setError(null);
    setConfirmed(null);
    setChecking(true);
    try {
      const res = await api.lookupUser(username.replace(/^@+/, ""));
      setConfirmed(res.username);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t find that username.");
    } finally {
      setChecking(false);
    }
  }

  async function send() {
    setError(null);
    setSending(true);
    try {
      const res = await api.sendToUser({
        username: confirmed ?? username,
        asset,
        amount,
        note: note.trim() || undefined,
      });
      setSent({ amount: res.amountFormatted, asset: res.asset, to: res.recipient });
      setStep("done");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const overBalance = amountValid && amountNum > available;
  const canSend = !!confirmed && amountValid && !overBalance && !sending;

  const inputCls =
    "w-full rounded-2xl border border-border bg-card px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand";

  if (step === "done" && sent) {
    return (
      <div className="flex min-h-screen justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
        <div className="flex min-h-screen w-full max-w-[480px] flex-col items-center bg-surface px-5 pb-10 pt-4 lg:max-w-3xl">
          <div className="mt-24 flex flex-col items-center text-center">
            <SuccessAnimation />
            <h1 className="mt-6 text-2xl font-extrabold text-ink">Money sent</h1>
            <p className="mt-2 text-sm text-muted">
              <span className="font-bold text-ink">
                {sent.asset === "NGN" ? "₦" : ""}
                {sent.amount}
                {sent.asset === "NGN" ? "" : ` ${sent.asset}`}
              </span>{" "}
              is now in @{sent.to}’s wallet.
            </p>
          </div>
          <div className="mt-auto w-full pt-6">
            <button
              onClick={() => router.replace("/")}
              className="w-full rounded-2xl bg-gradient-to-r from-brand to-brand-light py-4 font-bold text-white active:scale-[0.99]"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3 lg:max-w-3xl">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-4 text-3xl font-extrabold text-ink">Send to a user</h1>
        <p className="mt-1 text-sm text-muted">
          Instant and free between CheqPay accounts.
        </p>

        {!features.p2p_transfers ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-circle">
              <Send className="h-7 w-7 text-brand-light" />
            </span>
            <p className="mt-4 text-lg font-bold text-ink">Coming soon</p>
            <p className="mt-1 max-w-[300px] text-sm text-muted">
              Sending to other CheqPay users isn’t switched on yet.
            </p>
          </div>
        ) : (
          <>
            <label htmlFor="username" className="mb-1.5 mt-6 block text-sm font-semibold text-muted">
              Recipient username
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <AtSign className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                <input
                  id="username"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value.replace(/^@+/, ""));
                    setConfirmed(null);
                    setError(null);
                  }}
                  placeholder="username"
                  autoCapitalize="none"
                  className={inputCls + " pl-10"}
                />
              </div>
              <button
                onClick={check}
                disabled={username.length < 3 || checking || !!confirmed}
                className="rounded-2xl bg-card px-4 font-bold text-ink disabled:opacity-40"
              >
                {checking ? <Loader2 className="h-5 w-5 animate-spin" /> : "Check"}
              </button>
            </div>

            {confirmed && (
              <div className="mt-3 flex items-center gap-2 rounded-2xl border border-green-500/30 bg-green-500/10 p-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-400" />
                <p className="text-sm font-bold text-ink">Sending to @{confirmed}</p>
              </div>
            )}

            <p className="mb-2 mt-6 text-sm font-semibold text-muted">Asset</p>
            <div className="flex flex-wrap gap-2">
              {["NGN", "BTC", "USDT", "USDC"].map((a) => (
                <button
                  key={a}
                  onClick={() => {
                    setAsset(a);
                    setAmount("");
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                    asset === a ? "bg-brand text-white" : "bg-card text-muted hover:text-ink"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>

            <label htmlFor="amount" className="mb-1.5 mt-6 block text-sm font-semibold text-muted">
              Amount
            </label>
            <input
              id="amount"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^\d.]/g, ""));
                setError(null);
              }}
              inputMode="decimal"
              placeholder="0.00"
              className={inputCls}
            />
            <p className="mt-1.5 text-xs text-muted">
              Available: {asset === "NGN" ? "₦" : ""}
              {available.toLocaleString("en-NG", { maximumFractionDigits: 8 })}
              {asset === "NGN" ? "" : ` ${asset}`}
            </p>

            <label htmlFor="note" className="mb-1.5 mt-5 block text-sm font-semibold text-muted">
              Note (optional)
            </label>
            <input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={140}
              placeholder="What’s it for?"
              className={inputCls}
            />

            {(error || overBalance) && (
              <p className="mt-4 text-sm text-red-400">
                {error ?? `That's more than your ${asset} balance.`}
              </p>
            )}

            <div className="mt-auto pt-6">
              <button
                onClick={send}
                disabled={!canSend}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand to-brand-light py-4 text-base font-bold text-white active:scale-[0.98] disabled:opacity-50"
              >
                {sending && <Loader2 className="h-5 w-5 animate-spin" />}
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
