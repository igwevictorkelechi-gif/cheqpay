"use client";

import InfoPage from "@/components/InfoPage";
import { priceSheet, useFees } from "@/lib/fees";

/**
 * Every fee, read live from the same settings the server charges with — so
 * this page is never out of date with what a user actually pays.
 */
export default function PricingPage() {
  const fees = useFees();
  return (
    <InfoPage
      title="Pricing"
      subtitle="Every fee we charge, in one place. You also see the exact fee before you confirm anything."
    >
      {fees === null ? (
        <p className="text-sm text-muted">Loading current fees…</p>
      ) : (
        <div className="space-y-6">
          {priceSheet(fees).map((section) => (
            <section key={section.title}>
              <h2 className="mb-2 text-base font-bold text-ink">{section.title}</h2>
              <div className="divide-y divide-border rounded-2xl bg-card">
                {section.rows.map((r) => (
                  <div key={r.what} className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{r.what}</p>
                      {r.note ? <p className="mt-0.5 text-xs text-muted">{r.note}</p> : null}
                    </div>
                    <p className="shrink-0 text-right font-semibold text-ink">{r.price}</p>
                  </div>
                ))}
              </div>
            </section>
          ))}
          <p className="text-xs text-muted">
            Fees can change. When they do, this page and every confirmation screen update at the
            same time, and a change never applies to a transaction you have already confirmed.
          </p>
        </div>
      )}
    </InfoPage>
  );
}
