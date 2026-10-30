"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BrandLogo from "@/components/BrandLogo";
import { API_BASE } from "@/services/api";

interface PayTarget {
  username: string;
  displayName: string | null;
  ngn: { bankName: string; accountNumber: string } | null;
}

/** The marketing site, where the app download links live. */
const APP_HOME = "https://mycheqpay.com";

function PayContent() {
  const params = useSearchParams();
  const username = (params.get("u") ?? "").replace(/^@+/, "");
  const token = params.get("c") ?? "";

  const [target, setTarget] = useState<PayTarget | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username) || !token) {
      setState("notfound");
      return;
    }
    let active = true;
    fetch(`${API_BASE}/api/pay/${encodeURIComponent(username)}?c=${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as PayTarget) : null))
      .then((data) => {
        if (!active) return;
        if (data) {
          setTarget(data);
          setState("ok");
        } else {
          setState("notfound");
        }
      })
      .catch(() => active && setState("notfound"));
    return () => {
      active = false;
    };
  }, [username, token]);

  const appLink = `cheqpay://pay?u=${encodeURIComponent(username)}&c=${encodeURIComponent(token)}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the number is on screen to copy by hand */
    }
  }

  return (
    <main className="min-h-screen bg-surface flex flex-col items-center px-4 py-10">
      <BrandLogo className="h-auto w-[140px]" priority />

      <div className="mt-8 w-full max-w-sm rounded-3xl bg-card p-6 shadow-sm">
        {state === "loading" ? (
          <p className="text-center text-muted py-10">Loading…</p>
        ) : state === "notfound" ? (
          <div className="text-center py-6">
            <h1 className="text-xl font-bold text-ink">Link not found</h1>
            <p className="mt-2 text-sm text-muted">
              This CheqPay pay link is invalid or has expired. Ask for a fresh one.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <p className="text-sm text-muted">Pay on CheqPay</p>
              <h1 className="mt-1 text-2xl font-extrabold text-ink">@{target?.username}</h1>
              {target?.displayName && <p className="mt-1 text-sm text-muted">{target.displayName}</p>}
            </div>

            <a
              href={appLink}
              className="mt-6 block w-full rounded-full bg-brand py-3.5 text-center font-bold text-white"
            >
              Open in CheqPay
            </a>
            <a
              href={APP_HOME}
              className="mt-3 block w-full rounded-full border border-border py-3.5 text-center font-semibold text-ink"
            >
              Don’t have CheqPay? Get the app
            </a>

            {target?.ngn && (
              <div className="mt-7 rounded-2xl border border-border p-4">
                <p className="text-xs font-semibold uppercase text-muted">
                  Or pay this Naira account from any bank
                </p>
                <div className="mt-2">
                  <p className="text-xs font-semibold uppercase text-muted">Bank</p>
                  <p className="text-base font-bold text-ink">{target.ngn.bankName}</p>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted">Account number</p>
                    <p className="text-2xl font-extrabold tracking-wide text-ink">{target.ngn.accountNumber}</p>
                  </div>
                  <button
                    onClick={() => copy(target.ngn!.accountNumber)}
                    className="rounded-full bg-surface px-3 py-2 text-sm font-bold text-ink"
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-8 max-w-sm text-center text-xs text-muted">
        CheqPay never asks for your PIN or password to receive money. Only send to people you know.
      </p>
    </main>
  );
}

export default function PayPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-surface" />}>
      <PayContent />
    </Suspense>
  );
}
