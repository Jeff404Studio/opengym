/**
 * Entity-level merge for Ferrum multi-device sync.
 *
 * Scalars (settings) use last-write `_ts` when both sides differ.
 * Collections merge by id (or date for bodyweight): newest `_rev` / `_ts` / object wins;
 * never drop an entity that only exists on one side.
 */

function tsOf(x, fallback = 0) {
  if (!x || typeof x !== 'object') return fallback
  return +(x._rev || x._ts || x.updatedAt || x.ts || 0) || fallback
}

function byId(list, key = 'id') {
  const m = new Map()
  for (const item of list || []) {
    if (item && item[key] != null) m.set(item[key], item)
  }
  return m
}

function mergeById(local = [], remote = [], rootLocalTs, rootRemoteTs, key = 'id') {
  const L = byId(local, key)
  const R = byId(remote, key)
  const ids = new Set([...L.keys(), ...R.keys()])
  const out = []
  for (const id of ids) {
    const a = L.get(id)
    const b = R.get(id)
    if (a && !b) out.push(a)
    else if (b && !a) out.push(b)
    else {
      const ta = tsOf(a, rootLocalTs)
      const tb = tsOf(b, rootRemoteTs)
      out.push(tb >= ta ? b : a)
    }
  }
  return out
}

function mergeBodyweight(local = [], remote = []) {
  const key = e => `${e.d}|${e.w}`
  // Prefer date uniqueness: one weigh-in per day — newest wins.
  const byDay = new Map()
  for (const e of [...(remote || []), ...(local || [])]) {
    if (!e || !e.d) continue
    const prev = byDay.get(e.d)
    if (!prev || tsOf(e, 0) >= tsOf(prev, 0) || (!prev._rev && e.w !== prev.w && tsOf(e) === tsOf(prev))) {
      // If no per-entry rev, last occurring from local (applied second) wins for same day.
      byDay.set(e.d, e)
    }
  }
  // Re-apply local last for same-day without rev so offline local edits stick when dirty.
  for (const e of local || []) {
    if (!e?.d) continue
    const prev = byDay.get(e.d)
    if (!prev) byDay.set(e.d, e)
    else if (tsOf(e) >= tsOf(prev)) byDay.set(e.d, e)
  }
  return [...byDay.values()].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
}

function mergeWeek(local = {}, remote = {}, preferRemote) {
  const days = new Set([...Object.keys(local || {}), ...Object.keys(remote || {})])
  const out = {}
  for (const d of days) {
    const a = local?.[d]
    const b = remote?.[d]
    if (a == null && b != null) out[d] = b
    else if (b == null && a != null) out[d] = a
    else out[d] = preferRemote ? b : a
  }
  return out
}

const SCALAR_KEYS = [
  'unit', 'restSec', 'sound', 'keepAwake', 'lang', 'theme', 'accent', 'body',
  'targetW', 'gifSize', 'effort', 'reminder', 'coach', 'onboarding'
]

/**
 * @param {object} local  current device state
 * @param {object} remote server state
 * @param {{ preferLocal?: boolean }} opts  preferLocal when local is dirty/offline edits
 */
export function mergeStates(local, remote, opts = {}) {
  if (!remote) return local
  if (!local) return remote
  const preferLocal = !!opts.preferLocal
  const lt = +(local._ts || 0)
  const rt = +(remote._ts || 0)
  const preferRemoteScalars = !preferLocal && rt >= lt

  const out = { ...remote, ...local }

  for (const k of SCALAR_KEYS) {
    if (preferRemoteScalars) {
      if (remote[k] !== undefined) out[k] = remote[k]
    } else if (local[k] !== undefined) {
      out[k] = local[k]
    }
  }

  out.routines = mergeById(local.routines, remote.routines, lt, rt)
  out.workouts = mergeById(local.workouts, remote.workouts, lt, rt)
  out.customEx = mergeById(local.customEx, remote.customEx, lt, rt)
  out.bodyweight = mergeBodyweight(local.bodyweight, remote.bodyweight)
  out.week = mergeWeek(local.week, remote.week, preferRemoteScalars)
  out.dayPlan = { ...(remote.dayPlan || {}), ...(preferLocal ? (local.dayPlan || {}) : {}), ...(preferRemoteScalars ? (remote.dayPlan || {}) : (local.dayPlan || {})) }
  out.exWeights = { ...(remote.exWeights || {}), ...(local.exWeights || {}) }
  if (preferRemoteScalars) out.exWeights = { ...(local.exWeights || {}), ...(remote.exWeights || {}) }

  // Never clobber an in-progress local workout.
  out.active = local.active || (preferRemoteScalars ? remote.active : local.active) || null

  out._ts = Math.max(lt, rt, Date.now())
  out.schemaVersion = Math.max(+(local.schemaVersion || 1), +(remote.schemaVersion || 1))
  return out
}
