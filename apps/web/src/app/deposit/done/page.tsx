"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronRight } from "lucide-react";

export default function DepositDonePage() {
  const router = useRouter();

  return (
    <div className="flex min-h-screen justify-center bg-black">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-surface px-5 pb-6 pt-3">
        {/* Success */}
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div
            className="flex h-28 w-28 items-center justify-center rounded-full"
            style={{ backgroundColor: "rgba(52,199,89,0.15)" }}
          >
            <span
              className="flex h-20 w-20 items-center justify-center rounded-full"
              style={{ backgroundColor: "#34C759" }}
            >
              <Check className="h-11 w-11 text-white" strokeWidth={3} />
            </span>
          </div>
          <h1 className="mt-7 text-3xl font-extrabold text-ink">All done</h1>
          <p className="mt-3 max-w-xs text-base text-muted">
            The funds from your transfer will be deposited into your account
            shortly
          </p>
        </div>

        {/* Recommended */}
        <button
          onClick={() => router.push("/")}
          className="flex w-full items-center gap-4 rounded-3xl bg-card p-5 text-left"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-circle text-2xl">
            📈
          </span>
          <div className="flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Recommended
            </p>
            <p className="mt-1 text-lg font-bold text-ink">
              Earn up to 20% interest p.a.
            </p>
            <p className="mt-0.5 text-sm text-muted">
              Create a NGN or USD savings plan and watch your money grow
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted" />
        </button>

        {/* CTA */}
        <div className="mt-4">
          <button
            onClick={() => router.push("/")}
            className="w-full rounded-full py-4 text-base font-bold text-white"
            style={{ backgroundColor: "#6B5B95" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
