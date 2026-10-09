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
    return <div className="flex min-h-[100dvh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>;
  }

  return (
    <div className="min-h-[100dvh] pb-28 md:pb-12">
      <header className="sticky top-0 z-20 border-b border-border/50 bg-surface/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <Logo href="/dashboard" />
          <nav className="hidden items-center gap-1 rounded-full bg-circle p-1 md:flex">
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href} className={`rounded-full px-4 py-1.5 text-[15px] font-medium transition ${path === href ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink"}`}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <a href={APP_URL} className="btn-ghost hidden !h-9 !px-4 text-[15px] sm:inline-flex">Open CheqPay</a>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                router.replace("/");
              }}
              className="flex h-11 w-11 items-center justify-center rounded-full text-muted transition hover:bg-circle hover:text-ink"
              aria-label="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      <main className="appear mx-auto max-w-5xl px-5 pt-6">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-border/60 bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        {NAV.map(({ href, label, Icon }) => (
          <Link key={href} href={href} aria-current={path === href ? "page" : undefined} className={`flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[10px] font-medium transition ${path === href ? "text-brand-light" : "text-muted"}`}>
            <Icon className="h-6 w-6" strokeWidth={path === href ? 2.4 : 1.8} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
