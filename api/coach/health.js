/* Circuit breaker for Coach providers (Ollama tunnel, Claude, Codex).
 * When open, jobs fail fast — core Ferrum tracking stays fully usable. */

const breaks = new Map() // provider -> { failures, openUntil, lastError }

const FAILURE_THRESHOLD = Math.max(1, +(process.env.COACH_CB_FAILURES || 3) || 3)
const OPEN_MS = Math.max(5000, +(process.env.COACH_CB_OPEN_MS || 60000) || 60000)

function key(provider) {
  return String(provider || 'default')
}

export function coachCircuitStatus(provider = 'default') {
  const b = breaks.get(key(provider))
  if (!b) return { open: false, failures: 0, openUntil: 0, lastError: null }
  const open = b.openUntil > Date.now()
  return { open, failures: b.failures, openUntil: b.openUntil, lastError: b.lastError || null }
}

export function coachCircuitAllow(provider) {
  const st = coachCircuitStatus(provider)
  return !st.open
}

export function coachCircuitSuccess(provider) {
  breaks.delete(key(provider))
}

export function coachCircuitFailure(provider, err) {
  const k = key(provider)
  const prev = breaks.get(k) || { failures: 0, openUntil: 0, lastError: null }
  const failures = prev.failures + 1
  const openUntil = failures >= FAILURE_THRESHOLD ? Date.now() + OPEN_MS : 0
  const lastError = String(err || '').slice(0, 300)
  breaks.set(k, { failures, openUntil, lastError })
  return coachCircuitStatus(provider)
}

export function coachCircuitReset(provider) {
  if (provider) breaks.delete(key(provider))
  else breaks.clear()
}
