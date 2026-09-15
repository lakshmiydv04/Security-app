/**
 * Token persistence.
 *
 * Keychain (iOS) / Keystore-backed EncryptedSharedPreferences (Android) via
 * react-native-keychain. AsyncStorage is deliberately not used for tokens: it
 * is plain text on disk.
 */

import * as Keychain from 'react-native-keychain';
import type { TokenPair } from '../api/client';

const SERVICE = 'guardian.tokens';

export async function saveTokens(tokens: TokenPair | null): Promise<void> {
  if (!tokens) {
    await Keychain.resetGenericPassword({ service: SERVICE });
    return;
  }
  await Keychain.setGenericPassword('tokens', JSON.stringify(tokens), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadTokens(): Promise<TokenPair | null> {
  try {
    const stored = await Keychain.getGenericPassword({ service: SERVICE });
    if (!stored) return null;
    return JSON.parse(stored.password) as TokenPair;
  } catch {
    return null;
  }
}
