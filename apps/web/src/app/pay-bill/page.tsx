"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, ChevronDown, Loader2, Search, Sparkles, Trash2, X } from "lucide-react";
import AppShell from "@/components/AppShell";
import { TopBar, useToast } from "@/components/MobileUI";
import SponsoredCard from "@/components/SponsoredCard";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";
import { useAuthStore } from "@/store";
import { useFeatures } from "@/lib/useFeatures";
import { api, ApiError, type BillSuggestion, type BillsOverview, type SavedBill } from "@/services/api";
import { BILL_SECTIONS, maskCustomer, ordinal, tileFor } from "@/lib/billServices";

/** Where a saved bill's action button goes: the service flow, prefilled. */
function payHref(b: { service: string; billerId: string; customer: string; planId: string | null; expectedMinor: string | null }, withAmount = true) {
  const q = new URLSearchParams({ biller: b.billerId, customer: b.customer });
  if (b.planId) q.set("plan", b.planId);
  else if (withAmount && b.expectedMinor) q.set("amount", String(Number(b.expectedMinor) / 100));
  return `/pay-bill/${b.service}/?${q.toString()}`;
}

const NAME_IDEAS: Record<string, string[]> = {
  airtime: ["My line", "Mum's line", "Dad's line"],
  data: ["My data", "Home router", "Work phone"],
  electricity: ["Home meter", "Shop meter"],
  cabletv: ["Living room TV", "Bedroom TV"],
  betting: ["My wallet"],
};

const trimKobo = (s: string) => s.replace(/\.00(?=\b|,|$)/g, "");

type Sheet = { kind: "save"; s: BillSuggestion } | { kind: "manage"; b: SavedBill } | { kind: "autopay"; b: SavedBill };

/**
 * Pay bills: what you've paid this month (and the cashback it earned), the
 * bills still to sort — renew, top up, or let autopay handle them — then
 * everything else you can pay, and the sponsored slot last.
 */
