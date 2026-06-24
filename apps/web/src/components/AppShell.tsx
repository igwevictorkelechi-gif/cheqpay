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
 * Phone-shaped shell with the dark Cheqpay surface and a bottom
 * tab bar (Home / Crypto / Pay Bill). Pages render inside `children`.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface">
        <div className="flex-1 overflow-y-auto pb-24">{children}</div>

        {/* Bottom tab bar */}
        <nav className="sticky bottom-0 left-0 right-0 flex items-center justify-around border-t border-border bg-card px-2 pb-4 pt-3">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex flex-1 flex-col items-center gap-1"
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
