"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import InfoPage from "@/components/InfoPage";
import { FAQS } from "@/lib/faqs";


function Item({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      className="w-full rounded-2xl bg-card p-4 text-left active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold text-ink">{q}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </div>
      {/* The answer is ALWAYS in the DOM and collapsed with CSS, never removed
          with `open && ...`. Conditional rendering left the answers out of the
          exported HTML entirely: a crawler saw ten questions and no answers, and
          the FAQPage structured data would have been describing text that is not
          on the page — which is a spam-policy problem, not just a missed
          ranking. Collapsing a grid row animates the same way and keeps the
          content readable. */}
      <div
        className={`grid transition-all duration-200 ${
          open ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <p className="overflow-hidden text-sm leading-relaxed text-muted">{a}</p>
      </div>
    </button>
  );
}

export default function FaqPage() {
  return (
    <InfoPage title="FAQs" subtitle="Quick answers to the questions we hear most.">
      <div className="space-y-3">
        {FAQS.map((f) => (
          <Item key={f.q} {...f} />
        ))}
      </div>
    </InfoPage>
  );
}
