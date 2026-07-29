"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Bitcoin, Tag, CreditCard, LucideIcon } from "lucide-react";
import { useFeatures } from "@/lib/useFeatures";

const ALL_TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/crypto", label: "Crypto", icon: Bitcoin },
  { href: "/pay-bill", label: "Pay Bill", icon: Tag },
  { href: "/cards", label: "Cards", icon: CreditCard },
];

/** Active when on the tab itself or any of its sub-pages. */
function isTabActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Phone-shaped shell with the dark CheqPay surface and a floating bottom
 * tab bar. Pages render inside `children`.
 *
 * The bar follows the iOS-26 "liquid glass" pattern: a translucent blurred
 * pill inset from the screen edges, with a lighter glass capsule that slides
 * behind the active tab. The active icon switches to a solid brand-tinted
 * silhouette (interior detail knocked out in the bar colour) and its label
 * picks up the brand tint — the same active/inactive contrast the reference
 * apps use. The slide is deliberately quick (~0.22s, no overshoot).
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
    if (t.href === "/cards") return features.virtual_cards;
    return true;
  });
  const activeIndex = tabs.findIndex((t) => isTabActive(t.href, pathname));

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col overflow-hidden bg-surface">
        <div className="flex-1 overflow-y-auto pb-28">{children}</div>

        {/* Floating glass tab bar — pinned to the viewport so it never scrolls */}
        <nav className="fixed bottom-6 left-1/2 z-30 w-[calc(100%-2.75rem)] max-w-[430px] -translate-x-1/2 rounded-full border border-white/10 bg-card/70 px-1.5 py-1 shadow-2xl shadow-black/50 backdrop-blur-2xl">
          <div className="relative flex items-center">
            {/* Liquid-glass capsule behind the active tab */}
            {activeIndex >= 0 && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0"
                style={{
                  width: `${100 / tabs.length}%`,
                  transform: `translateX(${activeIndex * 100}%)`,
                  transition: "transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)",
                }}
              >
                <span className="absolute inset-0 rounded-full bg-white/[0.09] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] ring-1 ring-inset ring-white/10" />
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
                  className="relative z-10 flex flex-1 flex-col items-center gap-1 py-2"
                >
                  {/* Active icons render as a solid brand silhouette with their
                      interior detail knocked out in the bar colour — the filled
                      counterpart of the outline shown when inactive. */}
                  <Icon
                    className={`h-[22px] w-[22px] transition-[transform,color] duration-200 ${
                      active ? "scale-105 text-brand-light" : "text-muted"
                    }`}
                    fill={active ? "currentColor" : "none"}
                    stroke={active ? "rgb(var(--c-card))" : "currentColor"}
                    strokeWidth={active ? 1.75 : 1.9}
                  />
                  <span
                    className={`text-[11px] leading-none transition-colors duration-200 ${
                      active ? "font-bold text-brand-light" : "font-medium text-ink/70"
                    }`}
                  >
                    {tab.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
