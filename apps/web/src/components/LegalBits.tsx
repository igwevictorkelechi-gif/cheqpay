"use client";

import Link from "next/link";
import { COMPANY, operatorName } from "@/lib/legal";

/** Who "we" are, with the registration details once they are filled in. */
export function OperatorLine() {
  return (
    <p>
      In these documents, &quot;CheqPay&quot;, &quot;we&quot;, &quot;us&quot; and &quot;our&quot; mean{" "}
      {operatorName()}
      {COMPANY.registeredAddress ? `, whose registered office is at ${COMPANY.registeredAddress}` : ""}. You can
      reach us at <Mail to={COMPANY.supportEmail} />.
    </p>
  );
}

export function Mail({ to }: { to: string }) {
  return (
    <a href={`mailto:${to}`} className="font-semibold text-brand-light hover:underline">
      {to}
    </a>
  );
}

export function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-semibold text-brand-light hover:underline">
      {children}
    </Link>
  );
}

/** A compact two-or-more column table that stays readable at phone width. */
export function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[420px] text-left text-xs">
        <thead className="bg-card text-ink">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
