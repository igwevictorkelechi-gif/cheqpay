import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from './brand';

/**
 * The sign-in screens' frame, matching the website's AuthLayout: the app icon
 * and wordmark, the form in one rounded card, and the footer line beneath.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.backdrop }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
      >
        <View style={{ alignItems: 'center', marginBottom: 28 }}>
          <Image source={require('../assets/brand-icon.png')} style={{ width: 60, height: 60, borderRadius: 16 }} />
          <Text style={{ marginTop: 12, fontSize: 22, fontWeight: '800', color: colors.ink, letterSpacing: -0.4 }}>CheqPay</Text>
          <Text style={{ fontSize: 11, fontWeight: '500', color: colors.muted, letterSpacing: 2.2 }}>BEYOND FINANCE</Text>
        </View>
        <View
          style={{
            borderRadius: 24,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
            padding: 28,
          }}
        >
          {children}
        </View>
        <Text style={{ marginTop: 22, textAlign: 'center', fontSize: 13, color: colors.muted }}>
          © 2026 CheqPay. All rights reserved.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AuthTitle({ title, subtitle }: { title: string; subtitle?: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 }}>{title}</Text>
      {subtitle ? <Text style={{ marginTop: 6, fontSize: 13, color: colors.muted, lineHeight: 19 }}>{subtitle}</Text> : null}
    </View>
  );
}

/** Label + input, styled like the website's `.label` and `.input`. */
export function AuthField({ label, hint, style, ...props }: TextInputProps & { label: string; hint?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ marginBottom: 6, fontSize: 13, fontWeight: '500', color: colors.muted }}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          {
            borderRadius: 12,
            borderWidth: 1,
            borderColor: focused ? colors.brand : colors.border,
            backgroundColor: colors.surface,
            paddingHorizontal: 15,
            paddingVertical: 12,
            fontSize: 15,
            color: colors.ink,
          },
          style,
        ]}
      />
      {hint ? <Text style={{ marginTop: 5, fontSize: 12, color: colors.muted }}>{hint}</Text> : null}
    </View>
  );
}

/** The full-width pill button (the website's `.btn-primary`). */
export function AuthButton({
  label,
  onPress,
  loading,
  disabled,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || loading;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={off}
      style={{
        marginTop: 4,
        minHeight: 48,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.brand,
        opacity: off && !loading ? 0.5 : 1,
        shadowColor: colors.brand,
        shadowOpacity: 0.3,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 4,
      }}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>{label}</Text>}
    </TouchableOpacity>
  );
}

export function AuthError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <View style={{ marginBottom: 14, borderRadius: 10, backgroundColor: 'rgba(239,68,68,0.10)', padding: 12 }}>
      <Text style={{ fontSize: 13, color: '#F87171' }}>{message}</Text>
    </View>
  );
}

/** The divider-topped line at the bottom of the card ("Don't have an account? Sign up"). */
export function AuthFooter({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  return (
    <View style={{ marginTop: 22, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20, flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{prompt} </Text>
      <TouchableOpacity onPress={onPress} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: colors.brandLight }}>{action}</Text>
      </TouchableOpacity>
    </View>
  );
}
