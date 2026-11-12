"use client";

/**
 * Confirming a payment the WhatsApp bot composed.
 *
 * The bot can propose; only this page can spend. It fetches the payment from
 * the server — which checks the link really belongs to the signed-in user and
 * reserves their daily WhatsApp cap — shows it in full, and then calls the SAME
 * money route the app calls, with the PIN typed into the existing dialog.
 * There is no second money path.
 *
 * The code is a query param rather than a path segment because this app is a
 * static export: an unbounded /approve/[code] cannot be enumerated at build
 * time, so it would 404. /connect and /pay read their inputs the same way.
 *
 * Signed-out visitors are expected — the link arrives on whatever device has
 * WhatsApp. This route is public in AuthGuard and handles sign-in itself, so
 * the ?code= survives the trip to /login and back.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";
import { api, ApiError } from "@/services/api";
import { supabase } from "@/services/supabase";
import { rememberReturnTo } from "@/lib/returnTo";
import { invalidateMoneyCaches } from "@/lib/cache";

type Approval = Awaited<ReturnType<typeof api.getWhatsappApproval>>;

/** A 43-character base64url code, as lib/whatsapp/actions.ts mints them. */
const CODE = /^[A-Za-z0-9_-]{43}$/;

function readCode(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get("code") ?? "";
    return CODE.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export default function ApprovePage() {
  const router = useRouter();
  const { authorize } = useTransactionPin();

  // Tri-state everywhere: undefined means "not resolved yet", so the first
  // paint is a spinner rather than a wrong answer.
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [approval, setApproval] = useState<Approval | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    setCode(readCode());
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
  }, []);

  const load = useCallback(async (c: string) => {
    try {
      setApproval(await api.getWhatsappApproval(c));
    } catch (e) {
      setApproval(null);
      setError(e instanceof ApiError ? e.message : "This payment link didn't work.");
    }
  }, []);

  useEffect(() => {
    if (code && signedIn) void load(code);
  }, [code, signedIn, load]);

  function goSignIn() {
    rememberReturnTo(`${window.location.pathname}${window.location.search}`);
    router.push("/login");
  }

  async function pay() {
    if (!approval || !code) return;
    setError(null);
    setPaying(true);
    try {
      const r = approval.request;
      // The idempotency key comes from the server, derived from the link code:
      // a refresh or a double tap replays the first result instead of paying
      // twice, which is what makes closing the link out non-critical.
      const key = approval.idempotencyKey;
      await authorize(
        (pin) => {
          switch (approval.kind) {
            case "transfer":
              return api.sendToUser({ username: r.username, asset: r.asset, amount: r.amount }, pin, key);
            case "withdraw":
              return api.createNgnWithdrawal(
                { amount: r.amount, bankCode: r.bankCode, accountNumber: r.accountNumber },
                pin,
                key,
              );
            default:
              return api.payBill(
                {
                  service: r.service,
                  billerId: r.billerId,
                  customer: r.customer,
                  ...(r.planId ? { planId: r.planId } : { amount: r.amount }),
                },
                pin,
                key,
              );
          }
        },
        { title: "Confirm this payment", detail: `${approval.amountFormatted} — ${approval.title}.` },
      );
      invalidateMoneyCaches();
      void api.closeWhatsappApproval(code).catch(() => undefined);
      setDone(approval.amountFormatted);
    } catch (e) {
      // Dismissing the PIN prompt is a deliberate "not now", not a failure.
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setError(e instanceof ApiError ? e.message : "Couldn't complete that payment. Please try again.");
    } finally {
      setPaying(false);
    }
  }

  const spinner = (
    <div className="flex justify-center py-10">
      <Loader2 className="h-6 w-6 animate-spin text-muted" />
    </div>
  );

  function body() {
    if (code === undefined || signedIn === undefined) return spinner;

    if (code === null) {
      return (
        <>
          <h1 className="text-xl font-extrabold text-ink">This link doesn&apos;t work</h1>
          <p className="mt-2 text-sm text-muted">
            Ask again on WhatsApp and we&apos;ll send a fresh one. Payment links last 15 minutes.
          </p>
        </>
      );
    }

    if (!signedIn) {
      return (
        <>
          <h1 className="text-xl font-extrabold text-ink">Sign in to confirm</h1>
          <p className="mt-2 text-sm text-muted">
            You started this payment on WhatsApp. Sign in to review it and approve it with your PIN.
          </p>
          <button onClick={goSignIn} className="btn-primary mt-6 w-full">
            Sign in
          </button>
        </>
      );
    }

    if (done) {
      return (
        <>
          <h1 className="text-xl font-extrabold text-ink">Sent</h1>
          <p className="mt-2 text-sm text-muted">{done} is on its way. You can close this page.</p>
          <button onClick={() => router.replace("/")} className="btn-secondary mt-6 w-full">
            Go to CheqPay
          </button>
        </>
      );
    }

    if (approval === undefined) return spinner;

    if (approval === null) {
      return (
        <>
          <h1 className="text-xl font-extrabold text-ink">This payment link has expired</h1>
          <p className="mt-2 text-sm text-muted">{error ?? "Ask again on WhatsApp for a fresh one."}</p>
        </>
      );
    }

    return (
      <>
        <h1 className="text-xl font-extrabold text-ink">Confirm this payment</h1>
        <p className="mt-1 text-sm text-muted">You started this on WhatsApp.</p>

        <div className="mt-6 text-center">
          <div className="tnum text-[34px] font-extrabold leading-none tracking-[-0.7px] text-ink">
            {approval.amountFormatted}
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-card p-4">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted">To</span>
            <span className="text-sm font-semibold text-ink">{approval.title}</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-muted">Details</span>
            <span className="text-sm font-semibold text-ink">{approval.subtitle}</span>
          </div>
        </div>

        {/* The last place a misparse can be caught, so it states what WILL
            happen rather than echoing what the user typed into WhatsApp. */}
        <p className="mt-3 flex items-start gap-2 text-xs text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          Check this is right before confirming. A payment can&apos;t always be recovered once sent.
        </p>

        {error && <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

        <button onClick={pay} disabled={paying} className="btn-primary mt-6 w-full disabled:opacity-50">
          {paying ? "Confirming…" : `Pay ${approval.amountFormatted}`}
        </button>
        <button onClick={() => router.replace("/")} className="btn-ghost mt-2 w-full">
          Cancel
        </button>
      </>
    );
  }

  return (
    <AuthLayout>
      <div className="p-8">{body()}</div>
    </AuthLayout>
  );
}
