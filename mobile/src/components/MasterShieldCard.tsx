/**
 * The kill switch.
 *
 * Given the most prominent position on the screen because it is the control
 * the user reaches for when they are uncomfortable, and that is not a moment
 * for hunting through a settings list.
 */

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '../theme';

interface Props {
  active: boolean;
  busy: boolean;
  lockedChannelCount: number;
  onToggle: () => void;
}

export function MasterShieldCard({
  active,
  busy,
  lockedChannelCount,
  onToggle,
}: Props): React.JSX.Element {
  const title = active ? 'Privacy Shield is ON' : 'Privacy Shield is OFF';
  const body = active
    ? 'Location, camera and microphone are cut off.'
    : 'Your connections are sharing according to the switches below.';

  return (
    <Pressable
      onPress={onToggle}
      disabled={busy}
      style={({ pressed }) => [
        styles.card,
        active ? styles.cardOn : styles.cardOff,
        pressed && styles.pressed,
      ]}
      accessibilityRole="switch"
      accessibilityLabel="Privacy Shield"
      accessibilityState={{ checked: active, disabled: busy }}
      accessibilityHint={
        active ? 'Double tap to resume sharing' : 'Double tap to cut off all sharing immediately'
      }
      testID="master-shield"
    >
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>

      {active && lockedChannelCount > 0 ? (
        <Text style={styles.caveat}>
          {lockedChannelCount === 1 ? '1 channel is' : `${lockedChannelCount} channels are`}{' '}
          locked on by your guardian and stay on. To stop those, end the connection.
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: theme.space(4),
    padding: theme.space(5),
    borderRadius: theme.radius.lg,
    borderWidth: 2,
  },
  cardOn: { backgroundColor: '#12291F', borderColor: theme.color.shield },
  cardOff: { backgroundColor: theme.color.surface, borderColor: theme.color.border },
  pressed: { opacity: 0.85 },
  title: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700' },
  body: { color: theme.color.textMuted, fontSize: theme.font.body, marginTop: theme.space(2) },
  caveat: {
    color: theme.color.locked,
    fontSize: theme.font.small,
    marginTop: theme.space(3),
    lineHeight: 18,
  },
});
