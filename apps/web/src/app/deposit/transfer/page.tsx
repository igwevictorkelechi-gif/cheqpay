"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, Copy, Check } from "lucide-react";
import { NairaFlag } from "@/components/MobileUI";
import { useAuthStore } from "@/store";

type VirtualAccount = {
  account_number: string;
  bank_name: string;
  account_name: string;
  fee: number;
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-bold text-ink">{children}</span>
    </div>
  );
}

function TransferInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user } = useAuthStore();
  const amount = Number(params.get("amount") || "1000");

  const [account, setAccount] = useState<VirtualAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/flutterwave/virtual-account", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: user?.email,
            name: user?.full_name,
            amount,
          }),
        });
        const data = await res.json();
        if (active) setAccount(data);
      } catch {
        if (active)
          setAccount({
            account_number: "7002349836",
            bank_name: "Wema Bank",
            account_name: (user?.full_name || "CheqPay User").toUpperCase(),
            fee: 150,
          });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.email, user?.full_name, amount]);

  const fee = account?.fee ?? 150;
  const toSend = amount + fee;

  const copy = () => {
    if (!account) return;
    navigator.clipboard?.writeText(account.account_number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/* Amount to send */}
        <div className="mt-4 flex flex-col items-center">
          <NairaFlag size={56} />
          <p className="mt-3 text-sm text-muted">Amount to send</p>
          <p className="mt-1 text-3xl font-extrabold text-ink">
            {toSend.toLocaleString("en-NG")} NGN
          </p>
        </div>

        {/* Account details */}
        <div className="mt-6 rounded-3xl bg-card p-5">
          <div className="flex items-center justify-between py-3">
            <span className="text-sm text-muted">Account number</span>
            <button onClick={copy} className="flex items-center gap-2">
              <span className="text-base font-bold text-ink">
                {loading ? "••••••••••" : account?.account_number}
              </span>
              {copied ? (
                <Check className="h-4 w-4 text-[#34C759]" />
              ) : (
                <Copy className="h-4 w-4 text-muted" />
              )}
            </button>
          </div>
          <div className="border-t border-border" />
          <Row label="Bank name">{loading ? "…" : account?.bank_name}</Row>
          <div className="border-t border-border" />
          <Row label="Account name">
            {loading ? "…" : account?.account_name}
          </Row>
          <div className="border-t border-border" />
          <Row label="Deposit fee">{fee} NGN</Row>
          <div className="border-t border-border" />
          <Row label="You will receive">
            {amount.toLocaleString("en-NG")} NGN
          </Row>
        </div>

        {/* Deposit terms */}
        <div className="mt-4 flex items-start gap-3 rounded-3xl bg-card p-5">
          <span className="text-2xl">🔒</span>
          <p className="text-sm text-muted">
            Only send money from a bank account with the same name as{" "}
            <span className="font-semibold text-ink">
              {(user?.full_name || "CheqPay User").toUpperCase()}
            </span>
          </p>
        </div>

        {/* CTA */}
        <div className="mt-auto pt-6">
          <button
            onClick={() => router.push(`/deposit/done?amount=${amount}`)}
            className="w-full rounded-full py-4 text-base font-bold text-white"
            style={{ backgroundColor: "#6B5B95" }}
          >
            I have made the transfer
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TransferPage() {
  return (
    <Suspense fallback={null}>
      <TransferInner />
    </Suspense>
  );
}