export default function PayBillPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const toast = useToast();
  const features = useFeatures();
  const { authorize } = useTransactionPin();
  const [month, setMonth] = useState<string | undefined>();
  const [data, setData] = useState<BillsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (m?: string) =>
      api
        .getBillsOverview(m)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your bills.")),
    [],
  );
  useEffect(() => {
    void load(month);
  }, [load, month]);

  const others = useMemo(() => BILL_SECTIONS.flatMap((s) => s.tiles).filter((t) => !t.flag || features[t.flag]), [features]);

  const paid = Number(data?.paidMinor ?? 0);
  const left = Number(data?.stillToSortMinor ?? 0);
  const pct = paid + left > 0 ? Math.max(paid > 0 ? 4 : 0, Math.round((paid / (paid + left)) * 100)) : 0;
  const unpaid = data?.bills.filter((b) => b.state !== "paid") ?? [];
  const sorted = data?.bills.filter((b) => b.state === "paid") ?? [];

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await fn();
      if (done) toast.show(done);
      setSheet(null);
      await load(month);
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      toast.show(e instanceof ApiError ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function autopayOn(b: SavedBill, day: number, amount?: string) {
    const patch = { autopay: true, autopayDay: day, ...(b.planId ? {} : { amount: amount ?? null }) };
    const money = b.planId ? (b.expectedFormatted ? trimKobo(b.expectedFormatted) : b.planName) : `₦${Number(amount ?? 0).toLocaleString("en-NG")}`;
    return run(
      () =>
        authorize((pin) => api.updateSavedBill(b.id, patch, pin), {
          title: "Turn on autopay",
          detail: `${money} to ${b.billerName} ${maskCustomer(b.customer)} on the ${ordinal(day)} of every month, from your Naira balance.`,
        }),
      `Autopay on for ${b.nickname}`,
    );
  }
  const autopayOff = (b: SavedBill) => run(() => api.updateSavedBill(b.id, { autopay: false }), `Autopay off for ${b.nickname}`);

  return (
    <AppShell>
      <TopBar
        name={user?.full_name}
        onAvatar={() => router.push("/profile")}
        icons={[
          { icon: Search, label: "View transactions", onClick: () => router.push("/transactions") },
          { icon: Bell, label: "Notifications", onClick: () => toast.show("No new notifications") },
        ]}
      />

      <div className="mb-4 mt-2 flex items-center justify-between px-5">
        <h1 className="text-[32px] font-extrabold leading-none text-ink">Pay bills</h1>
        <label className="relative flex min-h-[44px] items-center gap-1.5 rounded-full bg-card px-4 text-sm font-semibold text-ink">
          {data?.monthLabel ?? "This month"}
          <ChevronDown className="h-4 w-4 text-muted" />
          <select
            aria-label="Month"
            value={data?.month ?? ""}
            onChange={(e) => {
              setData(null);
              setMonth(e.target.value);
            }}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {(data?.months ?? []).map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Month summary */}
      <div className="mb-6 px-5">
        <div className="rounded-3xl bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted">{data ? (data.isCurrentMonth ? `Paid so far in ${data.monthLabel}` : `Paid in ${data.monthLabel}`) : "Paid this month"}</p>
            {data && Number(data.cashbackMinor) > 0 && (
              <span className="rounded-full px-3 py-1 text-xs font-bold text-green-400" style={{ backgroundColor: "rgba(34,197,94,0.16)" }}>+{trimKobo(data.cashbackFormatted)} cashback</span>
            )}
          </div>
          <p className="mt-1 text-[40px] font-extrabold leading-tight tracking-tight text-ink">{data ? trimKobo(data.paidFormatted) : "—"}</p>
          <div className="mt-4 h-3 overflow-hidden rounded-full" style={{ background: "repeating-linear-gradient(135deg, rgba(150,140,180,.28) 0 6px, rgba(150,140,180,.08) 6px 12px)" }}>
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #7C3AED, #D946EF 55%, #FB923C)" }} />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: "linear-gradient(90deg, #7C3AED, #FB923C)" }} /> Paid
            </span>
            {left > 0 ? (
              <span className="flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: "repeating-linear-gradient(135deg, rgba(150,140,180,.6) 0 2px, transparent 2px 4px)" }} /> Still to sort{" "}
                {data ? trimKobo(data.stillToSortFormatted) : ""}
              </span>
            ) : data && data.bills.length > 0 ? (
              <span className="flex items-center gap-1 text-green-400">
                <Check className="h-3.5 w-3.5" /> All sorted
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {error && <p className="mx-5 mb-4 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</p>}
      {!data && !error && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
        </div>
      )}

      {/* Still to sort */}
      {data && (unpaid.length > 0 || data.bills.length === 0) && (
        <section className="mb-6 px-5">
          <h2 className="mb-3 text-lg font-bold text-ink">{data.isCurrentMonth ? "Still to sort" : "Not paid that month"}</h2>
          {unpaid.length > 0 ? (
            <div className="divide-y divide-border/60 overflow-hidden rounded-3xl bg-card">
              {unpaid.map((b) => (
                <BillRow key={b.id} b={b} onOpen={() => setSheet({ kind: "manage", b })}>
                  {b.state === "due" ? (
                    <button onClick={() => router.push(payHref(b))} className="rounded-full bg-[#6D28D9] px-5 py-2.5 text-sm font-bold text-white">
                      Renew
                    </button>
                  ) : b.state === "topup" ? (
                    <button onClick={() => router.push(payHref(b, false))} className="rounded-full bg-circle px-5 py-2.5 text-sm font-bold text-ink">
                      Top up
                    </button>
                  ) : b.canAutopay && (b.service === "airtime" || b.service === "data" || b.autopay) ? (
                    <Toggle on={b.autopay} disabled={busy} label={`Autopay for ${b.nickname}`} onChange={(on) => (on ? setSheet({ kind: "autopay", b }) : void autopayOff(b))} />
                  ) : (
                    <button onClick={() => router.push(payHref(b))} className="rounded-full bg-circle px-5 py-2.5 text-sm font-bold text-ink">
                      Pay
                    </button>
                  )}
                </BillRow>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl bg-card p-5 text-sm text-muted">
              <p className="font-semibold text-ink">Keep your regular bills here</p>
              <p className="mt-1">
                After you pay a bill, save it with a name like &ldquo;Mum&apos;s line&rdquo; or &ldquo;Home meter&rdquo;. We&apos;ll show when it&apos;s due, and you can switch on autopay.
              </p>
            </div>
          )}
        </section>
      )}

      {/* Suggestions from history */}
      {data && data.isCurrentMonth && data.suggestions.length > 0 && (
        <section className="mb-6 px-5">
          <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-ink">
            <Sparkles className="h-4 w-4 text-brand-light" /> You pay these often
          </h2>
          <div className="divide-y divide-border/60 overflow-hidden rounded-3xl bg-card">
            {data.suggestions.map((s) => {
              const t = tileFor(s.service);
              return (
                <div key={`${s.service}|${s.customer}`} className="flex items-center gap-3 p-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-circle">{t && <t.icon className="h-5 w-5 text-ink" />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold text-ink">
                      {s.billerName} {s.serviceLabel.toLowerCase()}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {maskCustomer(s.customer)} · {trimKobo(s.amountFormatted)} · paid {s.times}×
                    </p>
                  </div>
                  <button onClick={() => setSheet({ kind: "save", s })} className="rounded-full bg-circle px-4 py-2 text-sm font-bold text-ink">
                    Save
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sorted this month */}
      {sorted.length > 0 && (
        <section className="mb-6 px-5">
          <h2 className="mb-3 text-base font-bold text-ink">{data?.isCurrentMonth ? "Sorted this month" : `Paid in ${data?.monthLabel}`}</h2>
          <div className="divide-y divide-border/60 overflow-hidden rounded-3xl bg-card">
            {sorted.map((b) => (
              <BillRow key={b.id} b={b} onOpen={() => setSheet({ kind: "manage", b })}>
                <span className="flex items-center gap-1 text-sm font-bold text-green-400">
                  <Check className="h-4 w-4" /> Paid
                </span>
              </BillRow>
            ))}
          </div>
        </section>
      )}

      {/* Pay something else */}
      <section className="mb-6">
        <h2 className="mb-3 px-5 text-lg font-bold text-ink">Pay something else</h2>
        <div className="flex gap-4 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {others.map((t) => (
            <button
              key={t.key}
              onClick={() => (t.route ? router.push(t.route) : toast.show(`${t.label} — coming soon`))}
              className="flex w-[72px] shrink-0 flex-col items-center gap-2 transition active:scale-95"
            >
              <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-card">
                <t.icon className="h-6 w-6 text-ink" />
                {t.badge === "Soon" && <span className="absolute -right-1 -top-1 rounded-full bg-circle px-1.5 text-[9px] font-bold text-muted">Soon</span>}
              </span>
              <span className="text-center text-xs font-semibold leading-tight text-ink">{t.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="mb-6 px-5">
        <SponsoredCard placement="paybills" />
      </div>

      {sheet && (
        <BottomSheet onClose={() => !busy && setSheet(null)}>
          {sheet.kind === "save" && (
            <SaveSheet
              s={sheet.s}
              busy={busy}
              onSave={(nickname) =>
                run(
                  () =>
                    api.saveBill({
                      service: sheet.s.service,
                      billerId: sheet.s.billerId,
                      customer: sheet.s.customer,
                      nickname,
                      planId: sheet.s.planId,
                      amount: String(Number(sheet.s.amountMinor) / 100),
                    }),
                  `Saved as ${nickname}`,
                )
              }
            />
          )}
          {sheet.kind === "autopay" && <AutopaySheet b={sheet.b} busy={busy} onConfirm={(day, amount) => autopayOn(sheet.b, day, amount)} />}
          {sheet.kind === "manage" && (
            <ManageSheet
              b={sheet.b}
              busy={busy}
              onPay={() => router.push(payHref(sheet.b))}
              onRename={(nickname) => run(() => api.updateSavedBill(sheet.b.id, { nickname }), "Name saved")}
              onAutopay={(on) => (on ? setSheet({ kind: "autopay", b: sheet.b }) : void autopayOff(sheet.b))}
              onDelete={() => run(() => api.deleteSavedBill(sheet.b.id), `Removed ${sheet.b.nickname}`)}
            />
          )}
        </BottomSheet>
      )}
      {toast.node}
    </AppShell>
  );
}

function BillRow({ b, onOpen, children }: { b: SavedBill; onOpen: () => void; children: React.ReactNode }) {
  const t = tileFor(b.service);
  return (
    <div className="flex items-center gap-3 p-4">
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Manage ${b.nickname}`}>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-circle">{t && <t.icon className="h-5 w-5 text-ink" />}</span>
        <span className="min-w-0">
          <span className="block truncate font-bold text-ink">{b.nickname}</span>
          <span className={`block text-sm leading-snug ${b.autopayNote ? "text-amber-400" : "text-muted"}`}>{trimKobo(b.detail)}</span>
        </span>
      </button>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`flex h-8 w-14 items-center rounded-full p-1 transition ${on ? "bg-[#6D28D9]" : "bg-white/20"} disabled:opacity-50`}
    >
      <span className={`h-6 w-6 rounded-full bg-white shadow transition ${on ? "translate-x-6" : ""}`} />
    </button>
  );
}

function BottomSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-t-3xl bg-card p-5 pb-8 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-circle text-muted">
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

const input = "w-full rounded-2xl border border-border bg-surface px-4 py-3.5 text-ink placeholder-muted outline-none focus:border-brand";

function NameField({ value, onChange, ideas }: { value: string; onChange: (v: string) => void; ideas: string[] }) {
  return (
    <>
      <input value={value} onChange={(e) => onChange(e.target.value.slice(0, 40))} placeholder="Name it" className={input} />
      {ideas.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {ideas.map((n) => (
            <button key={n} onClick={() => onChange(n)} className="rounded-full bg-circle px-3 py-1.5 text-xs font-semibold text-ink">
              {n}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SaveSheet({ s, busy, onSave }: { s: BillSuggestion; busy: boolean; onSave: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div>
      <p className="pr-10 text-lg font-extrabold text-ink">Save this bill</p>
      <p className="mb-4 text-sm text-muted">
        {s.billerName} {s.serviceLabel.toLowerCase()} · {maskCustomer(s.customer)}
      </p>
      <NameField value={name} onChange={setName} ideas={NAME_IDEAS[s.service] ?? []} />
      <button disabled={busy || !name.trim()} onClick={() => onSave(name.trim())} className="mt-5 w-full rounded-full bg-brand py-3.5 font-bold text-white disabled:opacity-40">
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function AutopaySheet({ b, busy, onConfirm }: { b: SavedBill; busy: boolean; onConfirm: (day: number, amount?: string) => void }) {
  const [day, setDay] = useState(b.autopayDay ?? Math.min(28, new Date().getDate()));
  const [amount, setAmount] = useState(b.expectedMinor ? String(Number(b.expectedMinor) / 100) : "");
  const needsAmount = !b.planId;
  return (
    <div>
      <p className="pr-10 text-lg font-extrabold text-ink">Autopay {b.nickname}</p>
      <p className="mb-4 text-sm text-muted">
        We&apos;ll pay {b.planName ? `${b.billerName} ${b.planName}` : `${b.billerName} ${b.serviceLabel.toLowerCase()}`} for {maskCustomer(b.customer)} from your Naira balance every
        month. If your balance is too low we skip it and tell you.
      </p>
      <label className="block text-xs font-semibold text-muted">
        Day of the month
        <select value={day} onChange={(e) => setDay(Number(e.target.value))} className={`${input} mt-1`}>
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {ordinal(d)}
            </option>
          ))}
        </select>
      </label>
      {needsAmount && (
        <label className="mt-3 block text-xs font-semibold text-muted">
          Amount (₦)
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className={`${input} mt-1`} />
        </label>
      )}
      <button
        disabled={busy || (needsAmount && !(Number(amount) > 0))}
        onClick={() => onConfirm(day, needsAmount ? amount : undefined)}
        className="mt-5 w-full rounded-full bg-[#6D28D9] py-3.5 font-bold text-white disabled:opacity-40"
      >
        {busy ? "Saving…" : "Turn on autopay"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">You&apos;ll confirm with your PIN. Turn it off any time.</p>
    </div>
  );
}

function ManageSheet({
  b,
  busy,
  onPay,
  onRename,
  onAutopay,
  onDelete,
}: {
  b: SavedBill;
  busy: boolean;
  onPay: () => void;
  onRename: (name: string) => void;
  onAutopay: (on: boolean) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(b.nickname);
  return (
    <div>
      <p className="pr-10 text-lg font-extrabold text-ink">{b.nickname}</p>
      <p className="mb-4 text-sm text-muted">
        {b.billerName} {b.serviceLabel.toLowerCase()} · {maskCustomer(b.customer)}
        {b.planName ? ` · ${b.planName}` : ""}
      </p>
      <NameField value={name} onChange={setName} ideas={[]} />
      {name.trim() && name.trim() !== b.nickname && (
        <button disabled={busy} onClick={() => onRename(name.trim())} className="mt-3 w-full rounded-full bg-circle py-3 font-bold text-ink disabled:opacity-40">
          Save name
        </button>
      )}
      {b.canAutopay && (
        <div className="mt-4 flex items-center justify-between rounded-2xl bg-circle p-4">
          <div>
            <p className="font-bold text-ink">Autopay</p>
            <p className="text-xs text-muted">{b.autopay ? `On, every month on the ${ordinal(b.autopayDay ?? 1)}` : "Pay it automatically every month"}</p>
          </div>
          <Toggle on={b.autopay} disabled={busy} label="Autopay" onChange={onAutopay} />
        </div>
      )}
      <button onClick={onPay} className="mt-4 w-full rounded-full bg-brand py-3.5 font-bold text-white">
        Pay now
      </button>
      <button disabled={busy} onClick={onDelete} className="mt-3 flex w-full items-center justify-center gap-2 py-2 text-sm font-semibold text-red-400 disabled:opacity-40">
        <Trash2 className="h-4 w-4" /> Remove from my bills
      </button>
    </div>
  );
}
