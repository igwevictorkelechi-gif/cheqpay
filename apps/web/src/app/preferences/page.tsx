"use client";

import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Palette,
  Banknote,
  LayoutGrid,
  ChevronRight,
  LucideIcon,
} from "lucide-react";

type Row = {
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  href?: string;
};

const rows: Row[] = [
  {
    icon: Bell,
    iconColor: "#F5A623",
    iconBg: "rgba(245,166,35,0.15)",
    title: "Notifications",
    subtitle: "Customize your notification experience",
    href: "/notifications",
  },
  {
    icon: Palette,
    iconColor: "#4FA8FF",
    iconBg: "rgba(79,168,255,0.15)",
    title: "App Theme",
    subtitle: "Control CheqPay app's look and feel",
    href: "/app-theme",
  },
  {
    icon: Banknote,
    iconColor: "#34C759",
    iconBg: "rgba(52,199,89,0.15)",
    title: "Display Currency",
    subtitle: "Nigerian Naira",
  },
  {
    icon: LayoutGrid,
    iconColor: "#8A7BB5",
    iconBg: "rgba(138,123,181,0.2)",
    title: "App Icon",
    subtitle: "Change CheqPay app icon to your style",
    href: "/app-icon",
  },
];

export default function PreferencesPage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-8 pt-3">
        {/* Back */}
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="mb-2 mt-6 text-4xl font-extrabold text-ink">Preferences</h1>

        <div className="mt-4 space-y-4">
          {rows.map((row) => {
            const Icon = row.icon;
            const content = (
              <>
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: row.iconBg }}
                >
                  <Icon className="h-6 w-6" style={{ color: row.iconColor }} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-ink">{row.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{row.subtitle}</p>
                </div>
                {row.href && (
                  <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
                )}
              </>
            );

            return row.href ? (
              <button
                key={row.title}
                onClick={() => router.push(row.href!)}
                className="flex w-full items-center gap-4 rounded-3xl bg-card p-4 text-left active:scale-[0.99]"
              >
                {content}
              </button>
            ) : (
              <div
                key={row.title}
                className="flex w-full items-center gap-4 rounded-3xl bg-card p-4 text-left"
              >
                {content}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
