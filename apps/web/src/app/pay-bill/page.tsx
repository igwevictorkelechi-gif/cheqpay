"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, ChevronDown, ChevronRight, Percent, RotateCcw, Search } from "lucide-react";
import AppShell from "@/components/AppShell";
import BillerLogo from "@/components/BillerLogo";
import { TopBar, useToast } from "@/components/MobileUI";
import SponsoredCard from "@/components/SponsoredCard";
import { useAuthStore } from "@/store";
import { useFeatures } from "@/lib/useFeatures";
import { api, getAccessToken, type BillCashback, type BillServiceConfig } from "@/services/api";
import { BILL_SECTIONS, maskCustomer, payAgainHref, pctLabel, recentBills, tileFor, type RecentBill } from "@/lib/billServices";

/**
 * Pay bills: "Pay again" for the billers you use, services grouped by what
 * they're for, cashback shown where it applies, and the sponsored slot last —
 * below everything you came here to do.
 */
export default function PayBillPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const toast = useToast();
  const features = useFeatures();
  const [catalog, setCatalog] = useState<BillServiceConfig[]>([]);
  const [cashback, setCashback] = useState<BillCashback | null>(null);
  const [recent, setRecent] = useState<RecentBill[]>([]);

  useEffect(() => {
    let live = true;
    api
      .getBillCatalog()
      .then((r) => {
        if (!live) return;
        setCatalog(r.services);
        setCashback(r.cashback ?? null);
      })
      .catch(() => undefined);
    getAccessToken()
      .then((t) => (t ? api.getTransactions(50, "NGN") : null))
      .then((r) => live && r && setRecent(recentBills(r.transactions)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const back = cashback?.enabled && cashback.billBps > 0 ? pctLabel(cashback.billBps) : null;
  const sections = useMemo(
    () =>
      BILL_SECTIONS.map((s) => ({ ...s, tiles: s.tiles.filter((t) => !t.flag || features[t.flag]) })).filter((s) => s.tiles.length),
    [features],
  );

  // Match each recent payment to today's biller (by id, or by name for older payments).
  const billerFor = (r: RecentBill) => {
    const billers = catalog.find((c) => c.service === r.service)?.billers ?? [];
    return billers.find((b) => b.id === r.billerId) ?? billers.find((b) => b.name.toLowerCase() === r.billerName.toLowerCase()) ?? null;
  };

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

      <div className="mb-5 mt-3 flex items-center justify-between px-5">
        <h1 className="text-2xl font-extrabold text-ink">Pay bills</h1>
        <button
          onClick={() => toast.show("More countries coming soon")}
          className="flex min-h-[40px] items-center gap-1.5 rounded-full bg-circle px-3 py-1.5"
          aria-label="Country: Nigeria"
        >
          <span className="text-sm">🇳🇬</span>
          <span className="text-sm font-semibold text-ink">Nigeria</span>
          <ChevronDown className="h-4 w-4 text-muted" />
        </button>
      </div>

      {recent.length > 0 && (
        <section className="mb-6" aria-label="Pay again">
          <div className="mb-2.5 flex items-center justify-between px-5">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink">
              <RotateCcw className="h-4 w-4 text-brand-light" /> Pay again
            </h2>
            <Link href="/transactions" className="text-sm font-semibold text-brand-light">
              History
            </Link>
          </div>
          <div className="flex snap-x scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recent.map((r) => {
              const b = billerFor(r);
              const tile = tileFor(r.service)!;
              return (
                <button
                  key={`${r.service}|${r.customer}`}
                  onClick={() => router.push(payAgainHref(r, b && !b.comingSoon ? b.id : null))}
                  className="w-[156px] shrink-0 snap-start rounded-2xl bg-card p-3.5 text-left transition active:scale-95"
                >
                  <div className="flex items-center justify-between">
                    {b ? (
                      <BillerLogo brand={b} size={36} />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: `${tile.color}22` }}>
                        <tile.icon className="h-5 w-5" style={{ color: tile.color }} />
                      </span>
                    )}
                    <span className="text-[11px] font-semibold text-muted">{tile.label}</span>
                  </div>
                  <p className="mt-2.5 truncate text-sm font-bold text-ink">{b?.name ?? r.billerName}</p>
                  <p className="truncate text-xs text-muted">{maskCustomer(r.customer)}</p>
                  <p className="mt-2 flex items-center justify-between text-sm">
                    <span className="font-extrabold text-ink">{r.planName && r.service === "data" ? r.planName.split("·")[0].trim() : r.amountFormatted}</span>
                    <span className="flex items-center text-xs font-semibold text-brand-light">
                      Pay <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {back && (
        <div className="mb-6 px-5">
          <div className="flex items-center gap-3 rounded-3xl border border-amber-400/30 bg-gradient-to-r from-amber-400/15 to-brand/15 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-400 text-black">
              <Percent className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-bold text-ink">Get {back} back on every bill</p>
              <p className="text-xs text-muted">
                Airtime, data, power, TV and more{cashback && cashback.maxNgn > 0 ? ` · up to ₦${cashback.maxNgn.toLocaleString("en-NG")} each time` : ""}. Added to your balance.
              </p>
            </div>
          </div>
        </div>
      )}

      {sections.map((s) => (
        <section key={s.title} className="mb-6 px-5">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted">{s.title}</h2>
          <div className="grid grid-cols-4 gap-3 lg:grid-cols-6">
            {s.tiles.map((t) => (
              <button
                key={t.key}
                onClick={() => (t.route ? router.push(t.route) : toast.show(`${t.label} — coming soon`))}
                className="relative flex flex-col items-center gap-2 rounded-2xl bg-card px-1 pb-3 pt-3.5 transition active:scale-95"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: `${t.color}22` }}>
                  <t.icon className="h-6 w-6" style={{ color: t.color }} />
                </span>
                <span className="text-center text-xs font-semibold leading-tight text-ink">{t.label}</span>
                {t.bill && back ? (
                  <span className="absolute -top-2 right-1 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-extrabold text-black">{back} back</span>
                ) : t.badge ? (
                  <span className={`absolute -top-2 right-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${t.badge === "Soon" ? "bg-circle text-muted" : "bg-brand text-white"}`}>
                    {t.badge}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </section>
      ))}

      <div className="mb-6 px-5">
        <SponsoredCard placement="paybills" />
      </div>

      {toast.node}
    </AppShell>
  );
}
