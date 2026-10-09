"use client";

import { useEffect, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import Shell from "@/components/Shell";
import { api, APP_URL, type Earning } from "@/lib/api";

const KIND: Record<Earning["kind"], string> = { COMMISSION: "Commission", TASK: "Task reward", BASIC_BONUS: "Referral bonus", WELCOME_BONUS: "Welcome bonus" };
const TXN: Record<string, string> = { DEPOSIT: "deposit", WITHDRAWAL: "withdrawal", CONVERT: "conversion", BILL: "bill payment", BUY: "crypto buy", SELL: "crypto sell", CARD_FUND: "card top-up", CARD_ISSUE: "new card", CARD_WITHDRAW: "card withdrawal", TRANSFER_OUT: "transfer", GADGET_PURCHASE: "gadget order", TICKET_PURCHASE: "ticket purchase", GIFTCARD_SELL: "gift card trade", GIFTCARD_BUY: "gift card purchase" };

export default function EarningsPage() {
  const [list, setList] = useState<Earning[] | null>(null);
  useEffect(() => {
    api.earnings().then((r) => setList(r.earnings)).catch(() => setList([]));
  }, []);

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="title-lg">Earnings</h1>
        <a href={APP_URL} className="btn-tinted !h-10 !px-4 text-[15px]"><Wallet className="h-4 w-4" /> Withdraw in CheqPay</a>
      </div>
      {!list ? (
        <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted" /></div>
      ) : list.length === 0 ? (
        <div className="card py-12 text-center subhead">No earnings yet. Share your link to get started.</div>
      ) : (
        <div className="group-list">
          {list.map((e) => (
            <div key={e.id} className="group-row gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {KIND[e.kind]}
                  {e.kind === "COMMISSION" && e.note ? <span className="font-normal text-muted"> · on a {TXN[e.note] ?? "transaction"}</span> : null}
                  {e.kind === "TASK" && e.note ? <span className="font-normal text-muted"> · {e.note}</span> : null}
                </p>
                <p className="footnote">
                  {new Date(e.createdAt).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })} ·{" "}
                  {e.status === "PAID" ? "Paid to your balance" : e.status === "VOID" ? `Cancelled${e.voidReason ? ` — ${e.voidReason}` : ""}` : `On hold until ${new Date(e.releaseAt).toLocaleString("en-NG", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}`}
                </p>
              </div>
              <span className={`font-semibold tabular-nums ${e.status === "VOID" ? "text-muted line-through" : e.status === "PAID" ? "text-good" : "text-ink"}`}>+{e.amountFormatted}</span>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}
