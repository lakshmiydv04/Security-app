import React from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { theme } from '../theme';
import type { ChannelView } from '../store/reconcile';

const LABELS: Record<string, { title: string; hint: string }> = {
  LOCATION: { title: 'Location', hint: 'Share where you are' },
  CAMERA: { title: 'Camera', hint: 'Allow camera check-ins' },
  MICROPHONE: { title: 'Microphone', hint: 'Allow audio check-ins' },
};

interface Props {
  view: ChannelView;
  onChange: (enabled: boolean) => void;
}

export function PrivacyToggle({ view, onChange }: Props): React.JSX.Element {
  const meta = LABELS[view.channel] ?? { title: view.channel, hint: '' };

  const stateHint = view.lockedByGuardian
    ? 'Locked on by your guardian. You can still end the connection.'
    : meta.hint;

  return (
    <View style={styles.row} testID={`toggle-${view.channel}`}>
      <View style={styles.labels}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{meta.title}</Text>
          {view.lockedByGuardian ? (
            <Text style={styles.lockBadge} accessibilityLabel="Locked by guardian">
              LOCKED
            </Text>
          ) : null}
        </View>
        <Text style={styles.hint}>{stateHint}</Text>
      </View>

      {view.pending ? (
        <ActivityIndicator color={theme.color.accent} accessibilityLabel="Saving" />
      ) : (
        <Switch
          value={view.enabled}
          onValueChange={onChange}
          disabled={!view.interactive}
          trackColor={{ false: theme.color.border, true: theme.color.shield }}
          thumbColor="#FFFFFF"
          accessibilityRole="switch"
          accessibilityLabel={meta.title}
          accessibilityHint={stateHint}
          // Communicates both the on/off value and the fact it cannot be
          // moved, which a visual lock badge alone would not convey.
          accessibilityState={{ checked: view.enabled, disabled: !view.interactive }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space(4),
    paddingHorizontal: theme.space(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
    gap: theme.space(4),
  },
  labels: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.space(2) },
  title: { color: theme.color.text, fontSize: theme.font.heading, fontWeight: '600' },
  lockBadge: {
    color: theme.color.locked,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    borderWidth: 1,
    borderColor: theme.color.locked,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(1.5),
    paddingVertical: 1,
  },
  hint: { color: theme.color.textMuted, fontSize: theme.font.small, marginTop: 2 },
});
