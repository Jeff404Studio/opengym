/* End-to-end through the real queue, the real validator and a real child process — the only
   fake is the provider itself. Every outcome the user can be shown is reachable here without
   an AI account, which is the whole reason the fixture CLI exists. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');

cfg.save({ enabled: true, provider: 'fixture' });

/** Jobs are async by design; the tests wait the way the client does — by polling status. */
async function settle(uid, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = jobs.status(uid);
    if (!s.job) return s;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('job never finished');
}
const lastOutcome = uid => jobs.readUser(uid).history.at(-1);

test('a review job produces a validated, applyable proposal', async () => {
  const uid = 'u-review';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  assert.equal(lastOutcome(uid).outcome, 'ready');
  assert.ok(s.pending, 'a proposal is waiting');
  assert.equal(s.pending.kind, 'review');
  assert.ok(s.pending.changes.length > 0);
  assert.ok(s.pending.changes.every(c => c.why), 'every change carries its rationale');
  assert.ok(s.pending.planHash, 'the plan it was computed against is fingerprinted');
  assert.ok(s.pending.expiresAt > Date.now());
});

test('a creation job produces a plan bundle in the app\'s own share format', async () => {
  const uid = 'u-create';
  writeState(DIR, uid, sampleState({ routines: [], week: {}, workouts: [] }));
  jobs.enqueue(uid, { kind: 'create', intake: { goal: 'muscle', daysPerWeek: 3, equipment: ['dumbbell'] } });
  const s = await settle(uid);
  assert.equal(lastOutcome(uid).outcome, 'ready');
  assert.equal(s.pending.bundle.ferrum_plan, 1);
  assert.ok(s.pending.bundle.routines.length > 0);
});

test('no consent, no job — the gate is on the server, not the screen', () => {
  const uid = 'u-noconsent';
  writeState(DIR, uid, sampleState({ coach: {} }));
  assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'consent');
});

test('one job per profile at a time', async () => {
  const uid = 'u-single';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'busy');
  await settle(uid);
});

test('the daily cap is enforced and reported as its own failure', async () => {
  const uid = 'u-cap';
  writeState(DIR, uid, sampleState());
  cfg.save({ caps: { perProfileDaily: 1, instanceDaily: 0 } });
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  assert.throws(() => jobs.enqueue(uid, { kind: 'review' }), e => e.code === 'cap');
  assert.equal(jobs.capState(uid).used, 1);
  cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
});

test('a malformed answer is repaired once, then accepted', async () => {
  const uid = 'u-repair';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'invalid-then-valid';
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  delete process.env.FIXTURE_MODE;
  assert.equal(lastOutcome(uid).outcome, 'ready', 'the repair round rescued it');
  assert.ok(s.pending.changes.length > 0);
});

test('an answer that stays unusable fails cleanly and applies nothing', async () => {
  const uid = 'u-unusable';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'invalid';
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  delete process.env.FIXTURE_MODE;
  const last = lastOutcome(uid);
  assert.equal(last.outcome, 'failed');
  assert.equal(last.errorClass, 'unusable');
  assert.equal(s.pending, null, 'nothing partial is ever left behind');
});

test('a provider that crashes is reported, not retried behind the user\'s back', async () => {
  const uid = 'u-crash';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'crash';
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  delete process.env.FIXTURE_MODE;
  assert.equal(lastOutcome(uid).outcome, 'failed');
  assert.equal(jobs.readUser(uid).history.filter(h => h.outcome === 'failed').length, 1, 'exactly one attempt');
});

test('nothing worth changing produces no proposal and nothing to notify about', async () => {
  const uid = 'u-nochange';
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = 'nochange';
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  delete process.env.FIXTURE_MODE;
  assert.equal(lastOutcome(uid).outcome, 'nochange');
  assert.equal(s.pending, null);
});

test('resolving a proposal records the decision and clears it', async () => {
  const uid = 'u-resolve';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  jobs.resolvePending(uid, { accepted: [s.pending.changes[0].id], rejected: [] });
  assert.equal(jobs.status(uid).pending, null);
  assert.equal(lastOutcome(uid).outcome, 'applied');
  assert.equal(lastOutcome(uid).accepted, 1);
});

test('an expired proposal disappears on read rather than lingering forever', async () => {
  const uid = 'u-expire';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  const rec = jobs.readUser(uid);
  rec.pending.expiresAt = Date.now() - 1;
  fs.writeFileSync(`${DIR}/coach/${uid}.json`, JSON.stringify(rec));
  assert.equal(jobs.status(uid).pending, null);
  assert.equal(lastOutcome(uid).outcome, 'expired');
});

test('forgetting a profile leaves no server-side residue', async () => {
  const uid = 'u-forget';
  writeState(DIR, uid, sampleState());
  jobs.enqueue(uid, { kind: 'review' });
  await settle(uid);
  jobs.clearUser(uid);
  const s = jobs.status(uid);
  assert.equal(s.pending, null);
  assert.deepEqual(jobs.readUser(uid).history, []);
});

test('a job interrupted by a restart is reported as failed, not left spinning', () => {
  const uid = 'u-restart';
  fs.mkdirSync(`${DIR}/coach`, { recursive: true });
  fs.writeFileSync(`${DIR}/coach/${uid}.json`, JSON.stringify({
    current: { id: 'j1', kind: 'review', state: 'running', startedAt: Date.now() - 60000 }, history: []
  }));
  jobs.recoverOnBoot();
  assert.equal(jobs.status(uid).job, null);
  assert.equal(lastOutcome(uid).errorClass, 'restart');
});

test('the plan fingerprint moves when the plan does, and only then', async () => {
  const payload = await import('../coach/payload.js');
  const plan = payload.canonicalPlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { 1: 'r1' } });
  const same = payload.canonicalPlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10, weight: 0 }] }], week: { 1: 'r1' } });
  const moved = payload.canonicalPlan({ routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 4, reps: 10 }] }], week: { 1: 'r1' } });
  assert.equal(jobs.hashPlan(plan), jobs.hashPlan(same));
  assert.notEqual(jobs.hashPlan(plan), jobs.hashPlan(moved));
});

