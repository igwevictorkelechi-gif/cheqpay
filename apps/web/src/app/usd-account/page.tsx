"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2 } from "lucide-react";
import { api, ApiError } from "@/services/api";
import UsdAccountPanel from "@/components/UsdAccountPanel";
import DesktopSidebar from "@/components/DesktopSidebar";

/**
 * The dollar account on its own page.
 *
 * "Verify my dollar account" used to land on the Naira deposit screen, where the
 * USD panel sat below an account number the user did not ask for. A USD account
 * needs identity verification first (it hangs off the provider customer record),
 * so this page checks that up front and sends an unverified user straight to
 * KYC — the step they actually have to complete — rather than showing them a
 * form that would fail.
 */
export default function UsdAccountPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api.ensureProvisioned();
        const kyc = await api.getKyc();
        if (!active) return;

        // Not verified yet → go do that first, then come back here.
        // providerEnrolled is optional on older deployments, so it only blocks
        // when it is explicitly false.
        const verified = kyc.kycTier >= 2;
        if (!verified || kyc.providerEnrolled === false) {
          router.replace("/kyc?next=/usd-account");
          return;
        }
        setChecking(false);
      } catch (e) {
        if (!active) return;
        if (e instanceof ApiError && e.status === 401) {
          setNeedsLogin(true);
          setChecking(false);
          return;
        }
        // Any other failure: let the panel itself report what went wrong rather
        // than blocking the page behind a spinner.
        setChecking(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen justify-center bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-10 pt-4 lg:max-w-3xl">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          aria-label="Go back"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-6 text-3xl font-extrabold text-ink">Dollar account</h1>
        <p className="mt-2 text-sm text-muted">
          Receive US dollars from anywhere. Your dollars sit in their own balance and can be
          converted to Naira or crypto at any time.
        </p>

        {checking ? (
          <div className="mt-10 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        ) : needsLogin ? (
          <p className="mt-10 text-center text-muted">Please sign in to open your dollar account.</p>
        ) : (
          // Opened by default: the user arrived here to do exactly this, so the
          // form should not be behind another tap.
          <UsdAccountPanel defaultOpen />
        )}
      </div>
    </div>
  );
}
