"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { ArrowLeft, Loader2, CalendarDays, MapPin } from "lucide-react";
import AppShell from "@/components/AppShell";
import { Card } from "@/components/MobileUI";
import { api, ApiError, type EventTicket } from "@/services/api";

const STATUS: Record<string, { label: string; cls: string }> = {
  VALID: { label: "Valid", cls: "bg-green-500/15 text-green-500" },
  USED: { label: "Checked in", cls: "bg-blue-500/15 text-blue-400" },
  CANCELLED: { label: "Cancelled", cls: "bg-red-500/15 text-red-400" },
  REFUNDED: { label: "Refunded", cls: "bg-red-500/15 text-red-400" },
};

function whenLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function MyTicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<EventTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getMyTickets()
      .then(({ tickets }) => setTickets(tickets))
      .catch((e) => { setError(e instanceof ApiError ? e.message : "Couldn't load your tickets."); setTickets([]); });
  }, []);

  return (
    <AppShell>
      <div className="px-5 pt-4">
        <button onClick={() => router.push("/events")} className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-ink" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>
      <h1 className="mb-5 mt-3 px-5 text-2xl font-extrabold text-ink">My tickets</h1>

      {tickets === null ? (
        <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : error ? (
        <div className="px-5"><Card><p className="py-6 text-center text-sm text-muted">{error}</p></Card></div>
      ) : tickets.length === 0 ? (
        <div className="px-5">
          <Card>
            <div className="py-8 text-center">
              <CalendarDays className="mx-auto h-9 w-9 text-muted" />
              <p className="mt-3 text-sm text-muted">No tickets yet.</p>
              <button onClick={() => router.push("/events")} className="mt-5 rounded-full bg-brand px-8 py-3 text-sm font-bold text-white">Browse events</button>
            </div>
          </Card>
        </div>
      ) : (
        <div className="space-y-4 px-5 pb-10">
          {tickets.map((t) => {
            const s = STATUS[t.status] ?? STATUS.VALID;
            const dimmed = t.status !== "VALID";
            return (
              <div key={t.id} className="overflow-hidden rounded-2xl bg-card">
                <div className="flex items-start justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-bold text-ink">{t.eventTitle}</p>
                    <p className="text-sm text-muted">{t.tierName}</p>
                    {whenLabel(t.startsAt) ? <p className="mt-1 flex items-center gap-1 text-xs text-muted"><CalendarDays className="h-3 w-3" /> {whenLabel(t.startsAt)}</p> : null}
                    {t.venue ? <p className="mt-0.5 flex items-center gap-1 text-xs text-muted"><MapPin className="h-3 w-3" /> {t.venue}</p> : null}
                  </div>
                  <span className={"shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold " + s.cls}>{s.label}</span>
                </div>
                <div className="flex flex-col items-center border-t border-border bg-white px-4 py-5">
                  <div className={dimmed ? "opacity-40" : ""}>
                    <QRCodeSVG value={t.reference} size={150} level="M" includeMargin />
                  </div>
                  <p className="mt-3 font-mono text-sm font-bold tracking-wide text-[#1B1726]">{t.reference}</p>
                  <p className="mt-0.5 text-xs text-[#6E6880]">Show this at the gate</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
