/**
 * Consent pairing.
 *
 * The guardian generates a code; this screen redeems it. That only puts the
 * connection into PENDING - the guardian must then confirm on their side.
 * Both people act, which is what rules out a silent install.
 *
 * The copy says plainly what is being agreed to. A consent flow that buries
 * what it grants is not consent, and this is the screen where that is decided.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';
import { pairingApi } from '../api/endpoints';
import { CODE_LENGTH, CODE_PATTERN, extractCode, normaliseInput } from '../pairingCode';
import { ApiError } from '../api/client';
import { theme } from '../theme';

interface Props {
  onPaired: () => void;
}

export function PairingScreen({ onPaired }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');

  const submit = useCallback(
    async (value: string) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        await pairingApi.redeem(value);
        setScanning(false);
        onPaired();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
      } finally {
        setBusy(false);
      }
    },
    [busy, onPaired],
  );

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      if (busy || !scanning) return;
      for (const c of codes) {
        const found = c.value ? extractCode(c.value) : null;
        if (found) {
          setCode(found);
          void submit(found);
          return;
        }
      }
    },
  });

  const openScanner = useCallback(async () => {
    setError(null);
    const granted = hasPermission || (await requestPermission());
    if (!granted) {
      setError('Camera permission is needed to scan a code. You can type it instead.');
      return;
    }
    setScanning(true);
  }, [hasPermission, requestPermission]);

  const valid = useMemo(() => CODE_PATTERN.test(code), [code]);

  if (scanning && device) {
    return (
      <View style={styles.flex}>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive
          codeScanner={codeScanner}
        />
        <View style={[styles.scanOverlay, { paddingTop: insets.top + theme.space(6) }]}>
          <Text style={styles.scanHint} accessibilityRole="header">
            Point at your guardian&apos;s code
          </Text>
          <Pressable
            style={styles.secondary}
            onPress={() => setScanning(false)}
            accessibilityRole="button"
            accessibilityLabel="Cancel scanning"
          >
            <Text style={styles.secondaryLabel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + theme.space(8) }]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title} accessibilityRole="header">
        Connect with your guardian
      </Text>

      <View style={styles.consentCard}>
        <Text style={styles.consentTitle}>What you are agreeing to</Text>
        <Text style={styles.consentItem}>
          • They can see your location while you have location sharing on.
        </Text>
        <Text style={styles.consentItem}>
          • They can ask for a camera or microphone check-in. Your phone shows a red banner
          whenever one is live.
        </Text>
        <Text style={styles.consentItem}>
          • You can switch any of it off at any time, and you can end this connection on your
          own without their approval.
        </Text>
        <Text style={styles.consentItem}>
          • Both of you see the same history of when anything was shared.
        </Text>
      </View>

      <Text style={styles.label} nativeID="code-label">
        Enter the 8-character code
      </Text>
      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(t) => setCode(normaliseInput(t))}
        placeholder="ABCD1234"
        placeholderTextColor={theme.color.textMuted}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={CODE_LENGTH}
        accessibilityLabel="Pairing code"
        accessibilityLabelledBy="code-label"
        accessibilityHint="Eight characters, letters and numbers"
        testID="pairing-code-input"
      />

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="assertive" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.primary,
          (!valid || busy) && styles.disabled,
          pressed && styles.pressed,
        ]}
        onPress={() => submit(code)}
        disabled={!valid || busy}
        accessibilityRole="button"
        accessibilityLabel="Connect"
        accessibilityState={{ disabled: !valid || busy, busy }}
      >
        {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryLabel}>Connect</Text>}
      </Pressable>

      <Pressable
        style={styles.secondaryInline}
        onPress={openScanner}
        accessibilityRole="button"
        accessibilityLabel="Scan a QR code instead"
      >
        <Text style={styles.secondaryLabel}>Scan a QR code instead</Text>
      </Pressable>

      <Text style={styles.footnote}>
        After you connect, your guardian confirms it on their side before anything is shared.
      </Text>
      <View style={{ height: insets.bottom + theme.space(6) }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: theme.color.bg },
  content: { paddingHorizontal: theme.space(5) },
  title: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700' },
  consentCard: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    padding: theme.space(4),
    marginVertical: theme.space(5),
    gap: theme.space(2),
  },
  consentTitle: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '700',
    marginBottom: theme.space(1),
  },
  consentItem: { color: theme.color.textMuted, fontSize: theme.font.small, lineHeight: 20 },
  label: { color: theme.color.textMuted, fontSize: theme.font.small, marginBottom: theme.space(2) },
  codeInput: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    color: theme.color.text,
    fontSize: theme.font.mono,
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: theme.space(4),
    minHeight: 56,
  },
  error: { color: theme.color.danger, fontSize: theme.font.small, marginTop: theme.space(3) },
  primary: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.space(4),
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  primaryLabel: { color: '#FFFFFF', fontSize: theme.font.heading, fontWeight: '700' },
  secondary: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    paddingVertical: theme.space(3),
    paddingHorizontal: theme.space(6),
    minHeight: 48,
    justifyContent: 'center',
  },
  secondaryInline: { paddingVertical: theme.space(4), alignItems: 'center', minHeight: 48 },
  secondaryLabel: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  scanOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: theme.space(10),
    paddingHorizontal: theme.space(5),
  },
  scanHint: {
    color: '#FFFFFF',
    fontSize: theme.font.heading,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(2),
    borderRadius: theme.radius.pill,
    overflow: 'hidden',
  },
  footnote: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    textAlign: 'center',
    marginTop: theme.space(4),
    lineHeight: 19,
  },
});
