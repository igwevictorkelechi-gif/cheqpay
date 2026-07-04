"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Bitcoin, Tag, LucideIcon } from "lucide-react";

const tabs: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/crypto", label: "Crypto", icon: Bitcoin },
  { href: "/pay-bill", label: "Pay Bill", icon: Tag },
];

/**
 * Phone-shaped shell with the dark CheqPay surface and a bottom
 * tab bar (Home / Crypto / Pay Bill). Pages render inside `children`.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col overflow-hidden bg-surface">
        <div className="flex-1 overflow-y-auto pb-28">{children}</div>

        {/* Floating glass tab bar — pinned to the viewport so it never scrolls */}
        <nav className="fixed bottom-5 left-1/2 z-30 flex w-[calc(100%-2.5rem)] max-w-[440px] -translate-x-1/2 items-center justify-around rounded-full border border-white/10 bg-card/60 px-2 py-3 shadow-2xl shadow-black/50 backdrop-blur-xl">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex flex-1 flex-col items-center gap-1 transition-colors"
                style={{ color: active ? "#F4F3F7" : "#6E6880" }}
              >
                <Icon
                  className="h-6 w-6"
                  fill={active && tab.label !== "Crypto" ? "currentColor" : "none"}
                />
                <span className="text-xs font-semibold">{tab.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
