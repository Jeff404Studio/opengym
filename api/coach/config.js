/* Coach instance configuration — the one place that knows whether this instance offers the
   AI Coach at all, which provider drives it, and how to authenticate to it.

   Everything lives in ./data/coach.json rather than the environment, because the whole point
   of the admin-dashboard flow is that enabling the Coach never requires editing a file or
   restarting the stack. The one env knob is COACH_DISABLED, which force-disables the feature
   regardless of what is stored — a fleet operator's kill switch, not a configuration step.

   Provider credentials normally live encrypted at rest with a key derived from ./data/secret
   (the same file that already signs session cookies, generated 0600 on first boot). ChatGPT
   sign-in is the exception: Codex owns its refreshable CLI credential in a separate private
   cache, rather than OpenGym importing or duplicating an OAuth token. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { unprivilegedIds } from './adapters/spawn.js';

const DATA = process.env.DATA_DIR || '/data';
const FILE = path.join(DATA, 'coach.json');
const coachCodexHome = process.env.COACH_CODEX_HOME || path.join(DATA, 'codex');
// This file is deliberately owned by OpenGym, not a person's normal Codex configuration. It
// gives spawned agent commands only their temporary workspace and the minimal runtime paths;
// specifically, `:root = "deny"` prevents a Coach prompt from reading /codex/auth.json.
const COACH_CODEX_CONFIG = `# Managed by openGym; do not add plugins, MCP servers, or broad permissions here.\ncli_auth_credentials_store = "file"\nallow_login_shell = false\napproval_policy = "never"\nweb_search = "disabled"\ndefault_permissions = "coach"\n\n[features]\nauth_elicitation = false\nshell_tool = false\nunified_exec = false\nshell_snapshot = false\nbrowser_use = false\nbrowser_use_external = false\nbrowser_use_full_cdp_access = false\nin_app_browser = false\ncomputer_use = false\napps = false\nplugins = false\nplugin_sharing = false\nremote_plugin = false\nmulti_agent = false\nskill_search = false\nskill_mcp_dependency_install = false\nworkspace_dependencies = false\nimage_generation = false\nhooks = false\ncode_mode_host = false\ntool_suggest = false\n\n[agents]\nenabled = false\n\n[permissions.coach.filesystem]\n":root" = "deny"\n":minimal" = "read"\n\n[permissions.coach.filesystem.":workspace_roots"]\n"." = "read"\n\n[permissions.coach.network]\nenabled = false\n`;
export const COACH_DISABLED = /^(1|true|yes|on)$/i.test(process.env.COACH_DISABLED || '');

// Providers this build can drive. `runtime` is what the adapter runs; the credential fields
// describe how an encrypted instance credential reaches that isolated runtime. Adding one is
// an adapter file plus a row here — nothing else in the codebase branches on provider identity.
export const PROVIDERS = {
  claude: { label: 'Claude Code', runtime: 'Claude Agent SDK', setupToken: true, apiKeyEnv: 'ANTHROPIC_API_KEY', oauthEnv: 'CLAUDE_CODE_OAUTH_TOKEN' },
  codex: { label: 'OpenAI Codex CLI', runtime: 'OpenAI Codex CLI', deviceLogin: true, apiKeyEnv: null, oauthEnv: null },
  // Local / self-hosted LLM via Ollama HTTP. No API key — OLLAMA_BASE_URL (+ optional OLLAMA_MODEL).
  ollama: { label: 'Ollama (local)', runtime: 'Ollama HTTP', noCred: true, apiKeyEnv: null, oauthEnv: null },
  // Test-only: drives the in-repo fixture CLI. Selectable so an instance can be exercised
  // end-to-end (and demoed) without any AI account at all.
  fixture: { label: 'Fixture (testing)', runtime: 'Fixture', apiKeyEnv: null, oauthEnv: null }
};

const DEFAULTS = {
  enabled: false,
  provider: 'claude',
  model: null,
  auth: null,                                    // { type:'cli-token'|'oauth'|'apikey', data:<encrypted> }
  caps: { perProfileDaily: 10, instanceDaily: 0 },   // 0 = unlimited
  log: []
};
const LOG_MAX = 100;

/* ---------- at-rest encryption ---------- */

let keyCache = null;
function key() {
  if (keyCache) return keyCache;
  // Read the secret lazily: server.js creates it at boot, and this module may be imported first.
  const secret = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim();
  keyCache = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from('opengym-coach-v1'), 32));
  return keyCache;
}
export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(blob) {
  try {
    const buf = Buffer.from(String(blob || ''), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }   // wrong key (restored ./data without the secret), or tampered file
}

/* ---------- load / save ---------- */

let cache = null;
function atomicWrite(file, content, mode) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}
export function load() {
  if (cache) return cache;
  let stored = {};
  try { stored = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* absent = feature off */ }
  const { customCommand: _customCommand, ...storedWithoutCustomCommand } = stored;
  cache = { ...DEFAULTS, ...storedWithoutCustomCommand, caps: { ...DEFAULTS.caps, ...(stored.caps || {}) } };
  // A retired provider must not leave the admin page in a state where no chip is selected, or
  // continue using its old credential. The next normal save also removes its legacy fields.
  if (!PROVIDERS[cache.provider]) {
    cache.provider = DEFAULTS.provider;
    cache.auth = null;
  }
  return cache;
}
export function save(patch) {
  const next = { ...load(), ...patch };
  cache = next;
  atomicWrite(FILE, JSON.stringify(next, null, 2), 0o600);
  return next;
}
// Test seam: forget the in-memory copy so the next load() re-reads from disk.
export function reset() { cache = null; keyCache = null; }

