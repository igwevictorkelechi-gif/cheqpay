"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Plus,
  Search,
  Snowflake,
  Sun,
  X,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { TopBar, useToast } from "@/components/MobileUI";
import { useAuthStore } from "@/store";
import {
  api,
  ApiError,
  type Balance,
  type CardTransaction,
  type VirtualCard,
} from "@/services/api";
import { useFeatures } from "@/lib/useFeatures";
import { cardFundBreakdown, cardFundFeeText, dollars, useFees } from "@/lib/fees";
import { useTransactionPin, PIN_CANCELLED } from "@/components/TransactionPinProvider";

/**
 * Virtual USD cards, issued via Maplerad.
 *
 * Two gates cover the whole page: the admin `virtual_cards` flag AND a
 * configured Maplerad key on the API. Until both are on it shows "coming soon".
 *
 * Everything on the card is now real: the live balance is read from the
 * provider, Add money / Withdraw move USD between the in-app balance and the
 * card, Reveal shows the full number/CVV (behind step-up 2FA), Freeze toggles
 * spending, and the activity list is the card's own provider history.
 */

const usd = (cents: string | null | undefined): string | null =>
  cents == null || !Number.isFinite(Number(cents))
    ? null
    : `$${(Number(cents) / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

export default function CardsPage() {
  const router = useRouter();
  const features = useFeatures();
  const { user } = useAuthStore();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [available, setAvailable] = useState(false);
  const [usdBalance, setUsdBalance] = useState<Balance | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const creating = false;
  const [error, setError] = useState<string | null>(null);
  // Getting a card is a short guided flow (pay the card fee, then fund it).
  // null = closed; "new" = start from the fee; a card = resume funding it.
  const [wizard, setWizard] = useState<null | "new" | VirtualCard>(null);
  const fees = useFees();

  const activeCard = useMemo(
    () => cards.find((c) => c.id === activeId) ?? cards[0] ?? null,
    [cards, activeId],
  );

  const refreshUsd = useCallback(async () => {
    try {
      const { balances } = await api.getBalances();
      setUsdBalance(balances.find((b) => b.asset === "USD") ?? null);
    } catch {
      /* leave the last known balance */
    }
  }, []);

  const refreshCard = useCallback(async (id: string) => {
    try {
      const { card } = await api.getCard(id);
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...card } : c)));
    } catch {
      /* keep the row we have */
    }
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([api.getCards(), api.getBalances().catch(() => ({ balances: [] as Balance[] }))])
      .then(([cardsRes, balancesRes]) => {
        if (!active) return;
        const cards = Array.isArray(cardsRes?.cards) ? cardsRes.cards : [];
        const balances = Array.isArray(balancesRes?.balances) ? balancesRes.balances : [];
        setCards(cards);
        setAvailable(cardsRes?.available);
        setActiveId((id) => id ?? cards[0]?.id ?? null);
        setUsdBalance(balances.find((b) => b.asset === "USD") ?? null);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // Pull the live balance for whichever card is on top.
  useEffect(() => {
    if (activeCard?.id) void refreshCard(activeCard.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCard?.id]);

  const createCard = useCallback(() => {
    setError(null);
    // Someone who already paid for a card and hasn't funded it goes straight
    // to funding that card — never pays twice.
    const waiting = cards.find((c) => c.status === "unfunded");
    setWizard(waiting ?? "new");
  }, [cards]);

  // Back from converting or depositing for a card: reopen where they left off.
  useEffect(() => {
    if (loading) return;
    try {
      const q = new URLSearchParams(window.location.search);
      const fund = q.get("fund");
      const create = q.get("create");
      if (!fund && !create) return;
      window.history.replaceState(null, "", "/cards");
      const card = fund ? cards.find((c) => c.id === fund && c.status === "unfunded") : undefined;
      setWizard(card ?? (create ? "new" : null));
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const comingSoon = !features.virtual_cards || !available;

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

      <div className="flex flex-col px-5 pb-8">
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold leading-tight text-ink">Virtual cards</h1>
            <p className="mt-1 text-sm text-muted">
              Dollar cards for online payments and subscriptions.
            </p>
            {fees ? (
              <p className="mt-1 text-xs text-muted">
                Card {dollars(fees.cardIssueFeeUsd)} · top-up {cardFundFeeText(fees)} · withdrawal{" "}
                {dollars(fees.cardWithdrawFeeUsd)} ·{" "}
                <a href="/pricing" className="font-semibold text-brand-light">
                  all fees
                </a>
              </p>
            ) : null}
          </div>
          {!comingSoon && cards.length > 0 && (
            <button
              onClick={createCard}
              disabled={creating}
              aria-label="Create a new card"
              className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-circle text-brand-light active:scale-95 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            </button>
          )}
        </div>

        {loading ? (
          <div className="mt-20 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        ) : comingSoon ? (
          <EmptyState
            icon={<CreditCard className="h-7 w-7 text-brand-light" />}
            title="Coming soon"
            body="USD virtual cards are on the way. We'll let you know the moment they're ready to create."
          />
        ) : (
          <>
            {/* The card and its pocket are the page, with or without a card:
                before the first one is issued the same shell renders as a
                placeholder so this reads as a wallet from the first visit,
                rather than a bare "nothing here" screen. */}
            <CardPocket
              card={activeCard}
              stackCount={cards.length}
              holder={user?.full_name ?? null}
              usdAvailable={usdBalance?.availableFormatted ?? null}
              creating={creating}
              onCreate={createCard}
              onActivate={(card) => setWizard(card)}
              onFunded={async () => {
                if (!activeCard) return;
                await Promise.all([refreshCard(activeCard.id), refreshUsd()]);
              }}
              onFrozen={(status) =>
                setCards((prev) =>
                  prev.map((c) => (c.id === activeCard?.id ? { ...c, status } : c)),
                )
              }
            />

            {cards.length > 1 && (
              <div className="mt-4 flex items-center justify-center gap-2">
                {cards.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setActiveId(c.id)}
                    aria-label={`Show card ending ${c.maskedPan?.slice(-4) ?? ""}`}
                    aria-current={c.id === activeCard?.id}
                    className={`h-2 rounded-full transition-all ${
                      c.id === activeCard?.id ? "w-6 bg-brand-light" : "w-2 bg-border"
                    }`}
                  />
                ))}
              </div>
            )}

            <CardActivity cardId={activeCard?.id ?? null} />

            {cards.length > 0 && (
              <CreateButton onClick={createCard} busy={creating} label="Create another card" />
            )}
          </>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>

      {wizard && fees && (
        <CreateCardSheet
          fees={fees}
          startCard={wizard === "new" ? null : wizard}
          usdAvailable={usdBalance ? Number(usdBalance.availableFormatted) : null}
          onClose={() => setWizard(null)}
          onPaid={(card) => {
            setCards((prev) => (prev.some((c) => c.id === card.id) ? prev : [card, ...prev]));
            setActiveId(card.id);
            void refreshUsd();
          }}
          onCancelled={(id) => {
            setCards((prev) => prev.filter((c) => c.id !== id));
            setActiveId(null);
            setWizard(null);
            void refreshUsd();
            toast.show("Card cancelled — your card fee was refunded.");
          }}
          onDone={(card) => {
            setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...card } : c)));
            setActiveId(card.id);
            setWizard(null);
            void refreshUsd();
            toast.show("Your card is being created — it'll be ready in a moment.");
          }}
        />
      )}
    </AppShell>
  );
}

/* ---------------------------------------------------------------------- */

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mt-16 flex flex-col items-center text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-circle">
        {icon}
      </span>
      <p className="mt-4 text-lg font-bold text-ink">{title}</p>
      <p className="mt-1 max-w-[300px] text-sm text-muted">{body}</p>
    </div>
  );
}

function CreateButton({
  onClick,
  busy,
  label = "Create a new card",
}: {
  onClick: () => void;
  busy: boolean;
  label?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-4 font-bold text-brand-light active:scale-[0.99] disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
      {busy ? "Creating…" : label}
    </button>
  );
}

const QUICK = ["5", "10", "25", "50", "100"];

/**
 * The card, its pocket, and the quick-load row — the whole wallet.
 *
 * The card face sits BEHIND a pocket panel that overlaps it, so only its top
 * band shows, the way a card sits in a wallet. `card` may be null: before the
 * first card is issued the same shell renders as a placeholder with "Create
 * your first card" as the pocket's action, so the page reads as a wallet from
 * the very first visit instead of an empty screen.
 */
function CardPocket({
  card,
  stackCount,
  holder,
  usdAvailable,
  creating,
  onCreate,
  onActivate,
  onFunded,
  onFrozen,
}: {
  card: VirtualCard | null;
  stackCount: number;
  holder: string | null;
  usdAvailable: string | null;
  creating: boolean;
  onCreate: () => void;
  onActivate: (card: VirtualCard) => void;
  onFunded: () => Promise<void>;
  onFrozen: (status: string) => void;
}) {
  const toast = useToast();
  const frozen = card?.status === "frozen";
  const pending = card?.status === "pending";
  const unfunded = card?.status === "unfunded";
  const active = card?.status === "active";
  const balance = usd(card?.balanceMinor);

  const [sheet, setSheet] = useState<null | "fund" | "withdraw">(null);
  const [prefill, setPrefill] = useState("");
  const [revealed, setRevealed] = useState<{
    number: string | null;
    cvv: string | null;
    expiry: string | null;
  } | null>(null);
  const [revealing, setRevealing] = useState(false);
  const { authorize } = useTransactionPin();
  const [freezing, setFreezing] = useState(false);

  async function reveal() {
    if (!card) return;
    if (revealed) {
      setRevealed(null);
      return;
    }
    setRevealing(true);
    try {
      const { card: c } = await authorize((pin) => api.revealCard(card.id, pin), {
        title: "Show card details",
        detail: "Enter your transaction PIN to see the full card number and CVV.",
      });
      setRevealed({ number: c.number, cvv: c.cvv, expiry: c.expiry });
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      toast.show(
        e instanceof ApiError && e.status === 403
          ? "Turn on two-factor authentication to reveal card details."
          : e instanceof ApiError
            ? e.message
            : "Couldn't reveal the card right now.",
      );
    } finally {
      setRevealing(false);
    }
  }

  async function toggleFreeze() {
    if (!card) return;
    setFreezing(true);
    try {
      const { status } = await api.setCardFrozen(card.id, !frozen);
      onFrozen(status);
      toast.show(status === "frozen" ? "Card frozen." : "Card unfrozen.");
    } catch (e) {
      toast.show(e instanceof ApiError ? e.message : "Couldn't update the card right now.");
    } finally {
      setFreezing(false);
    }
  }

  function openSheet(mode: "fund" | "withdraw", amount = "") {
    setPrefill(amount);
    setSheet(mode);
  }

  return (
    <div className="mt-6">
      {stackCount > 1 && (
        <div
          aria-hidden
          className="mx-auto h-3 rounded-t-2xl bg-brand-light/35"
          style={{ width: "86%" }}
        />
      )}

      <div className="relative">
        {/* Card face — dimmed while there is no real card behind it. */}
        <div
          className={`rounded-2xl bg-gradient-to-br from-brand-light to-brand px-5 pb-16 pt-5 text-white shadow-lg ${
            card ? "" : "opacity-70"
          }`}
        >
          {/* Brand and card type. The supplied logo artwork is a purple
              wordmark on a light ground, which would disappear on this purple
              face, so the card carries the name set in white — the way a card
              face normally carries a brand. */}
          <div className="flex items-start justify-between">
            <span className="text-[17px] font-extrabold tracking-tight">CheqPay</span>
            <span className="rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider">
              {card?.currency ?? "USD"} Virtual
            </span>
          </div>

          <p className="mt-4 font-mono text-[15px] tracking-[0.18em] opacity-95">
            {revealed?.number
              ? revealed.number.replace(/(.{4})/g, "$1 ").trim()
              : (card?.maskedPan ?? "•••• •••• •••• ••••")}
          </p>

          <div className="mt-3 flex items-end justify-between">
            <div className="min-w-0">
              <p className="text-[9px] font-semibold uppercase tracking-wider opacity-60">
                Card holder
              </p>
              <p className="max-w-[180px] truncate text-[13px] font-bold">
                {holder ?? "—"}
              </p>
            </div>
            <div className="flex items-end gap-4">
              <div className="text-right">
                <p className="text-[9px] font-semibold uppercase tracking-wider opacity-60">
                  Valid thru
                </p>
                <p className="text-[13px] font-bold">
                  {revealed?.expiry ?? (active ? "••/••" : "—")}
                </p>
              </div>
              <span className="text-lg font-black italic leading-none tracking-tight">
                {card?.brand ?? "VISA"}
              </span>
            </div>
          </div>
          {revealed?.cvv && (
            <div className="mt-3 flex items-center gap-4 text-xs">
              <button
                onClick={() =>
                  copy(revealed.number?.replace(/\s/g, "") ?? "", () => toast.show("Number copied"))
                }
                className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 font-semibold"
              >
                <Copy className="h-3 w-3" /> Copy number
              </button>
              <span className="font-semibold opacity-90">CVV {revealed.cvv}</span>
            </div>
          )}
        </div>

        {/* Pocket. */}
        <div className="-mt-10 rounded-2xl bg-brand p-1.5 shadow-xl">
          <div className="rounded-[14px] border-2 border-dashed border-white/25 px-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                Card balance
              </p>
              {unfunded && (
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-semibold text-white">
                  Awaiting first top-up
                </span>
              )}
              {(frozen || pending) && (
                <span className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-semibold capitalize text-white">
                  {frozen ? (
                    <Snowflake className="h-3 w-3" />
                  ) : (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  )}
                  {card?.status}
                </span>
              )}
            </div>

            <p className="mt-1 text-[28px] font-extrabold leading-none text-white">
              {balance ?? <span className="opacity-60">$—</span>}
            </p>
            <p className="mt-1.5 text-[11px] text-white/60">
              {!card
                ? "Create a card to start spending online"
                : unfunded
                  ? "Your card fee is paid. Add a first top-up to create the card."
                  : balance
                  ? usdAvailable
                    ? `${usdAvailable} available to load`
                    : "\u00A0"
                  : "Balance appears once the card is active"}
            </p>

            {/* Paid for, not funded yet — the one thing to do is fund it. */}
            {unfunded && card ? (
              <button
                onClick={() => onActivate(card)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white py-3 text-sm font-bold text-brand active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" /> Fund to activate
              </button>
            ) : /* No card yet — the pocket's action is to make one. */ !card ? (
              <button
                onClick={onCreate}
                disabled={creating}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-white/15 py-3 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-50"
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {creating ? "Creating…" : "Create virtual card"}
              </button>
            ) : (
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => openSheet("fund")}
                  disabled={!active}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white/15 py-3 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Add money
                </button>
                <button
                  onClick={() => openSheet("withdraw")}
                  disabled={!active}
                  className="rounded-full bg-white/15 px-4 py-3 text-sm font-bold text-white active:scale-[0.99] disabled:opacity-50"
                >
                  Withdraw
                </button>
                <button
                  onClick={reveal}
                  disabled={!active || revealing}
                  aria-label={revealed ? "Hide card details" : "Show card details"}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white active:scale-95 disabled:opacity-50"
                >
                  {revealing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : revealed ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={toggleFreeze}
                  disabled={pending || freezing}
                  aria-label={frozen ? "Unfreeze card" : "Freeze card"}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white active:scale-95 disabled:opacity-50"
                >
                  {freezing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : frozen ? (
                    <Sun className="h-4 w-4" />
                  ) : (
                    <Snowflake className="h-4 w-4" />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick load — the card's answer to the reference's contact row. */}
      <section className="mt-7">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-ink">Quick load</h2>
          {usdAvailable && <span className="text-xs text-muted">{usdAvailable} available</span>}
        </div>
        <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {QUICK.map((amount) => (
            <button
              key={amount}
              onClick={() => openSheet("fund", amount)}
              disabled={!active}
              className="flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center rounded-2xl bg-card text-ink active:scale-95 disabled:opacity-40"
            >
              <span className="text-lg font-extrabold">${amount}</span>
              <span className="mt-0.5 text-[11px] text-muted">load</span>
            </button>
          ))}
          <button
            onClick={() => openSheet("fund")}
            disabled={!active}
            className="flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-brand-light active:scale-95 disabled:opacity-40"
          >
            <Plus className="h-5 w-5" />
            <span className="mt-0.5 text-[11px]">Other</span>
          </button>
        </div>
      </section>

      {sheet && card && (
        <AmountSheet
          mode={sheet}
          cardId={card.id}
          initialAmount={prefill}
          cardBalance={balance}
          usdAvailable={usdAvailable}
          onClose={() => setSheet(null)}
          onDone={async () => {
            setSheet(null);
            await onFunded();
          }}
        />
      )}
    </div>
  );
}

function copy(text: string, done: () => void) {
  if (!text) return;
  navigator.clipboard?.writeText(text).then(done).catch(() => undefined);
}

/** A bottom sheet for funding or withdrawing a card. */
function AmountSheet({
  mode,
  cardId,
  initialAmount,
  cardBalance,
  usdAvailable,
  onClose,
  onDone,
}: {
  mode: "fund" | "withdraw";
  cardId: string;
  initialAmount: string;
  cardBalance: string | null;
  usdAvailable: string | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { authorize } = useTransactionPin();
  const toast = useToast();
  const [amount, setAmount] = useState(initialAmount);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const isFund = mode === "fund";
  const fees = useFees();
  const value = Number(amount || 0);
  // Top-up: the card gets the amount, the fee is added on top.
  // Withdrawal: the fee comes out, the wallet gets the rest.
  const fund = fees && value > 0 ? cardFundBreakdown(value, fees) : null;
  const wdFee = fees ? fees.cardWithdrawFeeUsd : null;
  const wdReceive = wdFee !== null ? Math.round((value - wdFee) * 100) / 100 : null;

  async function submit() {
    setErr(null);
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setErr("Enter an amount like 10 or 10.50");
      return;
    }
    if (isFund && fund?.belowMin) {
      setErr(`The smallest top-up is ${dollars(fees!.cardFundMinUsd)}.`);
      return;
    }
    if (!isFund && wdReceive !== null && wdReceive <= 0) {
      setErr(`That doesn't cover the ${dollars(wdFee!)} withdrawal fee.`);
      return;
    }
    setBusy(true);
    try {
      await authorize(
        (pin) =>
          isFund
            ? api.fundCard(cardId, amount, pin)
            : api.withdrawFromCard(cardId, amount, pin),
        {
          title: isFund ? "Confirm this card load" : "Confirm this card withdrawal",
          detail: isFund
            ? fund
              ? `Loading ${dollars(fund.amount)} onto the card. ${dollars(fund.total)} leaves your balance (${dollars(fund.fee)} fee).`
              : `Moving $${amount} from your balance onto the card.`
            : wdReceive !== null
              ? `Moving $${amount} off the card. ${dollars(wdReceive)} reaches your balance (${dollars(wdFee!)} fee).`
              : `Moving $${amount} from the card back to your balance.`,
        },
      );
      toast.show(
        isFund ? `Loaded $${amount} onto the card.` : `Withdrew $${amount} to your balance.`,
      );
      await onDone();
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setErr(e instanceof ApiError ? e.message : "That didn't go through. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-t-3xl bg-surface p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-ink">
            {isFund ? "Add money to card" : "Withdraw from card"}
          </h2>
          <button onClick={onClose} aria-label="Close" className="text-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-2 text-xs text-muted">
          {isFund
            ? `From your dollar balance${usdAvailable ? ` · ${usdAvailable} available` : ""}`
            : `To your dollar balance${cardBalance ? ` · ${cardBalance} on card` : ""}`}
        </p>

        <div className="flex items-center rounded-2xl bg-card px-4 py-3">
          <span className="text-2xl font-extrabold text-muted">$</span>
          <input
            autoFocus
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-transparent pl-1 text-2xl font-extrabold text-ink outline-none"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK.map((a) => (
            <button
              key={a}
              onClick={() => setAmount(a)}
              className="rounded-full bg-card px-4 py-2 text-sm font-bold text-ink active:scale-95"
            >
              ${a}
            </button>
          ))}
        </div>

        {/* The fee and what actually moves, before the PIN. */}
        {fees && value > 0 ? (
          <div className="mt-4 space-y-2 rounded-2xl border border-border p-4 text-sm">
            {isFund && fund ? (
              <>
                <div className="flex justify-between text-muted">
                  <span>Card receives</span>
                  <span>{dollars(fund.amount)}</span>
                </div>
                <div className="flex justify-between text-muted">
                  <span>Fee</span>
                  <span>+{dollars(fund.fee)}</span>
                </div>
                <div className="flex justify-between font-bold text-ink">
                  <span>Total from your balance</span>
                  <span>{dollars(fund.total)}</span>
                </div>
                {fund.belowMin ? (
                  <p className="text-xs text-red-400">
                    The smallest top-up is {dollars(fees.cardFundMinUsd)}.
                  </p>
                ) : null}
              </>
            ) : wdFee !== null && wdReceive !== null ? (
              <>
                <div className="flex justify-between text-muted">
                  <span>Fee</span>
                  <span>−{dollars(wdFee)}</span>
                </div>
                <div className="flex justify-between font-bold text-ink">
                  <span>You&apos;ll receive</span>
                  <span>{wdReceive > 0 ? dollars(wdReceive) : "—"}</span>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-4 font-bold text-white active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          {busy ? "Working…" : isFund ? "Add money" : "Withdraw"}
        </button>
      </div>
    </div>
  );
}

function CardActivity({ cardId }: { cardId: string | null }) {
  const [txns, setTxns] = useState<CardTransaction[] | null>(cardId ? null : []);

  useEffect(() => {
    if (!cardId) {
      setTxns([]);
      return;
    }
    let active = true;
    setTxns(null);
    api
      .getCardTransactions(cardId)
      .then(({ transactions }) => active && setTxns(transactions))
      .catch(() => active && setTxns([]));
    return () => {
      active = false;
    };
  }, [cardId]);

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-ink">Card activity</h2>
      {txns === null ? (
        <div className="mt-4 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
        </div>
      ) : txns.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-2xl bg-card px-5 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-circle">
            <Lock className="h-5 w-5 text-muted" />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink">Nothing to show yet</p>
          <p className="mt-1 max-w-[260px] text-xs text-muted">
            Everything you spend on this card will appear here.
          </p>
        </div>
      ) : (
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl bg-card">
          {txns.map((t) => {
            const credit = t.entry === "CREDIT";
            const amt = t.amountMinor
              ? `${credit ? "+" : "-"}$${(Number(t.amountMinor) / 100).toFixed(2)}`
              : "—";
            return (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {t.merchant ?? t.description ?? "Transaction"}
                  </p>
                  <p className="text-xs text-muted">
                    {t.createdAt ? new Date(t.createdAt).toLocaleDateString() : ""}
                    {t.status ? ` · ${t.status}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 text-sm font-bold ${credit ? "text-success" : "text-ink"}`}>
                  {amt}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------- */

const FUND_QUICK = ["5", "10", "25", "50", "100"];

/**
 * Getting a card, one step at a time:
 *
 *   1. The card fee. With enough dollars, pay it; without, the way to get
 *      dollars (convert naira, or deposit USDT, which arrives as dollars).
 *   2. The first top-up. The card is created only now, with this loaded on it.
 *      Short of dollars again → the same two ways to get them.
 *
 * Paying the fee reserves the card, so leaving between the steps loses
 * nothing: the card waits as "Awaiting first top-up", and can be cancelled for
 * a refund of the fee.
 */
function CreateCardSheet({
  fees,
  startCard,
  usdAvailable,
  onClose,
  onPaid,
  onCancelled,
  onDone,
}: {
  fees: NonNullable<ReturnType<typeof useFees>>;
  startCard: VirtualCard | null;
  usdAvailable: number | null;
  onClose: () => void;
  onPaid: (card: VirtualCard) => void;
  onCancelled: (id: string) => void;
  onDone: (card: VirtualCard) => void;
}) {
  const router = useRouter();
  const { authorize } = useTransactionPin();
  const [card, setCard] = useState<VirtualCard | null>(startCard);
  const [available, setAvailable] = useState<number | null>(usdAvailable);
  const [amount, setAmount] = useState(String(Math.max(10, fees.cardFundMinUsd)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => setAvailable(usdAvailable), [usdAvailable]);

  const step: "fee" | "fund" = card ? "fund" : "fee";
  const feeUsd = fees.cardIssueFeeUsd;
  const have = available ?? 0;
  const n = Number(amount) || 0;
  const b = cardFundBreakdown(n, fees);

  // What is missing for the step we're on, in dollars (0 = enough).
  const shortBy =
    available === null
      ? 0
      : step === "fee"
        ? Math.max(0, Math.round((feeUsd - have) * 100) / 100)
        : b.belowMin || n <= 0
          ? 0
          : Math.max(0, Math.round((b.total - have) * 100) / 100);

  const back = card ? `/cards?fund=${card.id}` : "/cards?create=1";

  async function payFee() {
    setBusy(true);
    setErr(null);
    try {
      const { card: paid } = await api.createCard();
      setCard(paid);
      setAvailable((a) => (a === null ? a : Math.round((a - feeUsd) * 100) / 100));
      onPaid(paid);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't take the card fee. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function fund() {
    if (!card) return;
    setBusy(true);
    setErr(null);
    try {
      const { card: created } = await authorize((pin) => api.activateCard(card.id, amount, pin), {
        title: "Fund and create your card",
        detail: `Load ${dollars(b.amount)} onto your card (${dollars(b.fee)} fee, ${dollars(b.total)} total).`,
      });
      onDone(created);
    } catch (e) {
      if (e instanceof Error && e.message === PIN_CANCELLED) return;
      setErr(e instanceof ApiError ? e.message : "Couldn't create the card. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!card) return;
    setBusy(true);
    setErr(null);
    try {
      await api.cancelCard(card.id);
      onCancelled(card.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Couldn't cancel the card. Please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-surface p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Create a virtual card"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Step {step === "fee" ? 1 : 2} of 2
          </p>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <h2 className="mt-1 text-lg font-bold text-ink">
          {step === "fee" ? "Pay for your card" : "Fund your card to activate it"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {step === "fee"
            ? `A virtual dollar card costs ${dollars(feeUsd)}, paid from your USD balance.`
            : "Your card fee is paid. Add a first top-up — your card is created with it loaded."}
        </p>

        {step === "fund" && (
          <>
            <div className="mt-4 flex items-center gap-2 rounded-2xl bg-card px-4">
              <span className="text-lg font-bold text-ink">$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                aria-label="Top-up amount in dollars"
                className="min-h-[52px] w-full bg-transparent text-lg font-bold text-ink focus:outline-none"
              />
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none]">
              {FUND_QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => setAmount(q)}
                  className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-semibold ${
                    amount === q ? "bg-brand text-white" : "bg-card text-ink"
                  }`}
                >
                  ${q}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="mt-4 space-y-2 rounded-2xl bg-card p-4 text-sm">
          {step === "fee" ? (
            <div className="flex justify-between font-bold text-ink">
              <span>Card fee</span>
              <span>{dollars(feeUsd)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between text-ink">
                <span>Loaded on your card</span>
                <span>{dollars(b.amount)}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Top-up fee</span>
                <span>{dollars(b.fee)}</span>
              </div>
              <div className="flex justify-between font-bold text-ink">
                <span>Total from your USD balance</span>
                <span>{dollars(b.total)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between text-muted">
            <span>Your USD balance</span>
            <span>{available === null ? "…" : dollars(have)}</span>
          </div>
        </div>

        {step === "fund" && b.belowMin && n > 0 ? (
          <p className="mt-3 text-sm text-red-400">The smallest top-up is {dollars(fees.cardFundMinUsd)}.</p>
        ) : null}

        {shortBy > 0 ? (
          <div className="mt-4 rounded-2xl border border-brand/30 bg-brand/10 p-4">
            <p className="text-sm font-semibold text-ink">
              You need {dollars(shortBy)} more in your USD balance.
            </p>
            <p className="mt-1 text-xs text-muted">Get dollars, then come back — we&apos;ll bring you right here.</p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={() => router.push(`/convert?from=NGN&to=USD&back=${encodeURIComponent(back)}`)}
                className="rounded-full bg-brand py-3 text-sm font-bold text-white"
              >
                Convert naira to dollars
              </button>
              <button
                onClick={() => router.push("/receive/USDT")}
                className="rounded-full bg-card py-3 text-sm font-bold text-ink"
              >
                Deposit USDT (arrives as dollars)
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={step === "fee" ? payFee : fund}
            disabled={busy || available === null || (step === "fund" && (b.belowMin || n <= 0))}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand py-4 font-bold text-white active:scale-[0.99] disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {step === "fee" ? `Pay ${dollars(feeUsd)} & continue` : `Fund ${dollars(b.amount)} & create card`}
          </button>
        )}

        {err && <p className="mt-3 text-sm text-red-400">{err}</p>}

        {step === "fund" && card ? (
          <button
            onClick={cancel}
            disabled={busy}
            className="mt-4 w-full text-center text-sm font-semibold text-muted disabled:opacity-50"
          >
            Cancel this card and refund {dollars(feeUsd)}
          </button>
        ) : (
          <p className="mt-3 text-xs text-muted">
            Your card is only created once it&apos;s funded. If it can&apos;t be created, your money comes back.
          </p>
        )}
      </div>
    </div>
  );
}
