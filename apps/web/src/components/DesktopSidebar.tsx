"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home,
  Bitcoin,
  Tag,
  CreditCard,
  Users,
  ArrowDownToLine,
  ArrowUpFromLine,
  Receipt,
  Settings,
  ShieldCheck,
  LifeBuoy,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useFeatures } from "@/lib/useFeatures";
import BrandLogo from "./BrandLogo";
import { authService } from "@/services/auth";
import { useAuthStore } from "@/store";
import type { FeatureFlags } from "@/services/api";

/**
 * Desktop navigation, shown only at lg and above.
 *
 * This is the admin dashboard's sidebar pattern — fixed 16rem rail, grouped
 * sections, a tinted pill on the active row, account block pinned to the
 * bottom — rebuilt on the consumer app's theme tokens rather than admin's
 * hardcoded grays, so it follows the user's light/dark choice.
 *
 * Phones and tablets never see this; they keep the floating bottom tab bar in
 * AppShell, which is a better fit for a thumb and is what the app is designed
 * around. The two navigations coexist rather than one replacing the other.
 */

type Item = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hidden when this feature flag is off. Always shown when absent. */
  flag?: keyof FeatureFlags;
};

type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
  {
    label: "Money",
    items: [
      { label: "Home", href: "/", icon: Home },
      { label: "Add money", href: "/deposit", icon: ArrowDownToLine, flag: "ngn_deposits" },
      { label: "Withdraw", href: "/withdraw", icon: ArrowUpFromLine, flag: "ngn_withdrawals" },
      { label: "Send to a user", href: "/send-user", icon: Users, flag: "p2p_transfers" },
    ],
  },
  {
    label: "Services",
    items: [
      { label: "Crypto", href: "/crypto", icon: Bitcoin, flag: "crypto_trading" },
      { label: "Pay a bill", href: "/pay-bill", icon: Tag, flag: "bill_payments" },
      { label: "Cards", href: "/cards", icon: CreditCard, flag: "virtual_cards" },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Transactions", href: "/transactions", icon: Receipt },
      { label: "Security", href: "/security", icon: ShieldCheck },
      { label: "Settings", href: "/settings", icon: Settings },
      { label: "Support", href: "/support", icon: LifeBuoy },
    ],
  },
];

/** Active on the route itself or any page beneath it. "/" matches only itself. */
function isActive(href: string, pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (href === "/") return path === "/";
  return path === href || path.startsWith(href + "/");
}

export default function DesktopSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const features = useFeatures();
  const { user, logout } = useAuthStore();

  const signOut = async () => {
    try {
      await authService.logout();
    } finally {
      logout();
      router.replace("/login");
    }
  };

  const label = user?.email ?? "Your account";

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col border-r border-border bg-card lg:flex">
      <div className="shrink-0 border-b border-border px-6 py-5">
        <Link href="/" aria-label="CheqPay home">
          <BrandLogo priority className="h-auto w-[150px]" />
        </Link>
      </div>

      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        {GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.flag || features[i.flag]);
          // A group whose every item is behind a switched-off feature would
          // otherwise render as a heading with nothing under it.
          if (items.length === 0) return null;

          return (
            <div key={group.label}>
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={"min-h-[44px] flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors " +
                        (active
                          ? "bg-brand/15 text-brand-light"
                          : "text-ink/80 hover:bg-circle hover:text-ink")
                      }
                    >
                      <Icon size={18} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-center gap-2">
          <Link
            href="/profile"
            className="min-h-[44px] flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-circle"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/20 font-bold text-brand-light">
              {label.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{label}</span>
              <span className="block text-xs text-muted">View profile</span>
            </span>
          </Link>
          <button
            onClick={signOut}
            aria-label="Sign out"
            className="rounded-xl p-2.5 text-danger transition-colors hover:bg-danger/10"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </aside>
  );
}
