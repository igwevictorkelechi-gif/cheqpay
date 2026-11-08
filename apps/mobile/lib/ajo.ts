import type { AjoFrequency } from '@/services/api';

/** "₦25,000" from a naira string such as "25000.00". */
export const ngn = (v: string | number) =>
  '₦' + Number(v).toLocaleString('en-NG', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

export const every: Record<AjoFrequency, string> = { daily: 'day', weekly: 'week', monthly: 'month' };

export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '';

/** What a member agrees to when they create or join a group. Shown before the PIN. */
export const GROUP_TERMS = [
  'Your contribution is taken from your CheqPay wallet automatically at 9am on each due date.',
  'Each round, one member collects everything paid in. The order is fixed when the group starts.',
  'If your wallet is short, you owe that round’s collector. Money that comes into your wallet goes to them first.',
  'While you owe, withdrawals, transfers and purchases are paused, and you can’t join other groups.',
  'Only join people you trust. CheqPay doesn’t cover a member who doesn’t pay.',
];
