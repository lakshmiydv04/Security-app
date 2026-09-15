/**
 * Prints the real privacy state of every pairing, and works out whether the
 * mobile app's switches would be interactive for it.
 *
 * The phone shows a switch as movable only when
 *   pairingStatus === 'ACTIVE'  AND  the channel is not guardian-locked
 * so a switch that will not move is always one of a small number of database
 * facts. This prints all of them rather than making anyone guess.
 *
 *   npm run privacy:doctor
 */

import { prisma } from '../lib/db.js';

const tick = (b: boolean): string => (b ? 'ON ' : 'off');

async function main(): Promise<void> {
  const pairings = await prisma.pairing.findMany({
    select: {
      id: true,
      status: true,
      tier: true,
      guardian: { select: { displayName: true, email: true } },
      monitoredUser: {
        select: { displayName: true, email: true, masterShieldActive: true },
      },
      privacyState: {
        select: {
          locationEnabled: true,
          cameraEnabled: true,
          microphoneEnabled: true,
          guardianLockedChannels: true,
          updatedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (pairings.length === 0) {
    console.log('\nNo pairings exist yet.\n');
    await prisma.$disconnect();
    return;
  }

  console.log(`\n=== ${pairings.length} pairing(s) ===\n`);

  for (const p of pairings) {
    console.log(`Pairing ${p.id}`);
    console.log(`  guardian        : ${p.guardian.displayName} <${p.guardian.email}>`);
    console.log(`  monitored       : ${p.monitoredUser.displayName} <${p.monitoredUser.email}>`);
    console.log(`  status          : ${p.status}`);
    console.log(`  tier            : ${p.tier}`);
    console.log(`  master shield   : ${p.monitoredUser.masterShieldActive ? 'UP (blocks everything)' : 'down'}`);

    if (!p.privacyState) {
      console.log('  privacy row     : *** MISSING ***');
      console.log('     -> every channel reads as off, and a toggle write would');
      console.log('        fail with Prisma P2025 (record to update not found).');
      console.log('');
      continue;
    }

    const s = p.privacyState;
    const locked = s.guardianLockedChannels as string[];
    console.log(`  privacy row     : present (updated ${s.updatedAt.toISOString()})`);
    console.log(
      `  toggles         : location ${tick(s.locationEnabled)}   camera ${tick(s.cameraEnabled)}   microphone ${tick(s.microphoneEnabled)}`,
    );
    console.log(`  guardian locks  : ${locked.length ? locked.join(', ') : '(none)'}`);

    // Reproduce exactly what the phone computes for each switch.
    console.log('  phone switches  :');
    for (const channel of ['LOCATION', 'CAMERA', 'MICROPHONE'] as const) {
      const isLocked = p.tier === 'GUARDIAN_MANAGED' && locked.includes(channel);
      const interactive = p.status === 'ACTIVE' && !isLocked;
      const reason = !interactive
        ? p.status !== 'ACTIVE'
          ? `DISABLED - pairing is ${p.status}, not ACTIVE`
          : 'DISABLED - locked on by the guardian'
        : 'movable';
      console.log(`     ${channel.padEnd(11)} ${reason}`);
    }
    console.log('');
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('privacy-doctor failed:', err);
  process.exit(1);
});
