import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { colors } from '@/components/brand';
import { api, ApiError } from '@/services/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const GREETING: ChatMessage = {
  role: 'assistant',
  content:
    "Hi, I'm Cheq — your CheqPay assistant. Ask me anything about deposits, withdrawals, crypto, bills or your account.",
};

const SUGGESTIONS = [
  'How do I fund my account?',
  'Where is my electricity token?',
  'How long do withdrawals take?',
  'What are the fees?',
];

export default function SupportChatScreen() {
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setInput('');
    const next: ChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setSending(true);
    try {
      const thread = next.slice(1).slice(-20); // drop client-side greeting
      const res = await api.supportChat(thread);
      setMessages([...next, { role: 'assistant', content: res.reply }]);
    } catch (e) {
      const msg =
        e instanceof ApiError && e.status === 401
          ? 'Your session has expired — please sign in again to chat.'
          : "I couldn't send that. Check your connection, or email support@cheqpay.com.";
      setMessages([...next, { role: 'assistant', content: msg }]);
    } finally {
      setSending(false);
    }
  }

  const showSuggestions = messages.length === 1 && !sending;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
      keyboardVerticalOffset={0}
    >
      <View className="flex-1" style={{ backgroundColor: colors.surface, paddingTop: insets.top }}>
        <View className="flex-row items-center px-5 pt-3 pb-3" style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 rounded-full bg-card items-center justify-center">
            <Ionicons name="chevron-back" size={22} color={colors.ink} />
          </TouchableOpacity>
          <View className="w-10 h-10 rounded-full items-center justify-center ml-3" style={{ backgroundColor: colors.brand }}>
            <Ionicons name="sparkles" size={20} color="#FFFFFF" />
          </View>
          <View className="ml-3">
            <Text className="text-ink font-bold">Cheq · AI assistant</Text>
            <Text className="text-muted text-xs">Answers from our help center</Text>
          </View>
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, gap: 12 }} className="flex-1">
          {messages.map((m, i) => (
            <View key={i} className={m.role === 'user' ? 'items-end' : 'items-start'}>
              <View
                className="rounded-2xl px-4 py-3"
                style={{
                  maxWidth: '85%',
                  backgroundColor: m.role === 'user' ? colors.brand : colors.card,
                  borderBottomRightRadius: m.role === 'user' ? 6 : 16,
                  borderBottomLeftRadius: m.role === 'user' ? 16 : 6,
                }}
              >
                <Text style={{ color: m.role === 'user' ? '#FFFFFF' : colors.ink }} className="text-sm leading-5">
                  {m.content}
                </Text>
              </View>
            </View>
          ))}
          {sending && (
            <View className="items-start">
              <View className="rounded-2xl px-4 py-3" style={{ backgroundColor: colors.card, borderBottomLeftRadius: 6 }}>
                <Text style={{ color: colors.muted }}>…</Text>
              </View>
            </View>
          )}
          {showSuggestions && (
            <View className="flex-row flex-wrap" style={{ gap: 8 }}>
              {SUGGESTIONS.map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => send(s)}
                  className="rounded-full px-3.5 py-2"
                  style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
                >
                  <Text className="text-ink text-xs font-semibold">{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>

        <View
          className="flex-row items-center px-4 py-3"
          style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: insets.bottom + 10, gap: 8 }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask a question…"
            placeholderTextColor={colors.muted}
            maxLength={2000}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            className="flex-1 rounded-2xl px-4 text-ink"
            style={{ height: 48, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
          />
          <TouchableOpacity
            onPress={() => send(input)}
            disabled={!input.trim() || sending}
            className="w-12 h-12 rounded-2xl items-center justify-center"
            style={{ backgroundColor: colors.brand, opacity: input.trim() && !sending ? 1 : 0.4 }}
          >
            <Ionicons name="send" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
