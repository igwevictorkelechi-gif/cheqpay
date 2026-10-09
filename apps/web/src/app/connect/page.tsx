"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { supabase } from "@/services/supabase";
import { api } from "@/services/api";
import { rememberReturnTo } from "@/lib/returnTo";

/**
 * "Continue with CheqPay": another CheqPay site (the Creators portal) sent the
 * user here to sign in with their CheqPay account.
 *
 * Signed out: sign in or create an account as usual; the app brings them back
 * here afterwards. Signed in: one tap on Continue mints a one-time code and
 * sends them back to that site's own, fixed callback — never to a URL taken
 * from the query string. The tap is deliberate: a hidden page must not be able
 * to sign someone in to another site without them seeing it.
 */

const CLIENTS: Record<string, { name: string; origin: string; cancel: string; blurb: string }> = {
  creators: {
    name: "CheqPay Creators",
    origin: "https://creator.mycheqpay.com",
    cancel: "https://creator.mycheqpay.com/login/",
    blurb: "Your creator dashboard, referral link and earnings.",
  },
};

interface Request {
  client: string;
  state: string;
  challenge: string;
}

function readRequest(): Request | null {
  try {
    const q = new URLSearchParams(window.location.search);
    const client = q.get("client") ?? "";
    const state = q.get("state") ?? "";
    const challenge = q.get("challenge") ?? "";
    if (!CLIENTS[client] || !/^[A-Za-z0-9_-]{16,128}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return null;
    return { client, state, challenge };
  } catch {
    return null;
  }
}

export default function ConnectPage() {
  const router = useRouter();
  const [request, setRequest] = useState<Request | null | undefined>(undefined);
  const [who, setWho] = useState<{ email: string; name: string } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRequest(readRequest());
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user;
      setWho(u ? { email: u.email ?? "", name: (u.user_metadata?.full_name as string | undefined) ?? "" } : null);
    });
  }, []);

  const here = () => `${window.location.pathname}${window.location.search}`;

  function goSignIn(to: "/login" | "/signup") {
    rememberReturnTo(here());
    router.push(to);
  }

  async function switchAccount() {
    await supabase.auth.signOut();
    goSignIn("/login");
  }

  async function proceed() {
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const { code, return_url } = await api.ssoHandoff(request.client, request.challenge);
      const target = new URL(return_url);
      // Belt and braces: only ever hand a code to the site it was made for.
      if (target.origin !== CLIENTS[request.client].origin) throw new Error("unexpected return address");
      target.searchParams.set("code", code);
      target.searchParams.set("state", request.state);
      setDone(true);
      window.location.replace(target.toString());
    } catch (e) {
      setError(e instanceof Error && e.message && !/fetch/i.test(e.message) ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  const client = request ? CLIENTS[request.client] : null;

  return (
    <AuthLayout>
      <div className="p-8">
        {request === undefined || who === undefined ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : !request || !client ? (
          <>
            <h2 className="text-2xl font-bold text-ink">This link doesn&apos;t work</h2>
            <p className="mt-2 text-sm text-muted">It may be incomplete or out of date. Go back to the site you came from and try again.</p>
            <a href="/" className="btn-primary mt-6 block w-full text-center">Go to CheqPay</a>
          </>
        ) : who === null ? (
          <>
            <ShieldCheck className="h-10 w-10 text-brand-light" />
            <h2 className="mt-4 text-2xl font-bold text-ink">Continue to {client.name}</h2>
            <p className="mt-2 text-sm text-muted">Sign in with your CheqPay account. New here? Create one in a minute, then you&apos;ll come straight back.</p>
            <button onClick={() => goSignIn("/login")} className="btn-primary mt-6 w-full">Sign in to CheqPay</button>
            <button onClick={() => goSignIn("/signup")} className="btn-secondary mt-3 w-full">Create a CheqPay account</button>
            <a href={client.cancel} className="mt-5 block text-center text-sm text-muted hover:text-ink">Cancel</a>
          </>
        ) : (
          <>
            <ShieldCheck className="h-10 w-10 text-brand-light" />
            <h2 className="mt-4 text-2xl font-bold text-ink">Continue to {client.name}?</h2>
            <p className="mt-2 text-sm text-muted">{client.blurb}</p>
            <div className="mt-6 rounded-2xl border border-border bg-surface/60 p-4">
              <p className="text-xs uppercase tracking-wider text-muted">Signing in as</p>
              {who.name && <p className="mt-1 font-semibold text-ink">{who.name}</p>}
              <p className="text-sm text-ink/80">{who.email}</p>
            </div>
            <ul className="mt-5 space-y-2 text-sm text-muted">
              <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand-light" /> {client.name} sees your name and email.</li>
              <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand-light" /> It can&apos;t see your balance or move your money.</li>
            </ul>
            {error && <div className="mt-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}
            <button onClick={proceed} disabled={busy || done} className="btn-primary mt-6 w-full">
              {busy || done ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : "Continue"}
            </button>
            <button onClick={switchAccount} disabled={busy} className="mt-4 block w-full text-center text-sm text-muted hover:text-ink">
              Not you? Use another account
            </button>
            <a href={client.cancel} className="mt-2 block text-center text-sm text-muted hover:text-ink">Cancel</a>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
