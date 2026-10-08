"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import Logo from "@/components/Logo";
import { finishCheqPaySignIn, SignInError, startCheqPaySignIn } from "@/lib/cheqpaySignIn";

/** Back from mycheqpay.com: swap the one-time code for a session, then on to the dashboard (or the application). */
export default function CallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const q = new URLSearchParams(window.location.search);
    // The code is single use, but keep it out of history all the same.
    window.history.replaceState(null, "", "/auth/callback/");
    finishCheqPaySignIn(q.get("code"), q.get("state"))
      .then((next) => router.replace(next))
      .catch((e) => setError(e instanceof SignInError ? e.message : "We couldn't sign you in. Please try again."));
  }, [router]);

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col px-5">
      <header className="py-5"><Logo /></header>
      <main className="my-auto text-center">
        {error ? (
          <div className="appear">
            <h1 className="title">Sign-in didn&apos;t finish</h1>
            <p className="subhead mt-3">{error}</p>
            <button onClick={() => startCheqPaySignIn("/dashboard")} className="btn mt-8 w-full">Try again</button>
            <a href="/login/" className="btn-ghost mt-2 w-full">Other ways to sign in</a>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-brand" />
            <p className="subhead">Signing you in…</p>
          </div>
        )}
      </main>
    </div>
  );
}
