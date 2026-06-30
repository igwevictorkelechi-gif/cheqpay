"use client";

import { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

/**
 * Shared shell for static/informational pages (About, Legal, Privacy, etc.):
 * dark CheqPay surface, a back button, a title, an optional subtitle, and a
 * scrollable content area.
 */
export default function InfoPage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen w-full justify-center bg-black">
      <div className="relative min-h-screen w-full max-w-[480px] bg-surface px-5 pb-16 pt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-card text-ink active:scale-95"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold text-ink">{title}</h1>
        </div>
        {subtitle && <p className="mt-4 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/** A titled prose section used inside InfoPage. */
export function Section({ heading, children }: { heading?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      {heading && <h2 className="mb-2 text-base font-bold text-ink">{heading}</h2>}
      <div className="space-y-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

/** A tappable row that links to another info page. */
export function LinkRow({
  emoji,
  title,
  subtitle,
  onClick,
}: {
  emoji: string;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left active:scale-[0.99]"
    >
      <span className="text-2xl">{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink">{title}</p>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      <ChevronLeft className="h-5 w-5 rotate-180 shrink-0 text-muted" />
    </button>
  );
}
