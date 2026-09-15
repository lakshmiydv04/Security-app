#!/usr/bin/env node
/**
 * Automated security verification.
 *
 * Runs the checks that matter most and are easiest to get wrong by hand:
 *
 *   1. audit_events really rejects UPDATE, DELETE and TRUNCATE
 *   2. the hash chain verifies
 *   3. a camera request is refused server-side when the switch is off -
 *      forced through the API, bypassing the dashboard's disabled button
 *   4. the master Privacy Shield overrides an ON switch
 *   5. SOS still works with the Shield up
 *   6. the monitored user can revoke unilaterally, and revocation outranks all
 *
 * Requires: migrations applied, `npm run db:harden` run, and the server
 * running on PORT (default 4000).
 *
 *   npm run verify:security
 *
 * Creates two throwaway accounts with timestamped emails and deletes them at
 * the end. Their audit rows necessarily remain - the log is append-only, and
 * a verification that could erase its own tracks would disprove the very
 * thing it is checking.
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const BASE = `http://localhost:${process.env.PORT ?? 4000}`;
const stamp = Date.now();
const GUARDIAN = {
  email: `verify-guardian-${stamp}@example.test`,
  password: 'verify-password-123',
  displayName: 'Verify Guardian',
};
const MONITORED = {
  email: `verify-monitored-${stamp}@example.test`,
  password: 'verify-password-123',
  displayName: 'Verify Monitored',
};

const prisma = new PrismaClient();
const results = [];
let failures = 0;

function record(name, passed, detail) {
  results.push({ name, passed });
  if (!passed) failures += 1;
  process.stdout.write(`  ${passed ? 'PASS' : 'FAIL'}  ${name}\n`);
  if (detail) process.stdout.write(`        ${detail}\n`);
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: payload };
}

async function expectRejected(label, sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
    record(label, false, 'The statement SUCCEEDED — the audit log is mutable. Run `npm run db:harden`.');
  } catch (err) {
    const line =
      String(err?.message ?? err)
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /append-only|privilege|permission|denied/i.test(l)) ?? 'rejected';
    record(label, true, line.slice(0, 130));
  }
}

async function finish() {
  try {
    await prisma.user.deleteMany({
      where: { email: { in: [GUARDIAN.email, MONITORED.email] } },
    });
  } catch {
    /* harmless if it fails */
  }
  await prisma.$disconnect();

  const passed = results.filter((r) => r.passed).length;
  process.stdout.write(`\n${'-'.repeat(46)}\n${passed}/${results.length} checks passed\n`);
  if (failures > 0) {
    process.stdout.write(`${failures} FAILED — see above.\n\n`);
    process.exit(1);
  }
  process.stdout.write('All security guarantees verified.\n\n');
}

