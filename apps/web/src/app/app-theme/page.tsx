"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Moon, Sun, CheckCircle2 } from "lucide-react";
import { useUIStore } from "@/store";

const options = [
  {
    key: "dark" as const,
    title: "Dark",
    subtitle: "CheqPay classic — easy on the eyes",
    icon: Moon,
  },
  {
    key: "light" as const,
    title: "Light",
    subtitle: "Bright and clean for daytime",
    icon: Sun,
  },
];

export default function AppThemePage() {
  const router = useRouter();
  const { darkMode, setDarkMode } = useUIStore();
  const active = darkMode ? "dark" : "light";

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

        <h1 className="mt-6 text-4xl font-extrabold text-ink">App Theme</h1>
        <p className="mb-4 mt-2 text-sm text-muted">
          Control CheqPay app&apos;s look and feel.
        </p>

        <div className="space-y-3.5">
          {options.map((o) => {
            const Icon = o.icon;
            const selected = active === o.key;
            return (
              <button
                key={o.key}
                onClick={() => setDarkMode(o.key === "dark")}
                className={`flex w-full items-center gap-4 rounded-3xl bg-card p-4 text-left transition ${
                  selected ? "ring-[1.5px] ring-brand" : ""
                }`}
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-circle">
                  <Icon className="h-6 w-6 text-ink" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-ink">{o.title}</p>
                  <p className="mt-0.5 text-sm text-muted">{o.subtitle}</p>
                </div>
                {selected ? (
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-brand" />
                ) : (
                  <span className="h-6 w-6 shrink-0 rounded-full border-2 border-border" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
