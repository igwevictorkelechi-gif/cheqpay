import type { AjoFrequency, AjoPlan } from '@/services/api';

/** "₦25,000" from a naira string such as "25000.00". */
export const ngn = (v: string | number) =>
  '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const every: Record<AjoFrequency, string> = { daily: 'day', weekly: 'week', monthly: 'month' };
export const everyPlural: Record<AjoFrequency, string> = { daily: 'days', weekly: 'weeks', monthly: 'months' };

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '';

/** Where an invite link lands: the web app opens the join screen with the code filled in. */
export const inviteUrl = (code: string) => `https://mycheqpay.com/ajo?code=${encodeURIComponent(code)}`;

/** What a member agrees to when they create or join a group. Shown before the PIN. */
export const GROUP_TERMS = [
  'Your contribution is taken from your CheqPay wallet automatically at 9am on each due date.',
  'Each round, one member collects everything paid in. The order is fixed when the group starts.',
  'If your wallet is short, you owe that round’s collector. Money that comes into your wallet goes to them first.',
  'While you owe, withdrawals, transfers and purchases are paused, and you can’t join other groups.',
  'Only join people you trust. CheqPay doesn’t cover a member who doesn’t pay.',
];

/** Goal chips on the new-plan screen. The emoji becomes the plan's icon. */
export const GOALS: { emoji: string; label: string }[] = [
  { emoji: '🏠', label: 'Rent' },
  { emoji: '📱', label: 'New phone' },
  { emoji: '✈️', label: 'Japa fund' },
  { emoji: '🎓', label: 'School fees' },
  { emoji: '🎉', label: 'Detty December' },
  { emoji: '💻', label: 'Laptop' },
  { emoji: '🛡️', label: 'Emergency' },
  { emoji: '💍', label: 'Wedding' },
  { emoji: '🚗', label: 'Car' },
  { emoji: '👗', label: 'Fits' },
];

/** One-tap starting points. People tweak from here instead of staring at empty boxes. */
export const PRESETS: { label: string; amount: string; frequency: AjoFrequency; count: number }[] = [
  { label: '₦500 a day · 30 days', amount: '500', frequency: 'daily', count: 30 },
  { label: '₦1,000 a day · 90 days', amount: '1000', frequency: 'daily', count: 90 },
  { label: '₦5,000 a week · 12 weeks', amount: '5000', frequency: 'weekly', count: 12 },
  { label: '₦20,000 a month · 6 months', amount: '20000', frequency: 'monthly', count: 6 },
];

/**
 * Split a plan name like "🏠 Rent" into its icon and the words. Names typed
 * without an emoji get the piggy bank.
 */
export function splitGoal(name: string): { emoji: string; label: string } {
  const chars = Array.from(name.trim());
  const cp = chars[0]?.codePointAt(0) ?? 0;
  if (cp > 0x2000) {
    let n = 1;
    // Keep a variation selector (✈️) or a joined sequence (🏋️‍♀️) with its base.
    while (n < chars.length && [0xfe0f, 0x200d].includes(chars[n].codePointAt(0) ?? 0)) n += chars[n].codePointAt(0) === 0x200d ? 2 : 1;
    return { emoji: chars.slice(0, n).join(''), label: chars.slice(n).join('').trim() || name.trim() };
  }
  return { emoji: '🐷', label: name.trim() };
}

/** "Today, 9am" · "Tomorrow, 9am" · "In 3 days" · "12 Mar". */
export function dueLabel(iso: string | null): string {
  if (!iso) return '';
  const due = new Date(iso);
  const now = new Date();
  const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((dayOf(due) - dayOf(now)) / 86_400_000);
  if (days <= 0) return 'Today, 9am';
  if (days === 1) return 'Tomorrow, 9am';
  if (days < 7) return `In ${days} days`;
  return shortDate(iso);
}

/** How far along a plan is, 0–100, by money saved against the goal. */
export function planPct(p: Pick<AjoPlan, 'saved' | 'target'>): number {
  return Math.min(100, Math.round((Number(p.saved) / Math.max(1, Number(p.target))) * 100));
}

const AVATAR_COLORS = ['#6B5B95', '#E8628C', '#2BB673', '#F59E0B', '#3B82F6', '#14B8A6', '#A855F7', '#EF4444'];

/** A steady colour per username, so the same person looks the same everywhere. */
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase();
