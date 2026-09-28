/** Schema versioning for Ferrum local/synced state. */

export const SCHEMA_VERSION = 2

/**
 * Migrate a raw state blob up to SCHEMA_VERSION.
 * Safe to call on every boot / pull / import.
 */
export function migrateState(raw) {
  const s = raw && typeof raw === 'object' ? { ...raw } : {}
  let v = Number.isFinite(+s.schemaVersion) ? +s.schemaVersion : 1

  if (v < 2) {
    // v2: Ferrum branding era — ensure coach/reminder shapes exist, drop nothing.
    if (!s.reminder || typeof s.reminder !== 'object') s.reminder = { on: false, time: '08:00', tz: null }
    if (s.coach === undefined) s.coach = null
    if (!s.onboarding || typeof s.onboarding !== 'object') {
      s.onboarding = { done: !!(s.routines?.length || s.workouts?.length), goal: null, days: null, equipment: null }
    }
    v = 2
  }

  s.schemaVersion = SCHEMA_VERSION
  return s
}
