"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Landmark, Loader2, Plus, Repeat } from "lucide-react";
import {
  api,
  ApiError,
  type AutoCashoutCoin,
  type AutoCashoutRun,
  type AutoCashoutState,
  type Beneficiary,
} from "@/services/api";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";
import DesktopSidebar from "@/components/DesktopSidebar";

const COINS: AutoCashoutCoin[] = ["USDT", "USDC", "BTC"];

const STATUS: Record<AutoCashoutRun["status"], { label: string; cls: string }> = {
  queued: { label: "Selling…", cls: "text-muted" },
  sold: { label: "Paying out…", cls: "text-muted" },
  paid: { label: "Sent to bank", cls: "text-emerald-400" },
  skipped: { label: "Kept as crypto", cls: "text-amber-400" },
  kept_ngn: { label: "Kept as naira", cls: "text-amber-400" },
  failed: { label: "Being checked", cls: "text-red-400" },
};

/**
 * Auto cash-out: every USDT, USDC or BTC deposit is sold for naira at the
 * current rate and sent to one of the user's own saved bank accounts. The
 * server applies the normal sell rate, withdrawal fee, minimum and limits;
 * this page only chooses the coins and the account.
 */
export default function AutoCashoutPage() {
  const router = useRouter();
  const { authorize } = useTransactionPin();

  const [state, setState] = useState<AutoCashoutState | null>(null);
  const [accounts, setAccounts] = useState<Beneficiary[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [coins, setCoins] = useState<AutoCashoutCoin[]>(["USDT", "USDC"]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([api.getAutoCashout(), api.getBeneficiaries()]);
      const list = Array.isArray(b.beneficiaries) ? b.beneficiaries : [];
      setState(s);
      setAccounts(list);
      setEnabled(s.enabled);
      if (s.assets.length) setCoins(s.assets);
      setAccountId(s.beneficiary?.id ?? list[0]?.id ?? null);
    } catch {
      setError("Couldn’t load your settings. Please refresh.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleCoin(c: AutoCashoutCoin) {
    setSaved(false);
    setCoins((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function save(nextEnabled: boolean) {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const input = { enabled: nextEnabled, assets: coins, beneficiaryId: accountId };
      if (nextEnabled) {
        await authorize((pin) => api.setAutoCashout(input, pin), {
          title: "Turn on auto cash-out",
          detail: "Enter your transaction PIN to let CheqPay sell crypto you receive and pay it to your bank.",
        });
      } else {
        await api.setAutoCashout(input);
      }
      setEnabled(nextEnabled);
      setSaved(true);
      load();
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(e instanceof ApiError ? e.message : "Couldn’t save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const changed =
    !!state &&
    enabled &&
    (accountId !== state.beneficiary?.id ||
      coins.length !== state.assets.length ||
      coins.some((c) => !state.assets.includes(c)));
  const canTurnOn = coins.length > 0 && Boolean(accountId) && !busy;

  return (
    <div className="flex min-h-screen justify-center bg-backdrop lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3 lg:max-w-3xl">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-4 text-3xl font-extrabold text-ink">Auto cash-out</h1>
        <p className="mt-1 text-sm text-muted">
          When crypto lands in your wallet, we sell it for naira at the current rate and send it to your bank — no
          taps needed.
        </p>

        {!state ? (
          error ? (
            <p className="mt-8 text-sm text-muted">{error}</p>
          ) : (
            <div className="mt-16 flex justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-muted" />
            </div>
          )
        ) : !state.available ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-circle">
              <Repeat className="h-7 w-7 text-muted" />
            </span>
            <p className="mt-4 font-bold text-ink">Not available yet</p>
            <p className="mt-1 max-w-[280px] text-sm text-muted">Auto cash-out isn’t switched on right now.</p>
          </div>
        ) : (
          <>
            {/* On / off */}
            <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="font-bold text-ink">{enabled ? "Auto cash-out is on" : "Auto cash-out is off"}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {enabled && state.beneficiary
                    ? `Paying to ${state.beneficiary.label}`
                    : "Deposits stay in your wallet as crypto"}
                </p>
              </div>
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted" />
              ) : (
                <button
                  role="switch"
                  aria-checked={enabled}
                  aria-label="Auto cash-out"
                  disabled={!enabled && !canTurnOn}
                  onClick={() => save(!enabled)}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                    enabled ? "bg-brand" : "bg-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${
                      enabled ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </button>
              )}
            </div>

            {/* Coins */}
            <p className="mt-6 mb-2 text-sm font-semibold text-muted">Cash out these coins</p>
            <div className="flex gap-2">
              {COINS.map((c) => {
                const on = coins.includes(c);
                return (
                  <button
                    key={c}
                    onClick={() => toggleCoin(c)}
                    aria-pressed={on}
                    className={`flex items-center gap-1 rounded-full px-4 py-2 text-sm font-bold ${
                      on ? "bg-brand text-white" : "bg-card text-muted"
                    }`}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                    {c}
                  </button>
                );
              })}
            </div>

            {/* Account */}
            <p className="mt-6 mb-2 text-sm font-semibold text-muted">Pay to</p>
            {accounts.length === 0 ? (
              <button
                onClick={() => router.push("/bank-accounts")}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-4 font-bold text-brand-light"
              >
                <Plus className="h-5 w-5" /> Add a bank account in your name
              </button>
            ) : (
              <div className="space-y-2">
                {accounts.map((b) => {
                  const on = accountId === b.id;
                  return (
                    <button
                      key={b.id}
                      onClick={() => {
                        setAccountId(b.id);
                        setSaved(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-4 text-left ${
                        on ? "border-brand bg-card" : "border-border bg-card"
                      }`}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-circle">
                        <Landmark className="h-5 w-5 text-ink" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-bold text-ink">{b.accountName}</p>
                        <p className="truncate text-sm text-muted">
                          {b.bankName} ••{b.accountNumber.slice(-4)}
                        </p>
                      </div>
                      <span
                        className={`h-5 w-5 shrink-0 rounded-full border-2 ${
                          on ? "border-brand bg-brand" : "border-border"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            )}

            {/* What applies */}
            <div className="mt-6 rounded-2xl border border-border bg-card p-4">
              <p className="mb-2 font-semibold text-ink">Good to know</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted">
                <li>Sold at our current sell rate the moment the deposit confirms.</li>
                <li>A ₦{state.payoutFeeNgn.toLocaleString("en-NG")} withdrawal fee comes out of each payout.</li>
                <li>
                  Deposits worth less than ₦{state.minPayoutNgn.toLocaleString("en-NG")} stay in your wallet as
                  crypto.
                </li>
                <li>Your daily withdrawal limit still applies. Anything over it stays in your wallet.</li>
                <li>If the bank can’t be reached, your money stays safe in your wallet and we tell you.</li>
              </ul>
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
            {saved && !error && <p className="mt-3 text-sm text-emerald-400">Saved.</p>}

            {(changed || (!enabled && canTurnOn)) && (
              <button
                onClick={() => save(true)}
                disabled={!canTurnOn}
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand py-4 font-bold text-white disabled:opacity-50"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                {enabled ? "Save changes" : "Turn on auto cash-out"}
              </button>
            )}

            {/* Recent */}
            {state.runs.length > 0 && (
              <>
                <p className="mt-8 mb-2 text-sm font-semibold text-muted">Recent</p>
                <div className="divide-y divide-border rounded-2xl border border-border bg-card">
                  {state.runs.map((r) => (
                    <div key={r.id} className="p-4">
                      <div className="flex justify-between gap-3">
                        <p className="font-semibold text-ink">
                          {r.amount} {r.coin}
                          {r.payout ? ` → ₦${Number(r.payout).toLocaleString("en-NG")}` : ""}
                        </p>
                        <p className={`shrink-0 text-xs font-bold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</p>
                      </div>
                      {r.reason && (r.status === "skipped" || r.status === "kept_ngn" || r.status === "failed") && (
                        <p className="mt-1 text-xs text-muted">{r.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
