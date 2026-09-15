#!/usr/bin/env node
/**
 * One-time bootstrap.
 *
 * React Native's CLI generates the Gradle and Xcode scaffolding, and refuses
 * to run in a non-empty directory - which this one is, because the app source
 * is already here. So: generate into a scratch directory, copy in what does
 * not already exist (our files always win), then apply the patches the
 * generator cannot know about.
 *
 * Safe to re-run, and re-running REPAIRS a partial previous run: the
 * MainApplication/MainActivity step and the verification at the end both work
 * against whatever is currently on disk, not against what this run copied.
 */

import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const template = join(root, '.rn-template');
const APP_NAME = 'GuardianMobile';
const RN_VERSION = '0.76.5';
const ANDROID_PKG_DIR = join(root, 'android/app/src/main/java/com/guardianmobile');

const log = (m) => process.stdout.write(`${m}\n`);
const warn = (m) => process.stdout.write(`  ! ${m}\n`);

/**
 * Template entries we never want. Our app entry is src/App.tsx (index.js
 * points there) and our tests run on vitest, so the template's sample App,
 * its jest test and jest config would sit in the tree contradicting both.
 */
const NEVER_COPY = new Set([
  'node_modules',
  '.git',
  'package.json',
  'src',
  'tests',
  'App.tsx',
  '__tests__',
  'jest.config.js',
]);

let copied = 0;
let kept = 0;

function generate() {
  if (existsSync(join(template, APP_NAME, 'package.json'))) {
    log('· Reusing already-generated template.');
    return;
  }
  log('· Generating React Native scaffolding (downloads the template)...');
  mkdirSync(template, { recursive: true });
  execSync(
    `npx --yes @react-native-community/cli@latest init ${APP_NAME} ` +
      `--directory "${template}/${APP_NAME}" --version ${RN_VERSION} ` +
      `--skip-install --skip-git-init --install-pods false`,
    { stdio: 'inherit', cwd: root },
  );
}

function copyMissing(from, to) {
  for (const entry of readdirSync(from)) {
    if (NEVER_COPY.has(entry)) continue;

    const src = join(from, entry);
    const dest = join(to, entry);

    if (statSync(src).isDirectory()) {
      mkdirSync(dest, { recursive: true });
      copyMissing(src, dest);
      continue;
    }
    if (existsSync(dest)) {
      kept += 1;
      continue;
    }
    cpSync(src, dest);
    copied += 1;
  }
}

/** Depth-first search for a file by name. */
function findFile(dir, name) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry === name) {
      return full;
    }
  }
  return null;
}

/**
 * MainApplication.kt and MainActivity.kt are the two files Android cannot
 * build without, and the CLI's package-renaming step means their path in the
 * template is not guaranteed. Locate them by name and place them explicitly
 * rather than relying on the directory walk landing them in the right place.
 */
function placeAndroidEntryPoints(generated) {
  mkdirSync(ANDROID_PKG_DIR, { recursive: true });

  for (const name of ['MainApplication.kt', 'MainActivity.kt']) {
    const dest = join(ANDROID_PKG_DIR, name);
    if (existsSync(dest)) {
      log(`· ${name} already in place.`);
      continue;
    }

    const src = findFile(generated, name);
    if (!src) {
      warn(`${name} not found anywhere in the generated template.`);
      continue;
    }

    let contents = readFileSync(src, 'utf8');
    // The template may still carry its own package line if the rename step
    // did not reach this file.
    contents = contents.replace(/^package\s+[\w.]+/m, 'package com.guardianmobile');
    writeFileSync(dest, contents);
    copied += 1;
    log(`· Placed ${name} from ${relative(root, src)}`);
  }
}

function patchMainApplication() {
  const path = join(ANDROID_PKG_DIR, 'MainApplication.kt');
  if (!existsSync(path)) {
    warn('MainApplication.kt missing - cannot register GuardianServicePackage.');
    return false;
  }

  let src = readFileSync(path, 'utf8');
  if (src.includes('GuardianServicePackage()')) {
    log('· MainApplication already registers GuardianServicePackage.');
    return true;
  }

  if (!src.includes('import com.guardianmobile.service.GuardianServicePackage')) {
    src = src.replace(
      /^(package .+\n)/m,
      '$1\nimport com.guardianmobile.service.GuardianServicePackage\n',
    );
  }

  const anchor = 'PackageList(this).packages.apply {';
  if (!src.includes(anchor)) {
    warn('Could not find the packages block in MainApplication.kt.');
    warn('Add `add(GuardianServicePackage())` to getPackages() by hand.');
    return false;
  }

  src = src.replace(anchor, `${anchor}\n              add(GuardianServicePackage())`);
  writeFileSync(path, src);
  log('· Registered GuardianServicePackage in MainApplication.kt.');
  return true;
}

