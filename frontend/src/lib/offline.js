import { APP_NAME, PUBLISHER, SITE_URL } from './brand.js'

/** Offline mutation queue — flushed on reconnect / visibility. */
const QKEY = 'ferrum_offline_q'
const MAX = 50

export function enqueueOffline(op) {
  try {
    const q = JSON.parse(localStorage.getItem(QKEY) || '[]')
    q.push({ ...op, at: Date.now() })
    localStorage.setItem(QKEY, JSON.stringify(q.slice(-MAX)))
  } catch { /* quota */ }
}

export function peekOfflineQueue() {
  try { return JSON.parse(localStorage.getItem(QKEY) || '[]') } catch { return [] }
}

export function clearOfflineQueue() {
  localStorage.removeItem(QKEY)
}

/**
 * Flush: today the sync model is still a full-state PUT, so "flush" means
 * pushState once if dirty or queue non-empty. Kept as a seam for per-op sync later.
 */
export async function flushOfflineQueue(pushState) {
  const q = peekOfflineQueue()
  const dirty = localStorage.getItem('gym_dirty') === '1'
  if (!q.length && !dirty) return { flushed: 0 }
  try {
    await pushState()
    clearOfflineQueue()
    localStorage.removeItem('gym_dirty')
    return { flushed: q.length || 1 }
  } catch (e) {
    return { flushed: 0, error: e }
  }
}

export { APP_NAME, PUBLISHER, SITE_URL }
