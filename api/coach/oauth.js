/* Credential storage for the Coach (kept under this legacy filename so existing imports stay
 * stable). Browser OAuth is intentionally not implemented here: a self-hosted app must not
 * imitate another provider's login flow or handle its authorization codes.
 *
 * Instead, the instance owner creates a Claude Code setup token on a trusted machine with
 * `claude setup-token`, then pastes that value into the admin dashboard. It is encrypted at
 * rest and injected only into the unprivileged Agent SDK subprocess for the life of a job.
 *
 * Codex is different: its supported device-code login owns the ChatGPT credential inside
 * Codex's private auth cache. We never read, copy into coach.json, or return that credential. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  load, save, encrypt, decrypt, providerMeta,
  codexHome, codexAuthFile, ensureCodexHome, hasCodexAuth
} from './config.js';
import { run, unprivilegedIds } from './adapters/spawn.js';
import { CODEX_BIN } from './adapters/codex-cli.js';

const PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const FILE_STORE = 'cli_auth_credentials_store="file"';
const DEVICE_LOGIN_TIMEOUT_MS = 10 * 60000;
let deviceLogin = null;

function codexEnv() {
  const home = ensureCodexHome();
  return { PATH, HOME: home, CODEX_HOME: home, TMPDIR: '/tmp' };
}

function cleanLoginOutput(value) {
  // Device-code instructions intentionally contain a short-lived URL and verification code.
  // Strip terminal control bytes and any JWT-shaped value before rendering them in the admin UI.
  return String(value || '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[redacted]')
    .slice(-4096);
}

function failedLogin(attempt, fallback) {
  const detail = cleanLoginOutput(attempt.output).trim().split('\n').slice(-4).join(' ').trim();
  attempt.state = 'failed';
  attempt.error = (detail || fallback).slice(0, 500);
  attempt.finishedAt = Date.now();
  clearTimeout(attempt.timer);
}

function deviceLoginView() {
  if (deviceLogin && (deviceLogin.state === 'starting' || deviceLogin.state === 'pending')) {
    return {
      state: deviceLogin.state,
      instructions: cleanLoginOutput(deviceLogin.output) || 'Starting Codex device sign-in…'
    };
  }
  // Keep a useful error long enough for the operator to read it, then fall back to normal
  // connection status so a later admin session does not inherit stale login output.
  if (deviceLogin?.state === 'failed' && Date.now() - deviceLogin.finishedAt < 5 * 60000) {
    return { state: 'failed', error: deviceLogin.error };
  }
  return authStatus();
}

async function stopDeviceLogin() {
  const attempt = deviceLogin;
  if (!attempt || !['starting', 'pending'].includes(attempt.state) || !attempt.child) return;
  await new Promise(resolve => {
    let done = false;
    let force = null;
    const finish = () => {
      if (done) return;
      done = true;
      if (force) clearTimeout(force);
      resolve();
    };
    attempt.child.once('close', finish);
    force = setTimeout(() => {
      try { attempt.child.kill('SIGKILL'); } catch { /* finish below still clears the cache */ }
      finish();
    }, 2000);
    try { attempt.child.kill('SIGTERM'); } catch { finish(); }
  });
}

/** Begin Codex's own device-code sign-in. The browser interaction remains between the owner and OpenAI. */
export function startCodexDeviceLogin({ replace = false } = {}) {
  if (!providerMeta().deviceLogin) throw new Error('select OpenAI Codex CLI before starting ChatGPT sign-in');
  if (deviceLogin && (deviceLogin.state === 'starting' || deviceLogin.state === 'pending')) return deviceLoginView();
  if (hasCodexAuth() && !replace) return authStatus();
  // An admin who saw an expired credential explicitly chose to replace it. Remove only the
  // known cache file before starting the new provider-owned flow; no token is inspected.
  if (hasCodexAuth() && replace) {
    try { fs.unlinkSync(codexAuthFile()); } catch { /* login will report any real filesystem issue */ }
  }

  const home = ensureCodexHome();
  const ids = unprivilegedIds();
  const attempt = { state: 'starting', output: '', error: null, child: null, timer: null, timedOut: false, finishedAt: null };
  deviceLogin = attempt;

  try {
    const child = spawn(CODEX_BIN, ['login', '-c', FILE_STORE, '--device-auth'], {
      cwd: home,
      env: codexEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(ids || {})
    });
    attempt.child = child;
    const append = chunk => {
      attempt.output = cleanLoginOutput(attempt.output + chunk.toString());
      if (attempt.state === 'starting') attempt.state = 'pending';
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', err => failedLogin(attempt, err.message));
    child.on('close', code => {
      if (attempt.state === 'failed') return;
      if (!attempt.timedOut && code === 0 && hasCodexAuth()) {
        attempt.state = 'connected';
        attempt.finishedAt = Date.now();
        clearTimeout(attempt.timer);
        return;
      }
      failedLogin(attempt, attempt.timedOut ? 'ChatGPT device sign-in timed out' : 'ChatGPT device sign-in did not complete');
    });
    attempt.timer = setTimeout(() => {
      attempt.timedOut = true;
      try { child.kill('SIGTERM'); } catch { /* close handler records the timeout */ }
    }, DEVICE_LOGIN_TIMEOUT_MS);
    attempt.timer.unref();
  } catch (err) {
    failedLogin(attempt, err.message);
  }
  return deviceLoginView();
}

/** Status for an active device-code flow, or the normal Codex credential status once it ends. */
export const codexDeviceLoginStatus = () => deviceLoginView();

/** Store the owner-created Claude Code setup token without ever returning it to a client. */
export function setSetupToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) throw new Error('paste the token printed by claude setup-token');
  if (!providerMeta().setupToken) throw new Error('this provider does not support a Claude Code setup token');
  save({
    auth: {
      type: 'cli-token',
      connectedAt: new Date().toISOString(),
      account: null,
      data: encrypt({ token })
    }
  });
}

