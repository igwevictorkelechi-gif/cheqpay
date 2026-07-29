"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CreditCard, Loader2, Plus, Search, Snowflake } from "lucide-react";
import AppShell from "@/components/AppShell";
import { TopBar, useToast } from "@/components/MobileUI";
import { useAuthStore } from "@/store";
import { api, ApiError, type VirtualCard } from "@/services/api";
import { useFeatures } from "@/lib/useFeatures";

/**
 * Virtual USD cards, issued via Maplerad. Ships behind two gates: the admin
 * `virtual_cards` feature flag AND a configured Maplerad key on the API. Until
 * both are on, the page shows a friendly "coming soon" state — no card is ever
 * created against an unverified provider.
 */
export default function CardsPage() {
  const router = useRouter();
  const features = useFeatures();
  const { user } = useAuthStore();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [cards, setCards] = useState<VirtualCard[]>([]);
  const [available, setAvailable] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getCards()
      .then(({ cards, available }) => {
        if (!active) return;
        setCards(cards);
        setAvailable(available);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  async function createCard() {
    setError(null);
    setCreating(true);
    try {
      const { card } = await api.createCard();
      setCards((prev) => [card, ...prev]);
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : "Couldn’t create a card right now. Please try again."
      );
    } finally {
      setCreating(false);
    }
  }

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

      <div className="flex flex-col px-5 pb-6">
        <h1 className="mt-3 text-[32px] font-extrabold text-ink">Virtual cards</h1>
        <p className="mt-1 text-sm text-muted">
          Dollar cards for online payments, subscriptions and shopping.
        </p>

        {loading ? (
          <div className="mt-16 flex justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-muted" />
          </div>
        ) : comingSoon ? (
          <div className="mt-10 flex flex-col items-center text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-circle">
              <CreditCard className="h-7 w-7 text-brand-light" />
            </span>
            <p className="mt-4 text-lg font-bold text-ink">Coming soon</p>
            <p className="mt-1 max-w-[300px] text-sm text-muted">
              USD virtual cards are on the way. We’ll let you know the moment they’re ready to
              create.
            </p>
          </div>
        ) : (
          <>
            {cards.length === 0 ? (
              <div className="mt-10 flex flex-col items-center text-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-circle">
                  <CreditCard className="h-7 w-7 text-muted" />
                </span>
                <p className="mt-4 font-bold text-ink">No cards yet</p>
                <p className="mt-1 max-w-[280px] text-sm text-muted">
                  Create a virtual dollar card to pay online.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-2xl bg-gradient-to-br from-brand to-brand-dark p-5 text-white shadow-lg"
                  >
                    <div className="flex items-start justify-between">
                      <span className="text-sm font-semibold opacity-80">{c.currency} Virtual</span>
                      {c.status !== "active" && (
                        <span className="flex items-center gap-1 rounded-full bg-black/25 px-2 py-0.5 text-xs font-semibold capitalize">
                          <Snowflake className="h-3 w-3" /> {c.status}
                        </span>
                      )}
                    </div>
                    <p className="mt-8 font-mono text-lg tracking-widest">
                      {c.maskedPan ?? "•••• •••• •••• ••••"}
                    </p>
                    <p className="mt-2 text-xs uppercase tracking-wide opacity-70">
                      {c.brand ?? "CheqPay"}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

            <button
              onClick={createCard}
              disabled={creating}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-4 font-bold text-brand-light active:scale-[0.99] disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
              {creating ? "Creating…" : "Create a new card"}
            </button>
          </>
        )}
      </div>
    </AppShell>
  );
}
