import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@shared/lib/supabase';
import Field from '@/components/Field';
import PrimaryButton from '@/components/PrimaryButton';
import Logo from '@/components/Logo';
import { colors, space } from '@/theme';

/** Sign in to the same account as on desktop (src/app/login/page.tsx). */
export default function LoginScreen() {
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) return setError(error.message);
    if (redirect && redirect.startsWith('/')) router.replace(redirect as never);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: space.lg }}>
          <Logo height={26} />
        </View>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Your watchlist, history, friends and messages — the same as on your computer.</Text>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" placeholder="••••••••" onSubmitEditing={submit} />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
        <PrimaryButton label="Create an account" secondary onPress={() => router.replace({ pathname: '/signup', params: redirect ? { redirect } : {} })} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.lg, paddingTop: space.xxl },
  title: { color: colors.foreground, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.muted, textAlign: 'center', marginTop: -8, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 13 },
});