/** Kept for non-Claude providers and existing installations that already use a key. */
export function setApiKey(k) {
  const keyStr = String(k || '').trim();
  if (!keyStr) throw new Error('paste an API key');
  if (providerMeta().deviceLogin) throw new Error('sign in with ChatGPT from the Codex device-login flow');
  if (providerMeta().setupToken) throw new Error('use a Claude Code setup token for this provider');
  if (!providerMeta().apiKeyEnv) throw new Error('this provider takes no API key');
  save({ auth: { type: 'apikey', connectedAt: new Date().toISOString(), account: null, data: encrypt({ token: keyStr }) } });
}

/** Remove the provider's credential. Codex itself clears its cache; the exact auth file is a
 * final fallback if the CLI is no longer installed but the owner explicitly requested logout. */
export async function disconnect() {
  if (load().provider === 'codex') {
    await stopDeviceLogin();
    await run(CODEX_BIN, ['logout', '-c', FILE_STORE], { env: codexEnv(), cwd: codexHome(), timeoutMs: 20000 });
    try { fs.unlinkSync(codexAuthFile()); } catch { /* already absent is disconnected */ }
    deviceLogin = null;
  }
  save({ auth: null });
}

/** Admin-card view of the credential. Never returns the token itself. */
export function authStatus() {
  const cfg = load();
  if (cfg.provider === 'fixture') return { state: 'not-required' };
  if (cfg.provider === 'ollama') {
    return String(process.env.OLLAMA_BASE_URL || '').trim()
      ? { state: 'not-required' }
      : { state: 'disconnected' };
  }
  if (cfg.provider === 'codex') {
    if (!hasCodexAuth()) return { state: 'disconnected' };
    let connectedAt = null;
    try { connectedAt = fs.statSync(codexAuthFile()).mtime.toISOString(); } catch { /* presence was checked above */ }
    return { state: 'connected', type: 'chatgpt-cli', account: null, connectedAt, expiresAt: null };
  }
  if (!cfg.auth) return { state: 'disconnected' };
  const auth = decrypt(cfg.auth.data);
  if (!auth) return { state: 'unreadable' };   // ./data restored without its secret file
  if (cfg.provider === 'claude' && cfg.auth.type !== 'cli-token') {
    return { state: 'replace-required', type: cfg.auth.type, connectedAt: cfg.auth.connectedAt };
  }
  if (cfg.auth.expired) return { state: 'expired', account: cfg.auth.account, connectedAt: cfg.auth.connectedAt };
  return {
    state: 'connected', type: cfg.auth.type, account: cfg.auth.account,
    connectedAt: cfg.auth.connectedAt, expiresAt: auth.expiresAt || null
  };
}

/** `auth.json` can exist after a revoked session. The admin card performs a cheap live check
 * without exposing Codex's account output or token data. User routes still fail closed if a
 * later job cannot authenticate. */
export async function liveAuthStatus() {
  const status = authStatus();
  if (load().provider !== 'codex' || status.state !== 'connected') return status;
  const r = await run(CODEX_BIN, ['login', 'status', '-c', FILE_STORE], {
    env: codexEnv(), cwd: codexHome(), timeoutMs: 20000
  });
  return r.code === 0 ? status : { ...status, state: 'expired' };
}
