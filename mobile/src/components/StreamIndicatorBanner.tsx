/**
 * The activity indicator.
 *
 * Rendered at the root, above navigation, so it is present on every screen
 * and cannot be covered by one. It has no dismiss control and no animation
 * that reduces it to a dot - a user glancing at the phone must be able to
 * tell a stream is live without interacting with anything.
 *
 * This is the in-app half of the disclosure. The OS-level camera and
 * microphone indicators are the half that a modified build cannot remove,
 * which is why the app must never request any permission that suppresses
 * them.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppSelector } from '../store';
import { theme } from '../theme';

function describe(kinds: string[]): string {
  if (kinds.includes('CAMERA') && kinds.includes('MICROPHONE')) {
    return 'Camera and microphone are live';
  }
  if (kinds.includes('CAMERA')) return 'Camera is live';
  return 'Microphone is live';
}

export function StreamIndicatorBanner(): React.JSX.Element | null {
  const active = useAppSelector((s) => s.stream.active);
  const insets = useSafeAreaInsets();

  if (active.length === 0) return null;

  const kinds = [...new Set(active.map((s) => s.kind))];
  const label = describe(kinds);

  return (
    <View
      style={[styles.banner, { paddingTop: insets.top + theme.space(2) }]}
      // Announced immediately by screen readers when it appears - a blind
      // user gets the same disclosure a sighted one does.
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      accessible
      accessibilityLabel={`${label}. Your guardian can see or hear this right now.`}
      testID="stream-indicator-banner"
    >
      <View style={styles.dot} />
      <View style={styles.textWrap}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.subtitle}>Your guardian can see or hear this right now</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingHorizontal: theme.space(4),
    paddingBottom: theme.space(3),
    backgroundColor: theme.color.live,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  textWrap: { flex: 1 },
  title: { color: '#FFFFFF', fontSize: theme.font.body, fontWeight: '700' },
  subtitle: { color: '#FFFFFF', fontSize: theme.font.small, opacity: 0.9 },
});
