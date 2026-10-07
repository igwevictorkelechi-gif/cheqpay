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

/** 1 → "1st", 10 → "10th", 22 → "22nd". */
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
