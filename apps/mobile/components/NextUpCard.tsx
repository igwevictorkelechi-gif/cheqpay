import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { api, type NextUpItem } from '@/services/api';
import { readCache, writeCache } from '@/lib/cache';
import { colors, CapsLabel, cardEdge } from '@/components/brand';

const CACHE = 'cheqpay:home:nextup';

/** "TODAY", "TMR", or the weekday ("FRI"), in Lagos time. */
function dayLabel(due: Date, now: Date): string {
  const lagos = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
  if (lagos(due) === lagos(now)) return 'Today';
  if (lagos(due) === lagos(new Date(now.getTime() + 86_400_000))) return 'Tmr';
  return due.toLocaleDateString('en-NG', { weekday: 'short', timeZone: 'Africa/Lagos' });
}

function money(item: NextUpItem): string {
  if (item.amountMinor === null) return 'Varies';
  const naira = Number(BigInt(item.amountMinor)) / 100;
  const text = `₦${naira.toLocaleString('en-NG', { maximumFractionDigits: naira % 1 ? 2 : 0 })}`;
  return item.direction === 'in' ? `+${text}` : `−${text}`;
}

function open(item: NextUpItem) {
  if (item.kind === 'bill_autopay') router.push('/(app)/pay-bill');
  else if (item.kind === 'ajo_plan') router.push('/(app)/ajo');
  else router.push(`/(app)/ajo-group/${item.id}`);
}

/**
 * v2 "Next up": the money that will move on its own soon. Agenda rows with no
 * icon — a date block, a 2px rail, title and meta, the amount. The rail on the
 * soonest row is the screen's one brand accent. Hidden when nothing is due.
 */
export default function NextUpCard() {
  const [items, setItems] = useState<NextUpItem[]>([]);

  useEffect(() => {
    let active = true;
    readCache<NextUpItem[]>(CACHE).then((cached) => {
      if (active && cached) setItems((now) => (now.length ? now : cached));
    });
    api
      .getNextUp()
      .then(({ items }) => {
        if (!active) return;
        setItems(items);
        writeCache(CACHE, items);
      })
      .catch(() => {
        /* Not essential to Home: keep whatever was cached. */
      });
    return () => {
      active = false;
    };
  }, []);

  if (items.length === 0) return null;
  const now = new Date();
  return (
    <View className="px-5 mb-6">
      <CapsLabel style={{ marginBottom: 10 }}>Next up</CapsLabel>
      <View className="rounded-3xl overflow-hidden" style={[{ backgroundColor: colors.card }, cardEdge()]}>
        {items.map((item, i) => {
          const due = new Date(item.dueAt);
          return (
            <TouchableOpacity
              key={`${item.kind}:${item.id}`}
              activeOpacity={0.7}
              onPress={() => open(item)}
              className="flex-row items-stretch pl-4"
            >
              <View className="items-center justify-center" style={{ width: 36, paddingVertical: 14 }}>
                <CapsLabel>{dayLabel(due, now)}</CapsLabel>
                <Text style={{ color: colors.ink, fontSize: 17, lineHeight: 22, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {due.toLocaleDateString('en-NG', { day: 'numeric', timeZone: 'Africa/Lagos' })}
                </Text>
              </View>
              <View
                style={{
                  width: 2,
                  marginVertical: 12,
                  marginLeft: 14,
                  borderRadius: 1,
                  backgroundColor: i === 0 ? colors.brand : colors.hairline,
                }}
              />
              <View
                className="flex-1 flex-row items-center pr-4"
                style={[
                  { marginLeft: 14, paddingVertical: 14 },
                  i > 0 ? { borderTopWidth: 1, borderTopColor: colors.hairline } : null,
                ]}
              >
                <View className="flex-1">
                  <Text numberOfLines={1} style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>
                    {item.title}
                  </Text>
                  <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 13, marginTop: 1 }}>
                    {due.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' })} · {item.detail}
                  </Text>
                </View>
                <Text
                  style={{
                    color: item.direction === 'in' ? colors.positive : colors.ink,
                    fontSize: 15,
                    fontWeight: '600',
                    marginLeft: 8,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {money(item)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
