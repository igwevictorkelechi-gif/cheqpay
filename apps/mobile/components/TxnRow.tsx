import React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from './brand';
import type { LedgerTransaction } from '@/services/api';

function icon(type: LedgerTransaction['type']): {
  name: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  bg: string;
} {
  switch (type) {
    case 'DEPOSIT':
      return { name: 'arrow-down', color: '#34C759', bg: 'rgba(52,199,89,0.15)' };
    case 'WITHDRAWAL':
      return { name: 'arrow-up', color: '#FF6B6B', bg: 'rgba(255,107,107,0.15)' };
    case 'CONVERT':
      return { name: 'sync', color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' };
    case 'BILL':
      return { name: 'flash', color: '#FBBF24', bg: 'rgba(251,191,36,0.15)' };
    default:
      return { name: 'swap-horizontal', color: '#A78BFA', bg: 'rgba(167,139,250,0.15)' };
  }
}

function title(t: LedgerTransaction): string {
  switch (t.type) {
    case 'DEPOSIT':
      return `Received ${t.asset}`;
    case 'WITHDRAWAL':
      return `Sent ${t.asset}`;
    case 'BUY':
      return `Bought ${t.toAsset ?? t.asset}`;
    case 'SELL':
      return `Sold ${t.fromAsset ?? t.asset}`;
    case 'CONVERT':
      return `Convert ${t.fromAsset ?? '?'} → ${t.toAsset ?? '?'}`;
    case 'BILL':
      return t.planName
        ? `${t.billerName ?? t.service ?? 'Bill'} · ${t.planName}`
        : t.billerName ?? t.service ?? 'Bill';
    default:
      return t.type;
  }
}

function fmt(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 8 }) : v;
}

function amount(t: LedgerTransaction): { text: string; positive: boolean } {
  if (t.type === 'DEPOSIT') return { text: `+${fmt(t.amountFormatted)} ${t.asset}`, positive: true };
  if (t.type === 'WITHDRAWAL') return { text: `-${fmt(t.amountFormatted)} ${t.asset}`, positive: false };
  if (t.type === 'BILL') return { text: `-₦${fmt(t.amountFormatted)}`, positive: false };
  if (t.toAsset && t.toFormatted) return { text: `+${fmt(t.toFormatted)} ${t.toAsset}`, positive: true };
  return { text: `${fmt(t.amountFormatted)} ${t.asset}`, positive: true };
}

export function TxnRow({ t, divider }: { t: LedgerTransaction; divider?: boolean }) {
  const ic = icon(t.type);
  const amt = amount(t);
  return (
    <View
      className="flex-row items-center py-3"
      style={divider ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
    >
      <View
        className="w-10 h-10 rounded-full items-center justify-center"
        style={{ backgroundColor: ic.bg }}
      >
        <Ionicons name={ic.name} size={20} color={ic.color} />
      </View>
      <View className="ml-3 flex-1">
        <Text className="text-ink font-bold" numberOfLines={1}>
          {title(t)}
        </Text>
        <Text className="text-muted text-xs mt-0.5">
          {new Date(t.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}
        </Text>
      </View>
      <Text className="font-bold" style={{ color: amt.positive ? colors.positive : colors.ink }}>
        {amt.text}
      </Text>
    </View>
  );
}
