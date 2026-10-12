"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Activity, BookOpen, CreditCard, FlaskConical, Home, KeyRound, Loader2, LogOut, Rocket, Shield, Webhook } from "lucide-react";
import Logo from "./Logo";
import { StepUpProvider } from "./StepUp";
import { ApiError, dash, type Mode, type Overview } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

const NAV = [
  { href: "/dashboard/", label: "Overview", Icon: Home },
  { href: "/dashboard/keys/", label: "API keys", Icon: KeyRound },
  { href: "/dashboard/webhooks/", label: "Webhooks", Icon: Webhook },
  { href: "/dashboard/activity/", label: "Activity", Icon: Activity },
  { href: "/dashboard/sandbox/", label: "Sandbox tools", Icon: FlaskConical },
  { href: "/dashboard/go-live/", label: "Go live", Icon: Rocket },
  { href: "/dashboard/billing/", label: "Plan & billing", Icon: CreditCard },
  { href: "/dashboard/security/", label: "Security", Icon: Shield },
];

interface DashState {
  overview: Overview;
  reload: () => Promise<void>;
  mode: Mode;
  setMode: (m: Mode) => void;
}

const Ctx = createContext<DashState | null>(null);

export function useDash(): DashState & { account: NonNullable<Overview["account"]> } {
  const v = useContext(Ctx);
  if (!v || !v.overview.account) throw new Error("useDash outside an opened account");
  return { ...v, account: v.overview.account };
}

const MODE_KEY = "cheqpay-dev-mode";

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "live" ? "live" : "test";
  } catch {
    return "test";
  }
}

/** The signed-in dashboard. Signed-out people go to sign in; people without an account open one. */
export default function DashShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const path = usePathname();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setModeState] = useState<Mode>("test");

  const reload = useCallback(async () => {
    try {
      setOverview(await dash.overview());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.code === "feature_disabled" ? "The developer platform opens soon." : err instanceof Error ? err.message : "Couldn't load your account.");
    }
  }, []);

  useEffect(() => {
    setModeState(readMode());
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) {
      router.replace(`/login/?next=${encodeURIComponent(path)}`);
      return;
    }
    void reload();
  }, [session, path, router, reload]);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* private mode: the switch just won't be remembered */
    }
  };

  if (error) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo />
        <p className="subhead max-w-sm">{error}</p>
        <button onClick={() => void reload()} className="btn-tinted">Try again</button>
      </div>
    );
  }
  if (!overview) {
    return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  return (
    <StepUpProvider>
      <Ctx.Provider value={{ overview, reload, mode, setMode }}>
        <div className="min-h-[100dvh]">
          <header className="sticky top-0 z-20 border-b border-border/50 bg-surface/80 backdrop-blur-xl">
            <div className="flex h-14 items-center justify-between gap-3 px-5">
              <Logo href="/dashboard/" />
              <div className="flex items-center gap-2">
                {overview.account && <ModeSwitch mode={mode} setMode={setMode} />}
                <Link href="/docs/" className="hidden h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-circle sm:flex" aria-label="Docs"><BookOpen className="h-5 w-5" /></Link>
                <button onClick={signOut} className="flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-circle hover:text-ink" aria-label="Sign out">
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            </div>
            {overview.account && (
              <nav className="flex gap-1 overflow-x-auto px-4 pb-2 lg:hidden">
                {NAV.map((n) => (
                  <Link key={n.href} href={n.href} className={`chip !min-h-[34px] text-[14px] ${path === n.href ? "chip-on" : ""}`}>{n.label}</Link>
                ))}
              </nav>
            )}
          </header>
          {!overview.account ? (
            <OpenAccount email={overview.owner.email} onOpened={reload} />
          ) : (
            <div className="flex">
              <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 border-r border-border/50 p-4 lg:block">
                <nav className="space-y-0.5">
                  {NAV.map(({ href, label, Icon }) => (
                    <Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] font-medium transition ${path === href ? "bg-brand/12 text-brand-light" : "text-ink/80 hover:bg-circle"}`}>
                      <Icon className="h-[18px] w-[18px]" /> {label}
                    </Link>
                  ))}
                </nav>
                <p className="footnote mt-6 px-3">{overview.account.business_name}</p>
              </aside>
              <main className="appear min-w-0 flex-1 px-5 py-6 lg:px-10">
                {mode === "live" && overview.account.frozen && (
                  <p className="notice-bad mb-5">Money movement is paused on this account{overview.account.frozen_reason ? `: ${overview.account.frozen_reason}` : ""}. Reads still work.</p>
                )}
                {children}
              </main>
            </div>
          )}
        </div>
      </Ctx.Provider>
    </StepUpProvider>
  );
}

function ModeSwitch({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
    <div className="flex rounded-full bg-circle p-1 text-[13px] font-semibold" role="group" aria-label="Mode">
      {(["test", "live"] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          aria-pressed={mode === m}
          className={`rounded-full px-3 py-1 transition ${mode === m ? (m === "live" ? "bg-good text-white" : "bg-warn text-white") : "text-muted"}`}
        >
          {m === "test" ? "Test" : "Live"}
        </button>
      ))}
    </div>
  );
}

function OpenAccount({ email, onOpened }: { email: string | null; onOpened: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="appear mx-auto max-w-md px-5 py-16">
      <h1 className="title-lg">Open your developer account</h1>
      <p className="subhead mt-2">
        Signed in as <span className="font-semibold text-ink">{email}</span>. You&apos;ll start in the sandbox with test keys and simulated money; going live comes later.
      </p>
      <form
        className="mt-8"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await dash.openAccount(name.trim());
            await onOpened();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Couldn't open the account.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="label" htmlFor="biz">Business name</label>
        <input id="biz" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Ltd" maxLength={120} />
        {error && <p className="notice-bad mt-3">{error}</p>}
        <button disabled={busy || name.trim().length < 2} className="btn mt-5 w-full">{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Open sandbox account"}</button>
      </form>
    </main>
  );
}
