import { useCallback, useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Share, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { colors, Card } from '@/components/brand';
import { api, ApiError, type MyReferral, type ReferralEarning } from '@/services/api';

const KIND_LABEL: Record<ReferralEarning['kind'], string> = {
  BASIC_BONUS: 'Referral bonus',
  WELCOME_BONUS: 'Welcome bonus',
  COMMISSION: 'Commission',
  TASK: 'Task reward',
};

export default function ReferScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<MyReferral | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api.getMyReferral().then(setData).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load your referrals."));
  }, []);
  useEffect(load, [load]);

  async function copy() {
    if (!data) return;
    await Clipboard.setStringAsync(data.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function share() {
    if (!data) return;
    await Share.share({ message: `Join me on CheqPay — send money, pay bills and trade crypto from one balance. Use my code ${data.code}: ${data.link}` }).catch(() => undefined);
  }

  async function apply() {
    setApplying(true);
    setApplyMsg(null);
    try {
      const r = await api.applyReferral(code);
      setApplyMsg({ ok: true, text: `Done — you were invited by ${r.referrerName}.` });
      setCode('');
      load();
    } catch (e) {
      setApplyMsg({ ok: false, text: e instanceof ApiError ? e.message : "Couldn't add that code." });
    } finally {
      setApplying(false);
    }
  }

  const influencer = data?.kind === 'INFLUENCER';

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => router.back()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="arrow-back" size={20} color={colors.ink} />
        </TouchableOpacity>
        <Text style={{ color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 12 }}>Refer &amp; earn</Text>

        {!data ? (
          error ? <Card className="mt-4"><Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>{error}</Text></Card>
          : <ActivityIndicator color={colors.muted} style={{ marginTop: 60 }} />
        ) : (
          <>
            <Text style={{ color: colors.muted, marginTop: 6, lineHeight: 20 }}>
              {influencer
                ? "You're in the influencer program — you earn a share of the fees on everything your referrals do."
                : `When a friend verifies their identity and makes a first transaction of ${data.qualifyMinFormatted} or more, you get ${data.basicBonusFormatted}.`}
            </Text>

            <View style={{ backgroundColor: colors.brand, borderRadius: 24, padding: 20, marginTop: 16 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '700', letterSpacing: 2 }}>YOUR CODE</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ color: '#fff', fontSize: 30, fontWeight: '800', letterSpacing: 2 }}>{data.code}</Text>
                <TouchableOpacity onPress={copy} style={{ backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 14, height: 40, flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '600', marginLeft: 6 }}>{copied ? 'Copied' : 'Copy'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={share} style={{ backgroundColor: '#fff', borderRadius: 999, paddingVertical: 14, alignItems: 'center', marginTop: 14, flexDirection: 'row', justifyContent: 'center' }}>
                <Ionicons name="share-social-outline" size={18} color={colors.brand} />
                <Text style={{ color: colors.brand, fontWeight: '800', marginLeft: 6 }}>Share invite</Text>
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
              {[
                ['Joined', String(data.counts.signedUp)],
                ['Qualified', String(data.counts.qualified)],
                ['Earned', data.totals.lifetimeFormatted],
              ].map(([l, v]) => (
                <View key={l} style={{ width: '31.5%', backgroundColor: colors.card, borderRadius: 20, padding: 14, alignItems: 'center' }}>
                  <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{v}</Text>
                  <Text style={{ color: colors.muted, fontSize: 12 }}>{l}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity onPress={() => Linking.openURL(data.portalUrl)} style={{ backgroundColor: colors.card, borderRadius: 24, padding: 18, marginTop: 12, flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={influencer ? 'stats-chart-outline' : 'sparkles-outline'} size={22} color="#F5C97B" />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: colors.ink, fontWeight: '700' }}>{influencer ? 'Open your influencer dashboard' : 'Are you a creator?'}</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>
                  {influencer ? 'Clicks, sign-ups, commission and tasks' : data.application?.status === 'PENDING' ? 'Your application is being reviewed.' : 'Join the influencer program'}
                </Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.muted} />
            </TouchableOpacity>

            {data.canApply && (
              <Card className="mt-3">
                <Text style={{ color: colors.ink, fontWeight: '700' }}>Were you invited?</Text>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>Add your friend&apos;s code within your first 7 days.</Text>
                <View style={{ flexDirection: 'row', marginTop: 10 }}>
                  <TextInput value={code} onChangeText={(t) => setCode(t.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20))} placeholder="Enter code" placeholderTextColor={colors.muted} autoCapitalize="characters"
                    style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: colors.ink }} />
                  <TouchableOpacity onPress={apply} disabled={applying || code.length < 4} style={{ backgroundColor: colors.brand, borderRadius: 14, paddingHorizontal: 18, justifyContent: 'center', marginLeft: 8, opacity: applying || code.length < 4 ? 0.4 : 1 }}>
                    {applying ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Add</Text>}
                  </TouchableOpacity>
                </View>
                {applyMsg && <Text style={{ color: applyMsg.ok ? '#16A34A' : '#EF4444', fontSize: 12, marginTop: 8 }}>{applyMsg.text}</Text>}
              </Card>
            )}

            <Card className="mt-3">
              <Text style={{ color: colors.ink, fontWeight: '700', marginBottom: 6 }}>Earnings</Text>
              {data.earnings.length === 0 ? (
                <Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 16 }}>Nothing yet — share your code to get started.</Text>
              ) : (
                data.earnings.map((e) => (
                  <View key={e.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.ink, fontWeight: '600' }}>{KIND_LABEL[e.kind]}{e.kind === 'TASK' && e.note ? `: ${e.note}` : ''}</Text>
                      <Text style={{ color: colors.muted, fontSize: 12 }}>
                        {e.status === 'PAID' ? 'Paid' : e.status === 'VOID' ? 'Cancelled' : `On hold until ${new Date(e.releaseAt).toLocaleDateString('en-NG')}`}
                      </Text>
                    </View>
                    <Text style={{ color: e.status === 'VOID' ? colors.muted : colors.ink, fontWeight: '800', textDecorationLine: e.status === 'VOID' ? 'line-through' : 'none' }}>+{e.amountFormatted}</Text>
                  </View>
                ))
              )}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}
