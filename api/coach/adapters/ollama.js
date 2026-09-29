/* Ollama HTTP adapter — local LLM via Ollama native API (no API key).
 *
 * Speaks the same Coach adapter contract as Claude/Codex/fixture:
 *   check(cfg, env) → { ok, version?, error? }
 *   invoke({ prompt, env, model, timeoutMs }) → { code, text, stderr, timedOut, spawnError }
 *
 * Base URL and model come from the job env (OLLAMA_BASE_URL, OLLAMA_MODEL), injected by
 * config.jobEnv() from process env — never hardcoded, never committed as secrets.
 */
const OUTPUT_CAP = 4 * 1024 * 1024;

function baseUrl(env) {
  const raw = (env?.OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL || '').trim().replace(/\/+$/, '');
  return raw || null;
}

function modelName(env, model) {
  return (model || env?.OLLAMA_MODEL || process.env.OLLAMA_MODEL || 'qwen3:1.7b').trim();
}

const SYSTEM = [
  'You are the Ferrum Coach.',
  'Answer only the supplied task and return exactly the requested JSON.',
  'Reply in French for any human-readable coach text fields.',
  'No medical diagnosis, no dangerous recommendations, no guaranteed results.',
  'You have no tools, filesystem access, or persistent memory.'
].join(' ');

async function fetchJson(url, { method = 'GET', body, timeoutMs } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    return { ok: res.ok, status: res.status, text, json };
  } finally {
    clearTimeout(timer);
  }
}

export default {
  id: 'ollama',
  runtime: 'Ollama HTTP',

  async check(_cfg, env) {
    const base = baseUrl(env);
    if (!base) return { ok: false, error: 'OLLAMA_BASE_URL is not set' };
    try {
      const r = await fetchJson(`${base}/api/tags`, { timeoutMs: 15000 });
      if (!r.ok) return { ok: false, error: `Ollama returned HTTP ${r.status}` };
      const names = (r.json?.models || []).map(m => m.name || m.model).filter(Boolean);
      const want = modelName(env);
      const has = names.some(n => n === want || n.startsWith(want + ':') || want.startsWith(n.split(':')[0]));
      if (names.length && !has) {
        return { ok: false, error: `model ${want} not found (have: ${names.slice(0, 5).join(', ') || 'none'})` };
      }
      return { ok: true, version: `Ollama · ${want}` };
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'Ollama did not answer in time' : (e instanceof Error ? e.message : String(e));
      return { ok: false, error: msg };
    }
  },

  async invoke({ prompt, env, model, timeoutMs, numPredict }) {
    const base = baseUrl(env);
    if (!base) {
      return { code: -1, text: '', stderr: 'OLLAMA_BASE_URL is not set', timedOut: false, spawnError: true };
    }
    const name = modelName(env, model);
    const predict = Number.isFinite(numPredict) && numPredict > 0 ? Math.floor(numPredict) : 1024;
    try {
      // Native chat API — keep format json so Coach validation gets structured output.
      // think:false is required for Qwen3: default "thinking" burns the whole chat budget
      // on chain-of-thought and then nginx / CHAT_TIMEOUT return 504 before a reply.
      const r = await fetchJson(`${base}/api/chat`, {
        method: 'POST',
        timeoutMs: timeoutMs || 180000,
        body: {
          model: name,
          stream: false,
          format: 'json',
          think: false,
          options: { temperature: 0.2, num_predict: predict },
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: prompt }
          ]
        }
      });
      if (!r.ok) {
        return {
          code: 1,
          text: '',
          stderr: (r.text || `HTTP ${r.status}`).slice(0, 500),
          timedOut: false,
          spawnError: false
        };
      }
      let text = (r.json?.message?.content || '').trim();
      if (!text && r.text) text = r.text.trim();
      if (text.length > OUTPUT_CAP) text = text.slice(0, OUTPUT_CAP);
      if (!text) {
        return { code: 1, text: '', stderr: 'Ollama returned an empty response', timedOut: false, spawnError: false };
      }
      return { code: 0, text, stderr: '', timedOut: false, spawnError: false };
    } catch (e) {
      const timedOut = e?.name === 'AbortError';
      return {
        code: -1,
        text: '',
        stderr: timedOut ? 'Ollama timed out' : (e instanceof Error ? e.message : String(e)),
        timedOut,
        spawnError: !timedOut
      };
    }
  }
};
