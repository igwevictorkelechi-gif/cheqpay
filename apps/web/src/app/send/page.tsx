"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Landmark, Smartphone, Wifi, Zap, Tv, Dices, LayoutGrid, type LucideIcon } from "lucide-react";
import AppShell from "@/components/AppShell";
import { CapsLabel } from "@/components/MobileUI";
import { useFeatures } from "@/lib/useFeatures";
import { detectPayTarget, payTargetHint, type PayTarget } from "@/lib/payTarget";
import { api, type Beneficiary } from "@/services/api";

type Recent =
  | { kind: "user"; key: string; username: string; detail: string }
  | { kind: "bank"; key: string; b: Beneficiary };

const BILLS: { service: string; label: string; icon: LucideIcon }[] = [
  { service: "airtime", label: "Airtime", icon: Smartphone },
  { service: "data", label: "Data", icon: Wifi },
  { service: "electricity", label: "Electricity", icon: Zap },
  { service: "cabletv", label: "TV", icon: Tv },
  { service: "betting", label: "Betting", icon: Dices },
];

/**
 * v2 Pay: one place to send money. A single "To" field works out where the
 * money goes from what's typed — an @username (a CheqPay user, instant), the
 * user's own 10-digit bank account (a withdrawal), a phone (airtime/data) or a
 * meter/smartcard number (a bill) — and says so underneath. Recents and the
 * bill grid cover the common cases without typing. Every path ends in the
 * existing screen for that payment, so amounts, fees, limits and the PIN are
 * handled exactly as before.
 */
export default function PayPage() {
  const router = useRouter();
  const features = useFeatures();
  const [to, setTo] = useState("");
  const [focused, setFocused] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const target: PayTarget = useMemo(() => detectPayTarget(to), [to]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [txns, bens] = await Promise.all([
        api.getTransactions(30, "NGN").catch(() => ({ transactions: [] })),
        api.getBeneficiaries().catch(() => ({ beneficiaries: [] })),
      ]);
      if (!active) return;
      const seen = new Set<string>();
      const users: Recent[] = [];
      for (const t of txns.transactions) {
        if (t.type !== "TRANSFER_OUT" || !t.counterparty || seen.has(t.counterparty)) continue;
        seen.add(t.counterparty);
        users.push({ kind: "user", key: `u:${t.counterparty}`, username: t.counterparty, detail: "CheqPay user · arrives instantly" });
        if (users.length === 3) break;
      }
      const banks: Recent[] = bens.beneficiaries.slice(0, 2).map((b) => ({ kind: "bank", key: `b:${b.id}`, b }));
      setRecents([...users, ...banks].slice(0, 4));
    })();
    return () => {
      active = false;
    };
  }, []);

  const canGo =
    (target.kind === "user" && features.p2p_transfers) ||
    (target.kind === "account" && features.ngn_withdrawals) ||
    (target.kind === "phone" && features.bill_payments);

  function go(t: PayTarget = target) {
    if (t.kind === "user") router.push(`/send-user?to=${encodeURIComponent(t.username)}`);
    else if (t.kind === "account") router.push("/withdraw");
    else if (t.kind === "phone") router.push(`/pay-bill/airtime?customer=${t.phone}`);
  }

  function bill(service: string) {
    const customer =
      target.kind === "meter" ? target.number : target.kind === "phone" ? target.phone : null;
    router.push(`/pay-bill/${service}${customer ? `?customer=${customer}` : ""}`);
  }

  return (
    <AppShell>
      <div className="px-5 pb-8 pt-3">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label="Back"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-ink"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink">Pay anyone</h1>
        </div>

        {/* The smart input — the screen's one accent while focused. */}
        <label
          className={`block rounded-2xl border bg-card px-4 pb-3 pt-3 transition-shadow ${
            focused ? "border-brand shadow-[0_0_0_4px_rgba(107,91,149,0.18)]" : "border-border"
          }`}
        >
          <CapsLabel>To</CapsLabel>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canGo) go();
            }}
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="@username or number"
            className="tnum mt-1 block w-full bg-transparent text-[26px] font-extrabold leading-[30px] tracking-[-0.02em] text-ink placeholder:text-muted/50 focus:outline-none"
          />
        </label>
        <p className={`mt-2 px-1 text-[13px] ${target.kind === "unknown" ? "text-red-400" : "text-muted"}`}>
          {payTargetHint(target)}
        </p>

        {recents.length > 0 && (
          <div className="mt-6">
            <CapsLabel className="mb-2.5 block">Recent</CapsLabel>
            <div className="overflow-hidden rounded-3xl border border-border bg-card">
              {recents.map((r, i) => (
                <button
                  key={r.key}
                  onClick={() =>
                    r.kind === "user"
                      ? go({ kind: "user", username: r.username })
                      : router.push("/withdraw")
                  }
                  className="flex w-full items-center gap-3 pl-4 text-left active:opacity-70"
                >
                  {r.kind === "user" ? (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#D81E9B] text-[17px] font-extrabold text-white">
                      {r.username.charAt(0).toUpperCase()}
                    </span>
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-circle text-ink">
                      <Landmark className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                  )}
                  <span className={`min-w-0 flex-1 py-3.5 pr-4 ${i > 0 ? "border-t border-hairline" : ""}`}>
                    <span className="block truncate text-[15px] font-semibold text-ink">
                      {r.kind === "user" ? `@${r.username}` : r.b.accountName}
                    </span>
                    <span className="tnum block truncate text-[13px] text-muted">
                      {r.kind === "user" ? r.detail : `${r.b.bankName} · ${r.b.accountNumber} · your account`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {features.bill_payments && (
          <div className="mt-6">
            <CapsLabel className="mb-2.5 block">Or pay a bill</CapsLabel>
            <div className="grid grid-cols-3 gap-2.5">
              {BILLS.map(({ service, label, icon: Icon }) => (
                <button
                  key={service}
                  onClick={() => bill(service)}
                  className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card text-[13px] font-semibold text-muted active:opacity-70"
                >
                  <Icon className="h-5 w-5 text-ink" strokeWidth={1.75} />
                  {label}
                </button>
              ))}
              <button
                onClick={() => router.push("/pay-bill")}
                className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card text-[13px] font-semibold text-muted active:opacity-70"
              >
                <LayoutGrid className="h-5 w-5 text-ink" strokeWidth={1.75} />
                All bills
              </button>
            </div>
          </div>
        )}

        {/* Secondary until the input says where the money goes. */}
        <button
          onClick={() => go()}
          disabled={!canGo}
          className={`mt-6 flex h-[54px] w-full items-center justify-center rounded-full text-base font-bold transition ${
            canGo ? "bg-brand text-white shadow-cta active:scale-[0.99]" : "border border-border bg-card text-muted"
          }`}
        >
          Continue
        </button>
      </div>
    </AppShell>
  );
}
