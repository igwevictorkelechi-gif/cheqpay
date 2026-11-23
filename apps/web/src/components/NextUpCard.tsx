"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type NextUpItem } from "@/services/api";
import { readCache, writeCache } from "@/lib/cache";
import { CapsLabel } from "@/components/MobileUI";

const CACHE = "cheqpay:home:nextup";

/** "TODAY", "TMR", or the weekday ("FRI"), in Lagos time. */
function dayLabel(due: Date, now: Date): string {
  const lagos = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (lagos(due) === lagos(now)) return "Today";
  if (lagos(due) === lagos(tomorrow)) return "Tmr";
  return due.toLocaleDateString("en-NG", { weekday: "short", timeZone: "Africa/Lagos" });
}

function money(item: NextUpItem): string {
  if (item.amountMinor === null) return "Varies";
  const naira = Number(BigInt(item.amountMinor)) / 100;
  const text = `₦${naira.toLocaleString("en-NG", { maximumFractionDigits: naira % 1 ? 2 : 0 })}`;
  return item.direction === "in" ? `+${text}` : `−${text}`;
}

function routeFor(item: NextUpItem): string {
  return item.kind === "bill_autopay" ? "/pay-bill" : "/ajo";
}

/**
 * v2 "Next up": the money that will move on its own soon. Agenda rows with no
 * icon — a date block, a 2px rail, title and meta, the amount. The rail on
 * the soonest row is the screen's one brand accent. Hidden when nothing is
 * scheduled, rather than an empty card.
 */
export default function NextUpCard() {
  const router = useRouter();
  const [items, setItems] = useState<NextUpItem[]>(() => readCache<NextUpItem[]>(CACHE) ?? []);

  useEffect(() => {
    let active = true;
    api
      .getNextUp()
      .then(({ items }) => {
        if (!active) return;
        setItems(items);
        writeCache(CACHE, items);
      })
      .catch(() => {
        /* Not essential to Home: keep whatever was cached. */
      });
    return () => {
      active = false;
    };
  }, []);

  if (items.length === 0) return null;
  const now = new Date();
  return (
    <div className="mb-6 px-5">
      <CapsLabel className="mb-2.5 block">Next up</CapsLabel>
      <div className="overflow-hidden rounded-3xl border border-border bg-card">
        {items.map((item, i) => {
          const due = new Date(item.dueAt);
          return (
            <button
              key={`${item.kind}:${item.id}`}
              onClick={() => router.push(routeFor(item))}
              className="flex w-full items-stretch gap-3.5 pl-4 text-left active:opacity-70"
            >
              <span className="flex w-9 shrink-0 flex-col items-center justify-center py-3.5">
                <span className="text-[11px] font-bold uppercase leading-[14px] tracking-[0.06em] text-muted">
                  {dayLabel(due, now)}
                </span>
                <span className="tnum text-[17px] font-bold leading-[22px] text-ink">
                  {due.toLocaleDateString("en-NG", { day: "numeric", timeZone: "Africa/Lagos" })}
                </span>
              </span>
              <span className={`my-3 w-0.5 shrink-0 rounded-full ${i === 0 ? "bg-brand" : "bg-hairline"}`} />
              <span className={`flex min-w-0 flex-1 items-center gap-3 py-3.5 pr-4 ${i > 0 ? "border-t border-hairline" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">{item.title}</span>
                  <span className="block truncate text-[13px] text-muted">
                    {due.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", timeZone: "Africa/Lagos" })} · {item.detail}
                  </span>
                </span>
                <span className={`tnum shrink-0 text-[15px] font-semibold ${item.direction === "in" ? "text-positive" : "text-ink"}`}>
                  {money(item)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
