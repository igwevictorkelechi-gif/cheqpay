"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { api, getAccessToken } from "@/services/api";

type Limits = {
  singleTxKobo: string;
  dailyDepositKobo: string;
  dailyWithdrawalKobo: string;
  cryptoWithdrawalEnabled: boolean;
};

const fmtNgn = (kobo: string) =>
  "₦" + (Number(kobo) / 100).toLocaleString("en-NG", { maximumFractionDigits: 0 });

function LimitCard({
  label,
  value,
  up,
  sub,
}: {
  label: string;
  value: string;
  up: boolean;
  sub?: string;
}) {
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <div className="rounded-3xl bg-card p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-base text-muted">{label}</p>
          <p className="mt-1 text-xl font-bold text-ink">{value}</p>
        </div>
        <Arrow className="h-6 w-6 text-ink" />
      </div>
      {!!sub && (
        <>
          <div className="mt-4 h-1.5 rounded-full bg-circle">
            <div className="h-1.5 w-full rounded-full bg-brand" />
          </div>
          <p className="mt-2 text-sm text-muted">{sub}</p>
        </>
      )}
    </div>
  );
}

export default function AccountLimitsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"crypto" | "cash">("crypto");
  const [tier, setTier] = useState<number | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!(await getAccessToken())) return;
        const { kycTier, limits } = await api.getKyc();
        setTier(kycTier);
        setLimits(limits);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const verified = (tier ?? 0) >= 2;

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-10 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-6 text-4xl font-extrabold text-ink">Account limits</h1>
        <div className="mb-5 mt-3 flex items-center">
          <span className="text-lg text-muted">Your account is currently&nbsp;</span>
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold text-white ${
              verified ? "bg-brand" : "bg-circle"
            }`}
          >
            {verified ? "Verified" : "Unverified"}
          </span>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex rounded-2xl bg-card p-1">
          {(["crypto", "cash"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-xl py-3 text-base font-bold ${
                tab === t ? "bg-surface text-ink" : "text-muted"
              }`}
            >
              {t === "crypto" ? "Crypto" : "Cash"}
            </button>
          ))}
        </div>

        {!limits ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-brand" />
          </div>
        ) : tab === "crypto" ? (
          <div className="space-y-4">
            <LimitCard
              label="Send"
              value={limits.cryptoWithdrawalEnabled ? "Unlimited" : "Locked"}
              up
            />
            <LimitCard label="Receive" value="Unlimited" up={false} />
          </div>
        ) : (
          <div className="space-y-4">
            <LimitCard
              label="Withdraw"
              value={`${fmtNgn(limits.dailyWithdrawalKobo)} per day`}
              up
              sub={`${fmtNgn(limits.dailyWithdrawalKobo)} available today`}
            />
            <LimitCard
              label="Deposit"
              value={`${fmtNgn(limits.dailyDepositKobo)} per day`}
              up={false}
            />
          </div>
        )}

        {!verified && (
          <div className="mt-8">
            <p className="text-center text-base leading-6 text-muted">
              Unlock higher transaction limits effortlessly! Verify your identity today and
              enjoy expanded account limits.
            </p>
            <button
              onClick={() => router.push("/kyc")}
              className="mt-6 w-full rounded-full bg-brand py-4 text-base font-bold text-white"
            >
              Verify your identity
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
