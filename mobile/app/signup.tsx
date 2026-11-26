import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@shared/lib/supabase';
import { isUsernameAvailable } from '@shared/lib/friends';
import Field from '@/components/Field';
import PrimaryButton from '@/components/PrimaryButton';
import { colors, space } from '@/theme';

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
type UsernameState = 'empty' | 'invalid' | 'checking' | 'available' | 'taken';

/** A new account, shared with the desktop app (src/app/signup/page.tsx). */
export default function SignupScreen() {
  const { redirect } = useLocalSearchParams<{ redirect?: string }>();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [usernameState, setUsernameState] = useState<UsernameState>('empty');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return setUsernameState('empty');
    if (!USERNAME_PATTERN.test(username)) return setUsernameState('invalid');
    setUsernameState('checking');
    let live = true;
    const t = setTimeout(async () => {
      try {
        const free = await isUsernameAvailable(username);
        if (live) setUsernameState(free ? 'available' : 'taken');
      } catch {
        if (live) setUsernameState('available');
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [username]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim(), username } } });
    setBusy(false);
    if (error) return setError(error.message);
    Alert.alert('Check your email', 'Confirm your address from the email we sent, then sign in.', [
      { text: 'OK', onPress: () => router.replace({ pathname: '/login', params: redirect ? { redirect } : {} }) },
    ]);
  };

  const hint =
    usernameState === 'invalid'
      ? '3–20 lowercase letters, numbers or underscores.'
      : usernameState === 'taken'
        ? 'That username is already taken.'
        : usernameState === 'available'
          ? `@${username} is available.`
          : usernameState === 'checking'
            ? 'Checking…'
            : 'How friends find you.';

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Join Lwedflix</Text>
        <Field label="Name" value={name} onChangeText={setName} autoComplete="name" placeholder="Your name" />
        <Field
          label="Username"
          value={username}
          onChangeText={(t) => setUsername(t.toLowerCase())}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="username"
          hint={hint}
          hintColor={usernameState === 'taken' || usernameState === 'invalid' ? colors.danger : usernameState === 'available' ? colors.accent : undefined}
        />
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" placeholder="you@example.com" />
        <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" placeholder="At least 6 characters" />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton
          label="Create account"
          onPress={submit}
          busy={busy}
          disabled={!email || password.length < 6 || !name || usernameState === 'taken' || usernameState === 'invalid' || usernameState === 'empty'}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.lg },
  title: { color: colors.foreground, fontSize: 28, fontWeight: '800' },
  error: { color: colors.danger, fontSize: 13 },
});
