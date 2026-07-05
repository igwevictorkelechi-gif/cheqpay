"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

const iconOptions = [
  { key: "default", label: "Default", bg: "#6B5B95", fg: "#FFFFFF" },
  { key: "midnight", label: "Midnight", bg: "#14121A", fg: "#8A7BB5" },
  { key: "mint", label: "Mint", bg: "#34C759", fg: "#0B2A16" },
  { key: "gold", label: "Gold", bg: "#F5A623", fg: "#3A2600" },
];

export default function AppIconPage() {
  const router = useRouter();
  const [selected, setSelected] = useState("default");

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-8 pt-3">
        <button
          onClick={() => router.back()}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="mt-6 text-4xl font-extrabold text-ink">App Icon</h1>
        <p className="mb-5 mt-2 text-sm text-muted">
          Change the CheqPay app icon to match your style.
        </p>

        <div className="grid grid-cols-2 gap-4">
          {iconOptions.map((o) => {
            const isSel = selected === o.key;
            return (
              <button
                key={o.key}
                onClick={() => setSelected(o.key)}
                className={`flex flex-col items-center rounded-3xl bg-card p-4 transition ${
                  isSel ? "ring-[1.5px] ring-brand" : ""
                }`}
              >
                <span
                  className="flex h-20 w-20 items-center justify-center rounded-3xl text-3xl font-extrabold"
                  style={{ backgroundColor: o.bg, color: o.fg }}
                >
                  C
                </span>
                <span className="mt-3 flex items-center gap-1.5">
                  <span className="text-base font-semibold text-ink">{o.label}</span>
                  {isSel && <CheckCircle2 className="h-4 w-4 text-brand" />}
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          Your selection is applied across the app.
        </p>
      </div>
    </div>
  );
}
