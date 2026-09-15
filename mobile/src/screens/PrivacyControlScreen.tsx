/**
 * The main control surface.
 *
 * Layout order is a deliberate safety decision, not an aesthetic one: kill
 * switch first, per-channel switches second, SOS pinned last and always
 * reachable. Anything a person reaches for while anxious goes where their
 * thumb already is.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '../store';
import { pairingApi, privacyApi, sosApi } from '../api/endpoints';
import { ApiError } from '../api/client';
import {
  activePairingChanged,
  channelPending,
  channelSettled,
  masterShieldChanged,
  refused,
  snapshotReceived,
} from '../store/connectionSlice';
import { buildChannelViews } from '../store/reconcile';
import { announcePrivacyChange } from '../realtime/socket';
import { ensureLocationPermission, getCurrentPosition, hasLocationPermission } from '../location';
import { MasterShieldCard } from '../components/MasterShieldCard';
import { PrivacyToggle } from '../components/PrivacyToggle';
import { SosButton } from '../components/SosButton';
import { theme } from '../theme';
import type { PrivacyChannel } from '../api/types';

interface Props {
  onRefresh: () => Promise<void>;
  onAddConnection: () => void;
}

export function PrivacyControlScreen({ onRefresh, onAddConnection }: Props): React.JSX.Element {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const { pairings, activePairingId, snapshots, pending, refusal } = useAppSelector(
    (s) => s.connection,
  );

  const [shieldBusy, setShieldBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const active = activePairingId ? snapshots[activePairingId] : undefined;
  const pendingChannels = activePairingId ? (pending[activePairingId] ?? []) : [];
  const views = useMemo(
    () => (active ? buildChannelViews(active, pendingChannels) : []),
    [active, pendingChannels],
  );
  const lockedCount = views.filter((v) => v.lockedByGuardian).length;

  const activePairing = pairings.find((p) => p.id === activePairingId);

  // The OS permission is a SEPARATE gate from this switch. Location can read
  // ON here while Android has never granted access - the guardian then sees
  // nothing at all, the ongoing notification still says location is being
  // shared, and the person has no way to tell why. Surface it plainly.
  const locationOn = views.find((v) => v.channel === 'LOCATION')?.enabled ?? false;
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);

  useEffect(() => {
    if (!locationOn) {
      setLocationGranted(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const granted = await hasLocationPermission();
      if (!cancelled) setLocationGranted(granted);
    })();
    return () => {
      cancelled = true;
    };
  }, [locationOn]);

  const requestLocationPermission = useCallback(async () => {
    setLocationGranted(await ensureLocationPermission());
  }, []);

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const toggleShield = useCallback(async () => {
    if (!active || shieldBusy) return;
    const next = !active.masterShieldActive;
    setShieldBusy(true);
    dispatch(masterShieldChanged(next));
    try {
      await privacyApi.setMasterShield(next);
      if (activePairingId) announcePrivacyChange(activePairingId);
    } catch (err) {
      // Roll back: the server did not accept it, so the UI must not claim it did.
      dispatch(masterShieldChanged(!next));
      dispatch(refused(err instanceof ApiError ? err.message : 'Could not reach the server.'));
    } finally {
      setShieldBusy(false);
    }
  }, [active, activePairingId, dispatch, shieldBusy]);

  const toggleChannel = useCallback(
    async (channel: PrivacyChannel, enabled: boolean) => {
      if (!activePairingId) return;
      dispatch(channelPending({ pairingId: activePairingId, channel }));
      try {
        await privacyApi.setChannel(activePairingId, channel, enabled);
        const fresh = await privacyApi.get(activePairingId);
        dispatch(snapshotReceived({ pairingId: activePairingId, snapshot: fresh }));
        announcePrivacyChange(activePairingId);
      } catch (err) {
        dispatch(
          refused(err instanceof ApiError ? err.message : 'Could not reach the server.'),
        );
      } finally {
        // Always clear the in-flight marker. While it is set the switch is
        // replaced by a spinner, so leaving it stuck reads as a dead control.
        dispatch(channelSettled({ pairingId: activePairingId, channel }));
      }
    },
    [activePairingId, dispatch],
  );

  const endConnection = useCallback(() => {
    if (!activePairingId) return;
    Alert.alert(
      'End this connection?',
      'Sharing stops immediately and your guardian is told the connection ended. ' +
        'You do not need their approval.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'End connection',
          style: 'destructive',
          onPress: async () => {
            try {
              await pairingApi.revoke(activePairingId, 'Ended by monitored user');
              await onRefresh();
            } catch (err) {
              dispatch(
                refused(err instanceof ApiError ? err.message : 'Could not reach the server.'),
              );
            }
          },
        },
      ],
    );
  }, [activePairingId, dispatch, onRefresh]);

  const triggerSos = useCallback(async () => {
    // Best effort on location: never let a slow or refused GPS fix stop the
    // alert from going out.
    let point: { lat: number; lng: number; accuracyMeters?: number } | undefined;
    try {
      const pos = await getCurrentPosition(5_000);
      if (pos) point = pos;
    } catch {
      /* send without coordinates */
    }

    try {
      const res = await sosApi.trigger(point);
      Alert.alert(
        'Alert sent',
        res.notifiedGuardians > 0
          ? `${res.notifiedGuardians} guardian${res.notifiedGuardians === 1 ? '' : 's'} alerted with your location.`
          : 'Recorded, but you have no active connections to alert.',
      );
    } catch (err) {
      Alert.alert('Could not send', err instanceof ApiError ? err.message : 'Network error.');
    }
  }, []);

  if (pairings.length === 0) {
    return (
      <View style={[styles.empty, { paddingTop: insets.top + theme.space(12) }]}>
        <Text style={styles.title} accessibilityRole="header">
          No connections yet
        </Text>
        <Text style={styles.emptyBody}>
          When you connect with a guardian, their access appears here and you can switch any of
          it off.
        </Text>
        <Pressable
          style={styles.primary}
          onPress={onAddConnection}
          accessibilityRole="button"
          accessibilityLabel="Connect with a guardian"
        >
          <Text style={styles.primaryLabel}>Connect with a guardian</Text>
        </Pressable>
        <View style={styles.sosSpacer} />
        <SosButton onTrigger={triggerSos} />
      </View>
    );
  }

  return (
    <View style={styles.flex}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + theme.space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={doRefresh} tintColor={theme.color.textMuted} />}
      >
        <Text style={styles.screenTitle} accessibilityRole="header">
          Your privacy
        </Text>

        {pairings.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {pairings.map((p) => {
              const selected = p.id === activePairingId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => dispatch(activePairingChanged(p.id))}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Connection with ${p.guardian.displayName}`}
                >
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {p.guardian.displayName}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {activePairing?.status === 'PENDING' ? (
          <Text style={styles.pendingNotice} accessibilityLiveRegion="polite">
            Waiting for {activePairing.guardian.displayName} to confirm. Nothing is shared yet.
          </Text>
        ) : null}

        {active ? (
          <>
            <MasterShieldCard
              active={active.masterShieldActive}
              busy={shieldBusy}
              lockedChannelCount={lockedCount}
              onToggle={toggleShield}
            />

            <View style={styles.section}>
              {views.map((v) => (
                <PrivacyToggle
                  key={v.channel}
                  view={v}
                  onChange={(enabled) => toggleChannel(v.channel, enabled)}
                />
              ))}
            </View>

            {locationOn && locationGranted === false ? (
              <View style={styles.permissionCard}>
                <Text style={styles.permissionTitle} accessibilityRole="header">
                  Location is on, but Android has not granted access
                </Text>
                <Text style={styles.permissionBody}>
                  This switch controls whether you share. Android separately controls
                  whether the app may read your position at all, and it has not been
                  allowed yet, so your guardian is seeing nothing.
                </Text>
                <Pressable
                  onPress={requestLocationPermission}
                  style={styles.permissionButton}
                  accessibilityRole="button"
                  accessibilityLabel="Allow location access"
                >
                  <Text style={styles.permissionButtonLabel}>Allow location access</Text>
                </Pressable>
              </View>
            ) : null}

            {refusal ? (
              <Text
                style={styles.refusal}
                accessibilityLiveRegion="assertive"
                accessibilityRole="alert"
              >
                {refusal}
              </Text>
            ) : null}

            <Pressable
              style={styles.endConnection}
              onPress={endConnection}
              accessibilityRole="button"
              accessibilityLabel="End this connection"
              accessibilityHint="Stops all sharing immediately without your guardian's approval"
            >
              <Text style={styles.endConnectionLabel}>End this connection</Text>
            </Pressable>
          </>
        ) : null}

        <Pressable
          style={styles.secondaryInline}
          onPress={onAddConnection}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryLabel}>Connect with another guardian</Text>
        </Pressable>

        <View style={{ height: theme.space(4) }} />
      </ScrollView>

      <View style={[styles.sosDock, { paddingBottom: insets.bottom + theme.space(2) }]}>
        <SosButton onTrigger={triggerSos} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  permissionCard: {
    marginHorizontal: theme.space(4),
    marginTop: theme.space(4),
    padding: theme.space(4),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.locked,
    backgroundColor: theme.color.surface,
  },
  permissionTitle: {
    color: theme.color.text,
    fontSize: theme.font.body,
    fontWeight: '700',
  },
  permissionBody: {
    color: theme.color.textMuted,
    fontSize: theme.font.small,
    marginTop: theme.space(2),
    lineHeight: 20,
  },
  permissionButton: {
    marginTop: theme.space(3),
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.accent,
  },
  permissionButtonLabel: {
    color: '#FFFFFF',
    fontSize: theme.font.body,
    fontWeight: '700',
  },
  flex: { flex: 1, backgroundColor: theme.color.bg },
  empty: { flex: 1, backgroundColor: theme.color.bg, paddingHorizontal: theme.space(5) },
  title: { color: theme.color.text, fontSize: theme.font.title, fontWeight: '700' },
  screenTitle: {
    color: theme.color.text,
    fontSize: theme.font.title,
    fontWeight: '700',
    paddingHorizontal: theme.space(5),
  },
  emptyBody: {
    color: theme.color.textMuted,
    fontSize: theme.font.body,
    marginTop: theme.space(3),
    marginBottom: theme.space(6),
    lineHeight: 21,
  },
  chipRow: { paddingHorizontal: theme.space(5), paddingTop: theme.space(4), gap: theme.space(2) },
  chip: {
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(2.5),
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.color.border,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: theme.color.surfaceRaised, borderColor: theme.color.accent },
  chipLabel: { color: theme.color.textMuted, fontSize: theme.font.small },
  chipLabelSelected: { color: theme.color.text, fontWeight: '600' },
  pendingNotice: {
    color: theme.color.locked,
    fontSize: theme.font.small,
    paddingHorizontal: theme.space(5),
    paddingTop: theme.space(4),
    lineHeight: 19,
  },
  section: {
    backgroundColor: theme.color.surface,
    marginHorizontal: theme.space(4),
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.color.border,
    overflow: 'hidden',
  },
  refusal: {
    color: theme.color.danger,
    fontSize: theme.font.small,
    paddingHorizontal: theme.space(5),
    paddingTop: theme.space(3),
  },
  endConnection: {
    marginTop: theme.space(6),
    marginHorizontal: theme.space(4),
    paddingVertical: theme.space(4),
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.color.danger,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  endConnectionLabel: { color: theme.color.danger, fontSize: theme.font.body, fontWeight: '700' },
  secondaryInline: { paddingVertical: theme.space(4), alignItems: 'center', minHeight: 48 },
  secondaryLabel: { color: theme.color.accent, fontSize: theme.font.body, fontWeight: '600' },
  primary: {
    backgroundColor: theme.color.accent,
    borderRadius: theme.radius.md,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: { color: '#FFFFFF', fontSize: theme.font.heading, fontWeight: '700' },
  sosSpacer: { flex: 1 },
  sosDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
    backgroundColor: theme.color.bg,
  },
});
