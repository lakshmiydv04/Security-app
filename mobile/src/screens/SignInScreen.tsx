import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { authApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import { saveTokens } from '../store/secureTokens';
import { authBusy, authFailed, signedIn } from '../store/authSlice';
import { useAppDispatch, useAppSelector } from '../store';
import { theme } from '../theme';
import { API_BASE_URL, API_BASE_URL_SOURCE } from '../config';

export function SignInScreen(): React.JSX.Element {
  const dispatch = useAppDispatch();
  const { busy, error } = useAppSelector((s) => s.auth);
  const insets = useSafeAreaInsets();

  const [mode, setMode] = useState<'signIn' | 'register'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  const submit = useCallback(async () => {
    dispatch(authBusy(true));
    try {
      const res =
        mode === 'signIn'
          ? await authApi.login(email.trim(), password)
          : await authApi.register(email.trim(), password, displayName.trim());

      const tokens = { accessToken: res.accessToken, refreshToken: res.refreshToken };
      await saveTokens(tokens);
      dispatch(signedIn({ user: res.user, tokens }));
    } catch (err) {
      // An ApiError means the server answered and said no - show its message.
      // Anything else is a transport failure, and in development the single
      // most useful fact is which address we actually tried.
      const detail =
        err instanceof ApiError
          ? err.message
          : __DEV__
            ? `Could not reach ${API_BASE_URL}\n${err instanceof Error ? err.message : String(err)}`
            : 'Could not reach the server.';
      dispatch(authFailed(detail));
    }
  }, [dispatch, mode, email, password, displayName]);

  const canSubmit =
    email.includes('@') && password.length >= 12 && (mode === 'signIn' || displayName.length > 0);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.space(10) }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title} accessibilityRole="header">
          {mode === 'signIn' ? 'Sign in' : 'Create account'}
        </Text>
        <Text style={styles.subtitle}>
          This device will be the one your guardian can check in with. You stay in control of
          what it shares.
        </Text>

        {__DEV__ ? <Text style={styles.devNote}>
            API: {API_BASE_URL} (via {API_BASE_URL_SOURCE})
          </Text> : null}

        {mode === 'register' ? (
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={theme.color.textMuted}
            autoCapitalize="words"
            accessibilityLabel="Your name"
            textContentType="name"
          />
        ) : null}

        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={theme.color.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          accessibilityLabel="Email"
          textContentType="emailAddress"
        />

        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="Password (12+ characters)"
          placeholderTextColor={theme.color.textMuted}
          secureTextEntry
          autoCapitalize="none"
          accessibilityLabel="Password"
          accessibilityHint="At least 12 characters"
          textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
        />

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="assertive" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Pressable
          style={({ pressed }) => [
            styles.primary,
            (!canSubmit || busy) && styles.disabled,
            pressed && styles.pressed,
          ]}
          onPress={submit}
          disabled={!canSubmit || busy}
          accessibilityRole="button"
          accessibilityLabel={mode === 'signIn' ? 'Sign in' : 'Create account'}
          accessibilityState={{ disabled: !canSubmit || busy, busy }}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryLabel}>
              {mode === 'signIn' ? 'Sign in' : 'Create account'}
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => setMode(mode === 'signIn' ? 'register' : 'signIn')}
          accessibilityRole="button"
          style={styles.switchMode}
        >
          <Text style={styles.switchLabel}>
            {mode === 'signIn' ? 'Need an account? Create one' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>
        <View style={{ height: insets.bottom + theme.space(6) }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.bg },
  content: { paddingHorizontal: theme.space(5) },
  title: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700' },
  subtitle: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    marginTop: theme.space(2),
    marginBottom: theme.space(6),
    lineHeight: 21,
  },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    color: theme.color.text,
    fontSize: theme.font.body,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3.5),
    marginBottom: theme.space(3),
    minHeight: 48,
  },
  devNote: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    marginBottom: theme.space(3),
  },
  error: { color: theme.color.danger, fontSize: theme.font.small, marginBottom: theme.space(3) },
  primary: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space(2),
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  primaryLabel: { color: '#FFFFFF', fontSize: theme.font.heading, fontWeight: '700' },
  switchMode: { paddingVertical: theme.space(4), alignItems: 'center' },
  switchLabel: { color: theme.color.accent, fontSize: theme.font.body },
});
