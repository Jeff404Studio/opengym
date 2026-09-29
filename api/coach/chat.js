/* Synchronous Coach chat — short Q&A that never writes the plan.
 *
 * Plan create/review stay on the job queue (minutes-scale, validated change-sets).
 * Chat is a bounded round-trip: consent + caps, slim context, one invoke, JSON reply.
 * Nothing here mutates routines/week; escalate_to_review only hints the client UI.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cfgStore from './config.js';
import { adapterFor } from './adapters/index.js';
import { extractJSON } from './validate.js';
import { CoachError, readState, capState, bumpDaily } from './jobs.js';
import { hasConsent } from './consent.js';

const PROMPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts');
// Keep below nginx proxy_read_timeout (180s) so the API can return a typed timeout, not a bare 504.
const CHAT_TIMEOUT_MS = 120_000;
const MSG_MAX = 800;
const HISTORY_MAX = 8;
const REPLY_MAX = 2000;
const CHAT_NUM_PREDICT = 400;

function promptPart(name) {
  return fs.readFileSync(path.join(PROMPTS, name), 'utf8');
}

function instanceUsedToday() {
  const d = new Date().toISOString().slice(0, 10);
  return (cfgStore.load().log || []).filter(e => (e.at || '').slice(0, 10) === d).length;
}

/** Slim, allowlisted context — never full state, never identity. */
export function buildChatContext(S) {
  const routines = (S?.routines || []).slice(0, 5).map(r => ({
    name: r.name || '',
    ex: (r.ex || []).slice(0, 8).map(e => ({
      id: e.id,
      sets: e.sets || 0,
      reps: e.reps || null
    }))
  }));
  const week = {};
  for (const d of [1, 2, 3, 4, 5, 6, 0]) {
    if (S?.week?.[d]) {
      const r = (S.routines || []).find(x => x.id === S.week[d]);
      week[d] = r?.name || S.week[d];
    }
  }
  const workouts = (S?.workouts || []).slice(-5).map(w => ({
    d: w.d,
    name: w.name || '',
    nSets: (w.entries || []).reduce((n, e) => n + (e.sets || []).filter(s => s.done !== false).length, 0)
  }));
  const profile = S?.coach?.profile ? {
    goal: S.coach.profile.goal || null,
    daysPerWeek: S.coach.profile.daysPerWeek || null,
    sessionMin: S.coach.profile.sessionMin || null,
    limitations: S.coach.profile.limitations || null,
    dislikes: S.coach.profile.dislikes || null
  } : null;
  const libraryIds = [...new Set(
    (S?.routines || []).flatMap(r => (r.ex || []).map(e => e.id)).filter(Boolean)
  )].slice(0, 40);

  return {
    meta: { lang: S?.lang || 'fr', unit: S?.unit || 'kg', effortScale: S?.effort || S?.showRir ? 'rir' : null },
    plan: { routines, week },
    recentWorkouts: workouts,
    profile,
    libraryIds
  };
}

function buildPrompt(payload) {
  // Chat-only prompt: skip common.md (plan-design rules) — too large/slow for small local models.
  return promptPart('chat.md') +
    '\n\n---\n\n## Payload\n\n```json\n' + JSON.stringify(payload) + '\n```\n';
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-HISTORY_MAX).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    text: String(m.text || m.content || '').slice(0, MSG_MAX)
  })).filter(m => m.text);
}

/**
 * One chat turn. Throws CoachError with the same codes as enqueue (`off`, `cap`, `consent`).
 * Does not participate in the plan-job queue / single-flight lock.
 */
export async function ask(uid, { message, history } = {}) {
  if (!cfgStore.isEnabled() || !cfgStore.isConnected()) throw new CoachError('off', 'the Coach is not set up on this instance');

  const text = String(message || '').trim().slice(0, MSG_MAX);
  if (!text) throw new CoachError('empty', 'empty message');

  const S = readState(uid);
  if (!hasConsent(S)) throw new CoachError('consent', 'the Coach needs your go-ahead first');

  const caps = cfgStore.load().caps || {};
  const { used, limit } = capState(uid);
  if (limit > 0 && used >= limit) throw new CoachError('cap', 'daily limit reached');
  if (caps.instanceDaily > 0 && instanceUsedToday() >= caps.instanceDaily) throw new CoachError('cap', 'this instance has reached its daily limit');

  bumpDaily(uid);

  const cfg = cfgStore.load();
  const adapter = adapterFor(cfg.provider);
  if (!adapter) throw new CoachError('off', 'the Coach is not set up on this instance');

  const payload = {
    message: text,
    history: sanitizeHistory(history),
    context: buildChatContext(S)
  };
  const prompt = buildPrompt(payload);

  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-chat-'));
  const env = cfgStore.jobEnv(jobDir);
  const started = Date.now();
  try {
    const ids = (await import('./adapters/spawn.js')).unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);

    const r = await adapter.invoke({
      cfg, prompt, jobDir, env, model: cfg.model || null,
      timeoutMs: CHAT_TIMEOUT_MS,
      numPredict: CHAT_NUM_PREDICT
    });

    if (r.timedOut) {
      cfgStore.logJob({ at: new Date().toISOString(), uid, kind: 'chat', trigger: 'manual', outcome: 'failed', errorClass: 'timeout', ms: Date.now() - started });
      throw new CoachError('timeout', 'the Coach took too long');
    }
    if (r.spawnError || r.code !== 0) {
      cfgStore.logJob({ at: new Date().toISOString(), uid, kind: 'chat', trigger: 'manual', outcome: 'failed', errorClass: 'provider', ms: Date.now() - started, detail: (r.stderr || '').slice(0, 200) });
      throw new CoachError('provider', 'the Coach could not answer');
    }

    const parsed = extractJSON(r.text);
    let reply = '';
    let escalate = false;
    if (!parsed.error && parsed.value && typeof parsed.value === 'object') {
      reply = String(parsed.value.reply || parsed.value.message || parsed.value.text || '').trim();
      escalate = !!parsed.value.escalate_to_review;
    }
    if (!reply) {
      // Soft fallback: some small models ignore JSON; still return usable prose.
      reply = String(r.text || '').replace(/```[\s\S]*?```/g, '').trim().slice(0, REPLY_MAX);
    }
    if (!reply) {
      cfgStore.logJob({ at: new Date().toISOString(), uid, kind: 'chat', trigger: 'manual', outcome: 'failed', errorClass: 'unusable', ms: Date.now() - started });
      throw new CoachError('unusable', 'the Coach answered with nothing usable');
    }

    reply = reply.slice(0, REPLY_MAX);
    cfgStore.logJob({
      at: new Date().toISOString(), uid, kind: 'chat', trigger: 'manual',
      outcome: 'ready', errorClass: null, ms: Date.now() - started
    });
    return { reply, escalate_to_review: escalate, cap: capState(uid) };
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
