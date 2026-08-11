"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Bitcoin, Tag, CreditCard, LucideIcon } from "lucide-react";
import { useFeatures } from "@/lib/useFeatures";
import DesktopSidebar from "./DesktopSidebar";

/**
 * `outlineOnly` marks glyph-style icons that have no closed silhouette — the
 * Bitcoin ₿ is drawn as strokes, so filling it and knocking the detail out in
 * the bar colour erases the glyph. Those tabs take the brand tint alone.
 */
const ALL_TABS: {
  href: string;
  label: string;
  icon: LucideIcon;
  outlineOnly?: boolean;
}[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/crypto", label: "Crypto", icon: Bitcoin, outlineOnly: true },
  { href: "/pay-bill", label: "Pay Bill", icon: Tag },
  { href: "/cards", label: "Cards", icon: CreditCard },
];

/** Active when on the tab itself or any of its sub-pages. */
function isTabActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * The application shell. Phone-shaped with a floating bottom tab bar up to lg;
 * from lg the admin-style sidebar takes over as the navigation and the width
 * cap is lifted. Pages render inside `children` either way.
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
    <div className="min-h-screen w-full bg-black lg:bg-surface lg:pl-64">
      <DesktopSidebar />

      {/*
        One tree, two layouts.

        Below lg the app is a 480px column centred on black — the phone shape it
        was designed as, which is also what a tablet in portrait wants.

        From lg the black letterboxing and the width cap both go: the content
        sits beside the sidebar and is capped at a readable measure instead,
        because a balance card stretched across a 27" monitor is not a better
        experience, just a wider one.
      */}
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col overflow-hidden bg-surface lg:max-w-none lg:overflow-visible">
        <div className="flex-1 overflow-y-auto pb-28 lg:mx-auto lg:w-full lg:max-w-3xl lg:overflow-visible lg:px-6 lg:pb-12 lg:pt-4">
          {children}
        </div>

        {/* Floating glass tab bar — pinned to the viewport so it never scrolls.
            Hidden from lg, where the sidebar is the navigation. */}
        <nav className="fixed bottom-6 left-1/2 z-30 w-[calc(100%-2.75rem)] max-w-[430px] -translate-x-1/2 rounded-full border border-white/10 bg-card/70 px-1.5 py-1 shadow-2xl shadow-black/50 backdrop-blur-2xl lg:hidden">
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
                {/* Tinted with the ink token rather than white: white reads as
                    glass on the dark bar but disappears on the light one. */}
                <span className="absolute inset-0 rounded-full bg-ink/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] ring-1 ring-inset ring-ink/10" />
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
                    fill={active && !tab.outlineOnly ? "currentColor" : "none"}
                    stroke={
                      active && !tab.outlineOnly ? "rgb(var(--c-card))" : "currentColor"
                    }
                    strokeWidth={active && !tab.outlineOnly ? 1.75 : 1.9}
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
