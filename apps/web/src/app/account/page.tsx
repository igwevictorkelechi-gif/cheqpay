"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  User,
  TrendingUp,
  FileText,
  Trash2,
  ChevronRight,
  LucideIcon,
} from "lucide-react";

type Row = {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  href: string;
  danger?: boolean;
};

const rows: Row[] = [
  {
    icon: User,
    iconColor: "#4FA8FF",
    iconBg: "rgba(79,168,255,0.15)",
    title: "Personal details",
    subtitle: "Review and update your personal info",
    href: "/personal-details",
  },
  {
    icon: TrendingUp,
    iconColor: "#F5A623",
    iconBg: "rgba(245,166,35,0.15)",
    title: "Account limits",
    subtitle: "Know your spending limits",
    href: "/account-limits",
  },
  {
    icon: FileText,
    iconColor: "#34C759",
    iconBg: "rgba(52,199,89,0.15)",
    title: "Wallet statement",
    subtitle: "Your financial history readily available",
    href: "/wallet-statement",
  },
  {
    icon: Trash2,
    iconColor: "#EF4444",
    iconBg: "rgba(239,68,68,0.15)",
    title: "Permanently delete your account",
    subtitle: "We’re sorry to see you go",
    href: "/delete-account",
    danger: true,
  },
];

export default function AccountPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-8 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="mb-2 mt-6 text-4xl font-extrabold text-ink">Account information</h1>

        <div className="mt-4 space-y-4">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <button
                key={row.title}
                onClick={() => router.push(row.href)}
                className="flex w-full items-center gap-4 rounded-3xl bg-card p-4 text-left active:scale-[0.99]"
              >
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: row.iconBg }}
                >
                  <Icon className="h-6 w-6" style={{ color: row.iconColor }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-lg font-bold"
                    style={{ color: row.danger ? "#EF4444" : undefined }}
                  >
                    {row.title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{row.subtitle}</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
