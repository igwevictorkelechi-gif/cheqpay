"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Bitcoin, Tag, LucideIcon } from "lucide-react";
import { useFeatures } from "@/lib/useFeatures";

const ALL_TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/crypto", label: "Crypto", icon: Bitcoin },
  { href: "/pay-bill", label: "Pay Bill", icon: Tag },
];

/** Active when on the tab itself or any of its sub-pages. */
function isTabActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Phone-shaped shell with the dark CheqPay surface and a bottom
 * tab bar (Home / Crypto / Pay Bill). Pages render inside `children`.
 *
 * The active tab sits on a "liquid glass" capsule: a translucent, blurred
 * pill with a specular top highlight and a soft brand glow that slides
 * between tabs with a springy ease.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const features = useFeatures();

  // Tabs for switched-off features disappear entirely (server enforces too).
  const cryptoVisible =
    features.crypto_trading || features.crypto_deposits || features.crypto_withdrawals;
  const tabs = ALL_TABS.filter((t) => {
    if (t.href === "/crypto") return cryptoVisible;
    if (t.href === "/pay-bill") return features.bill_payments;
    return true;
  });
  const activeIndex = tabs.findIndex((t) => isTabActive(t.href, pathname));

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col overflow-hidden bg-surface">
        <div className="flex-1 overflow-y-auto pb-28">{children}</div>

        {/* Floating glass tab bar — pinned to the viewport so it never scrolls */}
        <nav className="fixed bottom-5 left-1/2 z-30 w-[calc(100%-2.5rem)] max-w-[440px] -translate-x-1/2 rounded-full border border-border/70 bg-card/60 px-2 py-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <div className="relative flex items-center">
            {/* Liquid-glass capsule behind the active tab */}
            {activeIndex >= 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 p-0.5"
                style={{
                  width: `${100 / tabs.length}%`,
                  transform: `translateX(${activeIndex * 100}%)`,
                  transition: "transform 0.45s cubic-bezier(0.34, 1.4, 0.64, 1)",
                }}
              >
                <span className="absolute inset-0 rounded-full bg-gradient-to-b from-white/[0.16] via-white/[0.06] to-brand/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-6px_12px_rgba(107,91,149,0.35),0_6px_20px_rgba(107,91,149,0.35)] ring-1 ring-inset ring-white/20 backdrop-blur-md" />
                {/* Specular top sheen */}
                <span className="absolute inset-x-6 top-1 h-2.5 rounded-full bg-white/25 blur-[6px]" />
              </span>
            )}

            {tabs.map((tab) => {
              const active = isTabActive(tab.href, pathname);
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative z-10 flex flex-1 flex-col items-center gap-0.5 py-2 transition-colors duration-300 ${
                    active ? "text-ink" : "text-muted"
                  }`}
                >
                  <Icon
                    className={`h-6 w-6 transition-transform duration-300 ${
                      active ? "scale-110 drop-shadow-[0_0_8px_rgba(138,123,181,0.6)]" : ""
                    }`}
                    fill={active && tab.label !== "Crypto" ? "currentColor" : "none"}
                  />
                  <span className="text-xs font-semibold">{tab.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
