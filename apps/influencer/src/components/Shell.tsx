"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Link2, ListChecks, Loader2, LogOut, Wallet } from "lucide-react";
import Logo from "./Logo";
import { api, APP_URL } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useSession } from "@/lib/useSession";

const NAV = [
  { href: "/dashboard", label: "Dashboard", Icon: BarChart3 },
  { href: "/link", label: "My link", Icon: Link2 },
  { href: "/tasks", label: "Tasks", Icon: ListChecks },
  { href: "/earnings", label: "Earnings", Icon: Wallet },
];

/**
 * The signed-in influencer area. Sends anyone signed out to sign in, and anyone
 * not (yet) approved to the application page.
 */
export default function Shell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const path = usePathname();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (session === undefined) return;
    if (session === null) {
      router.replace(`/login?next=${encodeURIComponent(path)}`);
      return;
    }
    api
      .application()
      .then((a) => (a.isInfluencer ? setOk(true) : router.replace("/apply")))
      .catch(() => router.replace("/apply"));
  }, [session, path, router]);

  if (!ok) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-28 md:pb-10">
      <header className="flex items-center justify-between py-5">
        <Logo href="/dashboard" />
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map(({ href, label }) => (
            <Link key={href} href={href} className={`rounded-full px-4 py-2 text-sm font-semibold ${path === href ? "bg-card text-ink" : "text-muted hover:text-ink"}`}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a href={APP_URL} className="hidden rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted hover:text-ink sm:block">Open CheqPay</a>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/");
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted hover:text-ink"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      {children}
      <nav className="fixed inset-x-3 bottom-3 z-20 grid grid-cols-4 rounded-3xl border border-border bg-card/95 p-1.5 backdrop-blur md:hidden">
        {NAV.map(({ href, label, Icon }) => (
          <Link key={href} href={href} className={`flex flex-col items-center gap-1 rounded-2xl py-2 text-[11px] font-semibold ${path === href ? "bg-circle text-ink" : "text-muted"}`}>
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
