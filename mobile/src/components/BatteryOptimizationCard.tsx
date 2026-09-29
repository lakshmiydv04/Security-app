/**
 * Prompts the user to exempt Guardian from battery optimisation, so the OS does
 * not kill the safety service while the phone is locked.
 *
 * Drop it into a settings or connections screen. It is Android-only and renders
 * nothing on iOS. Without a native module it cannot read whether the exemption
 * is already granted (see BATTERY_OPTIMIZATION.md), so it is written as a gentle
 * suggestion rather than a hard gate - which is the right register anyway: this
 * is the user's phone and their choice.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import {
  batteryExemptionSupported,
  openBatteryOptimizationSettings,
} from '../native/batteryOptimization';

export function BatteryOptimizationCard(): React.JSX.Element | null {
  const [opened, setOpened] = useState(false);

  if (!batteryExemptionSupported()) return null;

  const onPress = async (): Promise<void> => {
    const ok = await openBatteryOptimizationSettings();
    setOpened(ok);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Keep safety running in the background</Text>
      <Text style={styles.body}>
        Some phones stop apps from running when the screen is off, which can pause location
        sharing. Setting Guardian to “Unrestricted” (or “Don’t optimise”) lets protection keep
        working while the phone is locked.
      </Text>

      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Open battery settings"
        testID="battery-optimization-button"
      >
        <Text style={styles.buttonText}>Open battery settings</Text>
      </Pressable>

      {opened ? (
        <Text style={styles.hint}>
          Find Guardian in the list and choose “Don’t optimise” (or “Unrestricted”).
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: theme.space(4),
    padding: theme.space(5),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    backgroundColor: theme.color.surface,
    borderColor: theme.color.border,
  },
  title: { color: theme.color.text, fontSize: theme.font.heading, fontWeight: '700' },
  body: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    marginTop: theme.space(2),
    lineHeight: 21,
  },
  button: {
    marginTop: theme.space(4),
    paddingVertical: theme.space(3),
    paddingHorizontal: theme.space(4),
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.accent,
    alignItems: 'center',
  },
  pressed: { opacity: 0.85 },
  buttonText: { color: '#FFFFFF', fontSize: theme.font.body, fontWeight: '600' },
  hint: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    marginTop: theme.space(3),
    lineHeight: 18,
  },
});
