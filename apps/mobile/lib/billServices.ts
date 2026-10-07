import type { Ionicons } from '@expo/vector-icons';

type IconName = keyof typeof Ionicons.glyphMap;

/** One tile on the Pay bills screen. `bill` tiles earn bill cashback. */
export interface BillTile {
  key: string;
  label: string;
  icon: IconName;
  color: string;
  route?: string;
  badge?: 'New' | 'Soon';
  bill?: boolean;
  /** Only shown when this feature flag is on. */
  flag?: 'gift_cards_sell' | 'ads';
}

export interface BillSection {
  title: string;
  tiles: BillTile[];
}

export const BILL_SECTIONS: BillSection[] = [
  {
    title: 'Mobile',
    tiles: [
      { key: 'airtime', label: 'Airtime', icon: 'phone-portrait-outline', color: '#7C5CFF', route: '/(app)/bill/airtime', bill: true },
      { key: 'data', label: 'Data', icon: 'wifi-outline', color: '#2E8BFF', route: '/(app)/bill/data', bill: true },
    ],
  },
  {
    title: 'Bills & utilities',
    tiles: [
      { key: 'electricity', label: 'Electricity', icon: 'flash-outline', color: '#F5A623', route: '/(app)/bill/electricity', bill: true },
      { key: 'cabletv', label: 'Cable TV', icon: 'tv-outline', color: '#EC4899', route: '/(app)/bill/cabletv', bill: true },
    ],
  },
  {
    title: 'Play & lifestyle',
    tiles: [
      { key: 'betting', label: 'Betting', icon: 'dice-outline', color: '#16A34A', route: '/(app)/bill/betting', bill: true },
      { key: 'food', label: 'Food delivery', icon: 'bicycle-outline', color: '#EF6C00', route: '/(app)/bill/food', badge: 'New', bill: true },
    ],
  },
  {
    title: 'Shop',
    tiles: [
      { key: 'gadgets', label: 'Gadgets', icon: 'laptop-outline', color: '#0EA5A0', route: '/(app)/gadgets', badge: 'New' },
      { key: 'events', label: 'Events', icon: 'calendar-outline', color: '#7C3AED', route: '/(app)/events', badge: 'New' },
      { key: 'giftcards', label: 'Gift cards', icon: 'gift-outline', color: '#F59E0B', route: '/(app)/gift-cards', badge: 'New', flag: 'gift_cards_sell' },
      { key: 'vouchers', label: 'Vouchers', icon: 'ticket-outline', color: '#6E6880', badge: 'Soon' },
    ],
  },
  {
    title: 'Grow your business',
    tiles: [{ key: 'advertise', label: 'Advertise', icon: 'megaphone-outline', color: '#E8628C', route: '/(app)/advertise', badge: 'New', flag: 'ads' }],
  },
];

export const tileFor = (service: string | null): BillTile | undefined =>
  BILL_SECTIONS.flatMap((s) => s.tiles).find((t) => t.bill && t.key === service);

/** "0803•••412": enough to recognise, not enough to read over a shoulder. */
export function maskCustomer(c: string): string {
  const v = c.replace(/\s+/g, '');
  return v.length <= 7 ? v : `${v.slice(0, 4)}•••${v.slice(-3)}`;
}
