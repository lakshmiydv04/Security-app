#!/usr/bin/env node
/**
 * Re-establishes the adb reverse tunnels the phone needs in development.
 *
 * `react-native run-android` sets up 8081 for Metro, but that tunnel is lost
 * whenever the adb connection drops - routine with wireless debugging - and it
 * never sets up 4000 for the Guardian API at all. Without 8081 the app cannot
 * fetch its JS bundle ("Unable to load script"); without 4000 it loads and then
 * fails every request.
 *
 * Plain `adb reverse` refuses to run when more than one device is attached,
 * which happens constantly when a phone is visible over both USB and Wi-Fi.
 * This targets each device explicitly with -s, and finds adb via ANDROID_HOME
 * so it does not depend on PATH.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const PORTS = [8081, 4000];

function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  for (const root of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (!root) continue;
    const candidate = join(root, 'platform-tools', exe);
    if (existsSync(candidate)) return candidate;
  }
  return exe; // fall back to PATH
}

const adb = findAdb();
const run = (args) => execFileSync(adb, args, { encoding: 'utf8' });

let listing;
try {
  listing = run(['devices']);
} catch {
  console.error(`Could not run adb (tried: ${adb}).`);
  console.error('Set ANDROID_HOME, or add platform-tools to PATH, then retry.');
  process.exit(1);
}

const serials = listing
  .split('\n')
  .slice(1)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => line.split(/\s+/))
  .filter((parts) => parts[1] === 'device')
  .map((parts) => parts[0]);

if (serials.length === 0) {
  console.error('No authorised device attached. adb devices says:\n');
  console.error(listing.trim());
  console.error('\nIf it says "unauthorized", unlock the phone and accept the debugging prompt.');
  process.exit(1);
}

let failed = 0;
for (const serial of serials) {
  for (const port of PORTS) {
    try {
      run(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
      console.log(`  ok    ${serial}  tcp:${port}`);
    } catch {
      console.log(`  FAIL  ${serial}  tcp:${port}`);
      failed += 1;
    }
  }
}

console.log('\nActive tunnels:');
for (const serial of serials) {
  const active = run(['-s', serial, 'reverse', '--list']).trim();
  console.log(`  ${serial}\n${active ? active.replace(/^/gm, '    ') : '    (none)'}`);
}

if (failed) process.exit(1);
console.log('\nMetro (8081) and the Guardian API (4000) are reachable from the phone.');
console.log('Now press R twice on the device to reload.');