async function main() {
  process.stdout.write('\nGuardian security verification\n==============================\n\n');

  try {
    const health = await api('/health');
    if (health.status !== 200) throw new Error(`status ${health.status}`);
  } catch (err) {
    process.stdout.write(
      `Cannot reach the server at ${BASE}.\nStart it with \`npm run dev\` first.\n(${err.message})\n\n`,
    );
    process.exit(1);
  }

  process.stdout.write('Audit log — append-only enforcement\n');
  const seed = await prisma.auditEvent.findFirst({ orderBy: { seq: 'desc' } });
  if (!seed) {
    record('audit log has a row to test against', false, 'None yet — sign in once, then re-run.');
  } else {
    await expectRejected(
      'UPDATE on audit_events is rejected',
      `UPDATE audit_events SET outcome = 'ALLOWED' WHERE seq = ${seed.seq}`,
    );
    await expectRejected(
      'DELETE on audit_events is rejected',
      `DELETE FROM audit_events WHERE seq = ${seed.seq}`,
    );
    await expectRejected('TRUNCATE on audit_events is rejected', 'TRUNCATE audit_events');
  }

  process.stdout.write('\nAccounts and hash chain\n');
  const g = await api('/api/auth/register', { method: 'POST', body: GUARDIAN });
  const m = await api('/api/auth/register', { method: 'POST', body: MONITORED });
  const gToken = g.body?.accessToken;
  const mToken = m.body?.accessToken;
  record('verification accounts created', Boolean(gToken && mToken), `guardian ${g.status}, monitored ${m.status}`);
  if (!gToken || !mToken) return finish();

  const chain = await api('/api/audit/verify', { token: gToken });
  record(
    'hash chain verifies',
    chain.body?.valid === true,
    chain.body?.valid ? `${chain.body.length} entries` : JSON.stringify(chain.body),
  );

  process.stdout.write('\nConsent pairing handshake\n');
  const invite = await api('/api/pairings/invites', { method: 'POST', token: gToken });
  record('guardian generates an invite code', invite.status === 201 && Boolean(invite.body?.code));

  const redeem = await api('/api/pairings/invites/redeem', {
    method: 'POST',
    token: mToken,
    body: { code: invite.body?.code },
  });
  const pairingId = redeem.body?.pairingId;
  record('monitored user redeems it', redeem.status === 201 && Boolean(pairingId));
  if (!pairingId) return finish();

  const beforeConfirm = await api(`/api/pairings/${pairingId}/sensor-sessions`, {
    method: 'POST',
    token: gToken,
    body: { kind: 'CAMERA' },
  });
  record(
    'nothing is shared before the guardian confirms',
    beforeConfirm.status === 403,
    `status ${beforeConfirm.status} ${beforeConfirm.body?.error?.code ?? ''}`,
  );

  const confirm = await api(`/api/pairings/${pairingId}/confirm`, { method: 'POST', token: gToken });
  record('guardian confirmation activates the pairing', confirm.status === 200);

  process.stdout.write('\nServer-authoritative privacy\n');
  const on = await api(`/api/pairings/${pairingId}/privacy`, {
    method: 'PATCH',
    token: mToken,
    body: { channel: 'CAMERA', enabled: true },
  });
  record('monitored user switches the camera on', on.status === 200);

  const allowed = await api(`/api/pairings/${pairingId}/sensor-sessions`, {
    method: 'POST',
    token: gToken,
    body: { kind: 'CAMERA' },
  });
  record('camera request succeeds while the switch is on', allowed.status === 201);

  await api(`/api/pairings/${pairingId}/privacy`, {
    method: 'PATCH',
    token: mToken,
    body: { channel: 'CAMERA', enabled: false },
  });

  const refused = await api(`/api/pairings/${pairingId}/sensor-sessions`, {
    method: 'POST',
    token: gToken,
    body: { kind: 'CAMERA' },
  });
  record(
    'FORCED camera request refused when the switch is off',
    refused.status === 403 && refused.body?.error?.code === 'PRIVACY_SHIELD_ACTIVE',
    `status ${refused.status} ${refused.body?.error?.code ?? ''} — "${refused.body?.error?.message ?? ''}"`,
  );

  const auditAfter = await api(`/api/pairings/${pairingId}/audit?limit=20`, { token: mToken });
  record(
    'the refusal is recorded in the audit log',
    (auditAfter.body?.events ?? []).some((e) => e.outcome === 'DENIED' && e.channel === 'CAMERA'),
  );

  process.stdout.write('\nPrivacy Shield and SOS\n');
  await api(`/api/pairings/${pairingId}/privacy`, {
    method: 'PATCH',
    token: mToken,
    body: { channel: 'CAMERA', enabled: true },
  });
  await api('/api/me/master-shield', { method: 'PUT', token: mToken, body: { active: true } });

  const shielded = await api(`/api/pairings/${pairingId}/sensor-sessions`, {
    method: 'POST',
    token: gToken,
    body: { kind: 'CAMERA' },
  });
  record(
    'Privacy Shield overrides an ON switch',
    shielded.status === 403,
    `status ${shielded.status} ${shielded.body?.error?.code ?? ''}`,
  );

  const sos = await api('/api/sos', {
    method: 'POST',
    token: mToken,
    body: { lat: 19.076, lng: 72.8777, accuracyMeters: 12 },
  });
  record(
    'SOS still works with the Shield up',
    sos.status === 201 && (sos.body?.notifiedGuardians ?? 0) >= 1,
    `notified ${sos.body?.notifiedGuardians ?? 0} guardian(s)`,
  );

  process.stdout.write('\nRevocation\n');
  const revoke = await api(`/api/pairings/${pairingId}/revoke`, {
    method: 'POST',
    token: mToken,
    body: { reason: 'verification' },
  });
  record('monitored user revokes without guardian approval', revoke.status === 200);

  await api('/api/me/master-shield', { method: 'PUT', token: mToken, body: { active: false } });
  const afterRevoke = await api(`/api/pairings/${pairingId}/sensor-sessions`, {
    method: 'POST',
    token: gToken,
    body: { kind: 'CAMERA' },
  });
  record(
    'revocation outranks everything else',
    afterRevoke.status === 403,
    `status ${afterRevoke.status} ${afterRevoke.body?.error?.code ?? ''}`,
  );

  await finish();
}

main().catch(async (err) => {
  process.stdout.write(`\nVerification crashed: ${err?.message ?? err}\n\n`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
