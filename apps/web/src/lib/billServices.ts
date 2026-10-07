import {
  CalendarDays,
  Dice5,
  Gift,
  Laptop,
  Megaphone,
  Smartphone,
  Ticket,
  Tv,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { LedgerTransaction } from "@/services/api";

/** One tile on the Pay bills screen. `bill` tiles earn bill cashback. */
export interface BillTile {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  route?: string;
  badge?: "New" | "Soon";
  bill?: boolean;
  /** Only shown when this feature flag is on. */
  flag?: "gift_cards_sell" | "ads";
}

export interface BillSection {
  title: string;
  tiles: BillTile[];
}

export const BILL_SECTIONS: BillSection[] = [
  {
    title: "Mobile",
    tiles: [
      { key: "airtime", label: "Airtime", icon: Smartphone, color: "#7C5CFF", route: "/pay-bill/airtime", bill: true },
      { key: "data", label: "Data", icon: Wifi, color: "#2E8BFF", route: "/pay-bill/data", bill: true },
    ],
  },
  {
    title: "Bills & utilities",
    tiles: [
      { key: "electricity", label: "Electricity", icon: Zap, color: "#F5A623", route: "/pay-bill/electricity", bill: true },
      { key: "cabletv", label: "Cable TV", icon: Tv, color: "#EC4899", route: "/pay-bill/cabletv", bill: true },
    ],
  },
  {
    title: "Play & lifestyle",
    tiles: [{ key: "betting", label: "Betting", icon: Dice5, color: "#16A34A", route: "/pay-bill/betting", bill: true }],
  },
  {
    title: "Shop",
    tiles: [
      { key: "gadgets", label: "Gadgets", icon: Laptop, color: "#0EA5A0", route: "/gadgets", badge: "New" },
      { key: "events", label: "Events", icon: CalendarDays, color: "#7C3AED", route: "/events", badge: "New" },
      { key: "giftcards", label: "Gift cards", icon: Gift, color: "#F59E0B", route: "/gift-cards", badge: "New", flag: "gift_cards_sell" },
      { key: "vouchers", label: "Vouchers", icon: Ticket, color: "#6E6880", badge: "Soon" },
    ],
  },
  {
    title: "Grow your business",
    tiles: [{ key: "advertise", label: "Advertise", icon: Megaphone, color: "#E8628C", route: "/advertise", badge: "New", flag: "ads" }],
  },
];

export const tileFor = (service: string | null): BillTile | undefined =>
  BILL_SECTIONS.flatMap((s) => s.tiles).find((t) => t.bill && t.key === service);

/** "0803•••4412": enough to recognise, not enough to read off a shoulder-surf. */
export function maskCustomer(c: string): string {
  const v = c.replace(/\s+/g, "");
  return v.length <= 7 ? v : `${v.slice(0, 4)}•••${v.slice(-3)}`;
}

/** "2%", "1.5%" from basis points. */
export const pctLabel = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1).replace(/\.0$/, "")}%`;

export interface RecentBill {
  service: string;
  billerId: string | null;
  billerName: string;
  customer: string;
  amount: string;
  amountFormatted: string;
  planId: string | null;
  planName: string | null;
}

/** The latest completed bill per (service, customer), newest first. */
export function recentBills(txns: LedgerTransaction[], max = 6): RecentBill[] {
  const out: RecentBill[] = [];
  const seen = new Set<string>();
  for (const t of txns) {
    if (t.type !== "BILL" || t.status !== "COMPLETED" || !t.service || !t.customer || !tileFor(t.service)) continue;
    const k = `${t.service}|${t.customer.replace(/\s+/g, "")}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      service: t.service,
      billerId: t.billerId ?? null,
      billerName: t.billerName ?? tileFor(t.service)!.label,
      customer: t.customer,
      amount: t.amountFormatted,
      amountFormatted: `₦${Number(t.amountFormatted).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`,
      planId: t.planId ?? null,
      planName: t.planName ?? null,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Link into the service flow with everything prefilled. */
export function payAgainHref(r: RecentBill, billerId: string | null): string {
  const q = new URLSearchParams();
  if (billerId) q.set("biller", billerId);
  q.set("customer", r.customer);
  if (r.planId) q.set("plan", r.planId);
  else if (r.planName) q.set("planName", r.planName);
  else q.set("amount", String(Number(r.amount)));
  return `/pay-bill/${r.service}/?${q.toString()}`;
}