const PLIST_KEYS = [
  ['UIBackgroundModes', '<array>\n    <string>location</string>\n    <string>voip</string>\n  </array>'],
  ['NSLocationWhenInUseUsageDescription', '<string>Shares your location with the guardian you connected to. You can switch this off at any time.</string>'],
  ['NSLocationAlwaysAndWhenInUseUsageDescription', '<string>Shares your location with the guardian you connected to, including when the app is in the background. You can switch this off at any time.</string>'],
  ['NSCameraUsageDescription', '<string>Lets your guardian request a camera check-in, and lets you scan a pairing code. Your screen shows a red banner whenever the camera is live.</string>'],
  ['NSMicrophoneUsageDescription', '<string>Lets your guardian request an audio check-in. Your screen shows a red banner whenever the microphone is live.</string>'],
];

function patchInfoPlist() {
  const path = join(root, `ios/${APP_NAME}/Info.plist`);
  if (!existsSync(path)) {
    warn('Info.plist not found - apply ios/InfoPlistAdditions.md by hand.');
    return;
  }

  let src = readFileSync(path, 'utf8');
  const additions = PLIST_KEYS.filter(([k]) => !src.includes(`<key>${k}</key>`));
  if (additions.length === 0) {
    log('· Info.plist already has the required keys.');
    return;
  }

  const close = src.lastIndexOf('</dict>');
  if (close === -1) {
    warn('Info.plist looks malformed; apply ios/InfoPlistAdditions.md by hand.');
    return;
  }
  const block = additions.map(([k, v]) => `  <key>${k}</key>\n  ${v}`).join('\n');
  writeFileSync(path, `${src.slice(0, close)}${block}\n${src.slice(close)}`);
  log(`· Added ${additions.length} key(s) to Info.plist.`);
}

/** Fail loudly rather than leaving a tree that cannot build. */
function verify() {
  const required = [
    'android/settings.gradle',
    'android/app/build.gradle',
    'android/app/src/main/AndroidManifest.xml',
    'android/app/src/main/java/com/guardianmobile/MainApplication.kt',
    'android/app/src/main/java/com/guardianmobile/MainActivity.kt',
    'android/app/src/main/java/com/guardianmobile/service/GuardianForegroundService.kt',
  ];
  const missing = required.filter((r) => !existsSync(join(root, r)));

  // An unresolvable resource does not surface until :app:processDebugResources,
  // minutes into a Gradle build. Catch it here instead. Driven off the actual
  // files rather than a hardcoded list, so it stays true as they change, and
  // it checks res/values/*.xml as well as the manifest - a theme referencing a
  // drawable that does not exist fails exactly the same way a manifest does.
  const mainSrc = join(root, 'android/app/src/main');
  const manifestPath = join(mainSrc, 'AndroidManifest.xml');
  const res = join(mainSrc, 'res');
  const unresolved = [];

  if (existsSync(manifestPath)) {
    const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, ''); // comments are not references
    const dirs = existsSync(res) ? readdirSync(res) : [];
    const valuesFiles = dirs.includes('values')
      ? readdirSync(join(res, 'values')).map((f) => join(res, 'values', f))
      : [];
    const pattern = /@(string|style|mipmap|drawable|color)\/([A-Za-z0-9_]+)/g;

    const refs = new Map(); // "type/name" -> file that referenced it
    for (const src of [manifestPath, ...valuesFiles]) {
      for (const m of strip(readFileSync(src, 'utf8')).matchAll(pattern)) {
        refs.set(`${m[1]}/${m[2]}`, src.replace(`${mainSrc}/`, ''));
      }
    }

    for (const [ref, src] of refs) {
      const [type, name] = ref.split('/');
      const ok =
        type === 'mipmap' || type === 'drawable'
          ? dirs
              .filter((d) => d.startsWith(type))
              .some((d) =>
                readdirSync(join(res, d)).some(
                  (f) => f.replace(/\.(png|webp|xml|jpg)$/, '') === name,
                ),
              )
          : valuesFiles.some((f) =>
              strip(readFileSync(f, 'utf8')).includes(`name="${name}"`),
            );
      if (!ok) unresolved.push(`@${ref}  (referenced by ${src})`);
    }
  }

  if (missing.length === 0 && unresolved.length === 0) {
    log('· Verified: Android project is complete (files and resource references).');
    return true;
  }
  warn('Android project is INCOMPLETE.');
  for (const m of missing) warn(`    missing file:        ${m}`);
  for (const u of unresolved) warn(`    unresolved resource: ${u}`);
  return false;
}

function main() {
  generate();

  const generated = join(template, APP_NAME);
  if (!existsSync(generated)) {
    warn('Scaffolding was not generated. Check the CLI output above.');
    process.exit(1);
  }

  log('· Merging scaffolding (existing files are never overwritten)...');
  copyMissing(generated, root);
  placeAndroidEntryPoints(generated);
  log(`  copied ${copied} file(s), kept ${kept} existing`);

  patchMainApplication();
  patchInfoPlist();

  const ok = verify();
  rmSync(template, { recursive: true, force: true });

  log('');
  if (!ok) {
    log('Bootstrap finished with problems - see the warnings above.');
    process.exit(1);
  }
  log('Done. Next:');
  log('  npm install');
  log('  cd ios && pod install && cd ..     # macOS only');
  log('  npm run android                    # or: npm run ios');
}

main();
