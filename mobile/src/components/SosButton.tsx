/**
 * Emergency SOS.
 *
 * Two deliberate choices:
 *   - It is never disabled by privacy state. The backend accepts SOS with the
 *     shield up, because that is exactly when it matters. Adding a local
 *     guard here would silently break that.
 *   - It requires a confirm step. A panic button that fires on a pocket tap
 *     trains people to ignore it, which is worse than a second of friction.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';

const CONFIRM_WINDOW_MS = 4_000;

interface Props {
  onTrigger: () => Promise<void>;
}

export function SosButton({ onTrigger }: Props): React.JSX.Element {
  const [armed, setArmed] = useState(false);
  const [sending, setSending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const press = useCallback(async () => {
    if (sending) return;

    if (!armed) {
      setArmed(true);
      timer.current = setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
      return;
    }

    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    setSending(true);
    try {
      await onTrigger();
    } finally {
      setSending(false);
    }
  }, [armed, sending, onTrigger]);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={press}
        style={({ pressed }) => [styles.button, armed && styles.armed, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={armed ? 'Confirm emergency alert' : 'Emergency SOS'}
        accessibilityHint={
          armed
            ? 'Double tap again to send your location to your guardian'
            : 'Double tap, then confirm, to alert your guardian'
        }
        accessibilityState={{ busy: sending }}
        testID="sos-button"
      >
        {sending ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.label}>{armed ? 'TAP AGAIN TO SEND' : 'SOS'}</Text>
        )}
      </Pressable>
      <Text style={styles.caption} accessibilityLiveRegion="polite">
        {armed
          ? 'Tap again to alert your guardian with your location'
          : 'Works even when Privacy Shield is on'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', padding: theme.space(4) },
  button: {
    width: '100%',
    minHeight: 64,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.color.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  armed: { backgroundColor: '#B3282B' },
  pressed: { opacity: 0.85 },
  label: { color: '#FFFFFF', fontSize: theme.font.heading, fontWeight: '800', letterSpacing: 1 },
  caption: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    marginTop: theme.space(2),
    textAlign: 'center',
  },
});