/* ---------- Codex's isolated ChatGPT credential cache ---------- */

/** The cache is a separate bind mount in Docker, owned by the unprivileged Coach user. */
export const codexHome = () => coachCodexHome;
export const codexAuthFile = () => path.join(codexHome(), 'auth.json');

/** Create the cache with ownership that lets a provider job refresh its own CLI session. */
export function ensureCodexHome() {
  const dir = codexHome();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch { /* bind-mounted host path may reject chmod */ }
  const ids = unprivilegedIds();
  if (ids) {
    try { fs.chownSync(dir, ids.uid, ids.gid); } catch { /* local development need not have this user */ }
  }
  const configFile = path.join(dir, 'config.toml');
  let existing = null;
  try { existing = fs.readFileSync(configFile, 'utf8'); } catch { /* write the managed file below */ }
  if (existing !== COACH_CODEX_CONFIG) {
    const tmp = configFile + '.tmp';
    fs.writeFileSync(tmp, COACH_CODEX_CONFIG, { mode: 0o600 });
    fs.renameSync(tmp, configFile);
  }
  try { fs.chmodSync(configFile, 0o600); } catch { /* bind-mounted host path may reject chmod */ }
  if (ids) {
    try { fs.chownSync(configFile, ids.uid, ids.gid); } catch { /* local development need not have this user */ }
  }
  return dir;
}

/** We deliberately inspect only the presence of Codex's cache, never its token contents. */
export function hasCodexAuth() {
  try { return fs.statSync(codexAuthFile()).isFile(); } catch { return false; }
}

/* ---------- derived state ---------- */

export const providerMeta = cfg => PROVIDERS[(cfg || load()).provider] || PROVIDERS.claude;

/** Is the feature switched on at all (before asking whether it can actually reach a model)? */
export function isEnabled() {
  if (COACH_DISABLED) return false;
  const cfg = load();
  return !!cfg.enabled && !!PROVIDERS[cfg.provider];
}
/** Credentials present? The fixture carries its own auth (or needs none). */
export function isConnected() {
  const cfg = load();
  if (!isEnabled()) return false;
  if (cfg.provider === 'fixture') return true;
  // Ollama needs a reachable base URL in the environment — no stored secret.
  if (cfg.provider === 'ollama') return !!String(process.env.OLLAMA_BASE_URL || '').trim();
  // Codex's ChatGPT credential remains in Codex's own auth.json cache, not coach.json.
  if (cfg.provider === 'codex') return hasCodexAuth();
  // Claude is intentionally setup-token only. Do not silently retain the old browser OAuth or
  // API-key paths after the instance has been upgraded to the Agent SDK flow.
  if (cfg.provider === 'claude' && cfg.auth?.type !== 'cli-token') return false;
  return !!(cfg.auth && decrypt(cfg.auth.data));
}
/** What /api/config tells every client. Absent ⇒ no Coach UI exists anywhere (FR-55/56). */
export function publicConfig() {
  if (!isEnabled() || !isConnected()) return null;
  const cfg = load();
  return { enabled: true, provider: cfg.provider, providerLabel: providerMeta(cfg).label };
}

/**
 * The environment a job's provider process gets. Deliberately built from nothing rather than
 * filtered from process.env: the child must not inherit RP_ID, ADMIN_UIDS, VAPID material or
 * anything else this server happens to hold.
 */
export function jobEnv(jobDir) {
  const cfg = load();
  const meta = providerMeta(cfg);
  const env = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: jobDir, TMPDIR: jobDir };
  if (cfg.provider === 'claude') {
    // The Agent SDK may otherwise read global Claude Code configuration. Keep every possible
    // file it touches inside the short-lived, unprivileged job directory instead.
    env.CLAUDE_CONFIG_DIR = jobDir;
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
  }
  if (cfg.provider === 'codex') {
    // This is the only persistent state a Codex job receives. The directory is a dedicated
    // bind mount owned by `coach`; /data and every OpenGym secret remain inaccessible.
    env.CODEX_HOME = ensureCodexHome();
  }
  if (cfg.provider === 'ollama') {
    // Explicitly pass through — jobEnv is built from scratch, not filtered from process.env.
    if (process.env.OLLAMA_BASE_URL) env.OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
    if (process.env.OLLAMA_MODEL) env.OLLAMA_MODEL = process.env.OLLAMA_MODEL;
  }
  const auth = cfg.auth ? decrypt(cfg.auth.data) : null;
  if (auth && auth.token && (cfg.provider !== 'claude' || cfg.auth.type === 'cli-token')) {
    const name = (cfg.auth.type === 'cli-token' || cfg.auth.type === 'oauth')
      ? meta.oauthEnv
      : cfg.auth.type === 'apikey' ? meta.apiKeyEnv : null;
    if (name) env[name] = auth.token;
  }
  return env;
}

/* ---------- instance-level job log (counts and outcomes only, never contents — FR-12/42) ---------- */

export function logJob(entry) {
  const cfg = load();
  const log = [...(cfg.log || []), entry].slice(-LOG_MAX);
  save({ log });
}
export const lastError = () => [...(load().log || [])].reverse().find(e => e.outcome === 'failed') || null;
export const lastSuccess = () => [...(load().log || [])].reverse().find(e => e.outcome === 'ready' || e.outcome === 'nochange') || null;
