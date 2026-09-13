"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CreditCard,
  Eye,
  Loader2,
  Lock,
  Plus,
  Search,
  Snowflake,
  Sun,
} from "lucide-react";
import AppShell from "@/components/AppShell";
import { TopBar, useToast } from "@/components/MobileUI";
import { useAuthStore } from "@/store";
import { api, ApiError, type Balance, type VirtualCard } from "@/services/api";
import { useFeatures } from "@/lib/useFeatures";

/**
 * Virtual USD cards, issued via Maplerad.
 *
 * Two gates cover the whole page: the admin `virtual_cards` flag AND a configured
 * Maplerad key on the API. Until both are on it shows "coming soon" — no card
 * is ever created against an unverified provider.
 *
 * Within the page a third distinction matters. Issuing a card and reading its
 * status are wired end to end; revealing its numbers, loading it and listing
 * what it spent are not, because those Maplerad endpoints are still marked
 * "inferred" in lib/maplerad/issuing.ts. Rather than render dead controls, each
 * says plainly that it is not ready — a disabled button that explains itself is
 * honest, one that silently does nothing is not.
 */

/** Actions that need provider endpoints we have not confirmed yet. */
const AWAITING_PROVIDER = "We're finishing this with our card provider — not long now.";

function expiryLabel(card: VirtualCard): string {
  // Until the provider gives us a real expiry, say nothing rather than invent
  // a date a user might type into a checkout.
  return card.status === "active" ? "••/••" : "—";
}

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
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api.getCards(), api.getBalances().catch(() => ({ balances: [] }))])
      .then(([{ cards, available }, { balances }]) => {
        if (!active) return;
        setCards(cards);
        setAvailable(available);
        setActiveId((id) => id ?? cards[0]?.id ?? null);
        setUsdBalance(balances.find((b) => b.asset === "USD") ?? null);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const activeCard = useMemo(
    () => cards.find((c) => c.id === activeId) ?? cards[0] ?? null,
    [cards, activeId],
  );

  const createCard = useCallback(async () => {
    setError(null);
    setCreating(true);
    try {
      const { card } = await api.createCard();
      setCards((prev) => [card, ...prev]);
      setActiveId(card.id);
      toast.show("Card requested — it'll appear here once it's issued.");
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Couldn't create a card right now. Please try again.",
      );
    } finally {
      setCreating(false);
    }
  }, [toast]);

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
            <h1 className="text-[32px] font-extrabold leading-tight text-ink">Virtual cards</h1>
            <p className="mt-1 text-sm text-muted">
              Dollar cards for online payments and subscriptions.
            </p>
          </div>
          {!comingSoon && cards.length > 0 && (
            <button
              onClick={createCard}
              disabled={creating}
              aria-label="Create a new card"
              className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-circle text-brand-light active:scale-95 disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Plus className="h-5 w-5" />
              )}
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
        ) : cards.length === 0 ? (
          <>
            <EmptyState
              icon={<CreditCard className="h-7 w-7 text-muted" />}
              title="No cards yet"
              body="Create a virtual dollar card to pay online, subscribe and shop."
            />
            <CreateButton onClick={createCard} busy={creating} />
          </>
        ) : (
          <>
            {activeCard && (
              <CardWallet
                card={activeCard}
                stackCount={cards.length}
                holder={user?.full_name ?? null}
                usdAvailable={usdBalance?.availableFormatted ?? null}
                onUnavailable={() => toast.show(AWAITING_PROVIDER)}
              />
            )}

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

            <QuickLoad
              usdAvailable={usdBalance?.availableFormatted ?? null}
              onPick={() => toast.show(AWAITING_PROVIDER)}
            />

            <CardActivity />

            <CreateButton onClick={createCard} busy={creating} label="Create another card" />
          </>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
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

/**
 * The card and its pocket.
 *
 * The card face sits BEHIND a pocket panel that overlaps it, so only the top
 * band — name, brand, last four, expiry — shows, the way a card sits in a
 * wallet. Any further cards peek out above it as thin stacked edges.
 */
function CardWallet({
  card,
  stackCount,
  holder,
  usdAvailable,
  onUnavailable,
}: {
  card: VirtualCard;
  stackCount: number;
  holder: string | null;
  usdAvailable: string | null;
  onUnavailable: () => void;
}) {
  const frozen = card.status === "frozen";
  const pending = card.status === "pending";

  return (
    <div className="mt-6">
      {/* Stacked edges of the cards behind this one. */}
      {stackCount > 1 && (
        <div
          aria-hidden
          className="mx-auto h-3 rounded-t-2xl bg-brand-light/35"
          style={{ width: "86%" }}
        />
      )}

      <div className="relative">
        {/* The card face. Bottom padding leaves room for the pocket to overlap. */}
        <div className="rounded-2xl bg-gradient-to-br from-brand-light to-brand px-5 pb-16 pt-5 text-white shadow-lg">
          <div className="flex items-start justify-between">
            <p className="max-w-[60%] truncate text-[17px] font-bold tracking-tight">
              {holder ?? "CheqPay card"}
            </p>
            <span className="text-lg font-black italic tracking-tight">
              {card.brand ?? "VISA"}
            </span>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <p className="font-mono text-sm tracking-[0.2em] opacity-90">
              {card.maskedPan ?? "•••• •••• •••• ••••"}
            </p>
            <p className="text-xs font-semibold opacity-80">Valid {expiryLabel(card)}</p>
          </div>
        </div>

        {/* The pocket, overlapping the card. */}
        <div className="-mt-10 rounded-2xl bg-brand p-1.5 shadow-xl">
          <div className="rounded-[14px] border-2 border-dashed border-white/25 px-4 py-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/70">
                Card balance
              </p>
              {(frozen || pending) && (
                <span className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-[11px] font-semibold capitalize text-white">
                  {frozen ? <Snowflake className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
                  {card.status}
                </span>
              )}
            </div>

            {/* No balance until the provider reports one — showing $0.00 would
                read as "empty card" rather than "not known yet". */}
            <p className="mt-1 text-[32px] font-extrabold leading-none text-white">
              <span className="opacity-60">$</span>—
            </p>
            <p className="mt-1.5 text-[11px] text-white/60">Balance shown once the card is live</p>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={onUnavailable}
                className="flex flex-1 items-center justify-center gap-2 rounded-full bg-white/15 py-3 text-sm font-bold text-white active:scale-[0.99]"
              >
                <Plus className="h-4 w-4" /> Add money
              </button>
              <button
                onClick={onUnavailable}
                aria-label="Show card details"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white active:scale-95"
              >
                <Eye className="h-4 w-4" />
              </button>
              <button
                onClick={onUnavailable}
                aria-label={frozen ? "Unfreeze card" : "Freeze card"}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white active:scale-95"
              >
                {frozen ? <Sun className="h-4 w-4" /> : <Snowflake className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {usdAvailable && (
        <p className="mt-3 text-center text-xs text-muted">
          <span className="font-semibold text-ink">{usdAvailable}</span> in your dollar balance to
          load
        </p>
      )}
    </div>
  );
}

/** Fixed load amounts — the card equivalent of the reference's contact row. */
const LOAD_AMOUNTS = [5, 10, 25, 50, 100];

function QuickLoad({
  usdAvailable,
  onPick,
}: {
  usdAvailable: string | null;
  onPick: (amount: number) => void;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-ink">Quick load</h2>
        {usdAvailable && <span className="text-xs text-muted">{usdAvailable} available</span>}
      </div>
      <div className="-mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LOAD_AMOUNTS.map((amount) => (
          <button
            key={amount}
            onClick={() => onPick(amount)}
            className="flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center rounded-2xl bg-card text-ink active:scale-95"
          >
            <span className="text-lg font-extrabold">${amount}</span>
            <span className="mt-0.5 text-[11px] text-muted">load</span>
          </button>
        ))}
        <button
          onClick={() => onPick(0)}
          className="flex h-[76px] w-[76px] shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-border text-brand-light active:scale-95"
        >
          <Plus className="h-5 w-5" />
          <span className="mt-0.5 text-[11px]">Other</span>
        </button>
      </div>
    </section>
  );
}

function CardActivity() {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold text-ink">Card activity</h2>
      <div className="mt-3 flex flex-col items-center rounded-2xl bg-card px-5 py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-circle">
          <Lock className="h-5 w-5 text-muted" />
        </span>
        <p className="mt-3 text-sm font-semibold text-ink">Nothing to show yet</p>
        <p className="mt-1 max-w-[260px] text-xs text-muted">
          Once your card is live, everything you spend on it appears here.
        </p>
      </div>
    </section>
  );
}
