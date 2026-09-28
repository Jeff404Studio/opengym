import { describe, it, expect } from 'vitest'
import { mergeStates } from './merge-state.js'
import { migrateState, SCHEMA_VERSION } from './migrate.js'

describe('migrateState', () => {
  it('stamps schemaVersion and onboarding on legacy blobs', () => {
    const s = migrateState({ routines: [], workouts: [{ id: 'w1' }] })
    expect(s.schemaVersion).toBe(SCHEMA_VERSION)
    expect(s.onboarding.done).toBe(true)
    expect(s.reminder).toBeTruthy()
  })
})

describe('mergeStates', () => {
  it('keeps workouts that exist on only one side', () => {
    const local = { _ts: 100, workouts: [{ id: 'a', d: '2026-01-01' }], routines: [], bodyweight: [] }
    const remote = { _ts: 200, workouts: [{ id: 'b', d: '2026-01-02' }], routines: [], bodyweight: [] }
    const m = mergeStates(local, remote)
    expect(m.workouts.map(w => w.id).sort()).toEqual(['a', 'b'])
  })

  it('prefers local scalars when dirty', () => {
    const local = { _ts: 100, unit: 'lb', workouts: [], routines: [], bodyweight: [] }
    const remote = { _ts: 999, unit: 'kg', workouts: [], routines: [], bodyweight: [] }
    const m = mergeStates(local, remote, { preferLocal: true })
    expect(m.unit).toBe('lb')
  })

  it('merges bodyweight by day', () => {
    const local = { _ts: 2, workouts: [], routines: [], bodyweight: [{ d: '2026-01-01', w: 80, _rev: 2 }] }
    const remote = { _ts: 1, workouts: [], routines: [], bodyweight: [{ d: '2026-01-01', w: 79, _rev: 1 }, { d: '2026-01-02', w: 80.5 }] }
    const m = mergeStates(local, remote)
    expect(m.bodyweight.find(b => b.d === '2026-01-01').w).toBe(80)
    expect(m.bodyweight.find(b => b.d === '2026-01-02').w).toBe(80.5)
  })
})
