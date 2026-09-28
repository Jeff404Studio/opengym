// Ferrum starter / template programmes. Shared by Settings, Plan, onboarding and demo seed.
import { uid } from './format.js'

function pack(name, emoji, list) {
  return { id: uid(), name, emoji, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }
}

/** Classic 3-day Push / Pull / Legs. */
export const starterRoutines = () => [
  pack('Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]),
  pack('Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]),
  pack('Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]])
]

/** Full-body 3× / week — beginner-friendly volume. */
export const fullBodyRoutines = () => [
  pack('Full Body A', 'sparkles', [['0025', 3, 8], ['0027', 3, 8], ['0043', 3, 8], ['0294', 3, 12], ['0605', 3, 15]]),
  pack('Full Body B', 'sparkles', [['0047', 3, 10], ['2330', 3, 8], ['0085', 3, 10], ['0334', 3, 12], ['0585', 3, 12]])
]

/** Short return-to-training plan after a break. */
export const returnRoutines = () => [
  pack('Return A', 'reset', [['0025', 3, 10], ['0027', 3, 10], ['0043', 3, 10], ['0605', 3, 12]]),
  pack('Return B', 'reset', [['0047', 3, 10], ['2330', 3, 8], ['0085', 3, 12], ['0294', 3, 12]])
]

export const TEMPLATES = [
  {
    id: 'ppl',
    nameKey: 'Push / Pull / Legs',
    blurbKey: 'Three focused days — classic intermediate split.',
    build: starterRoutines,
    week: (ids) => ({ 1: ids[0], 3: ids[1], 5: ids[2] }),
    toastKey: 'Starter plan loaded — Mon Push · Wed Pull · Fri Legs'
  },
  {
    id: 'fullbody',
    nameKey: 'Full body',
    blurbKey: 'Two alternating sessions, three days a week.',
    build: fullBodyRoutines,
    week: (ids) => ({ 1: ids[0], 3: ids[1], 5: ids[0] }),
    toastKey: 'Full-body plan loaded — Mon A · Wed B · Fri A'
  },
  {
    id: 'return',
    nameKey: 'Return to training',
    blurbKey: 'Lighter volume after time off.',
    build: returnRoutines,
    week: (ids) => ({ 2: ids[0], 4: ids[1] }),
    toastKey: 'Return plan loaded — Tue A · Thu B'
  }
]

export function applyTemplate(st, templateId) {
  const tpl = TEMPLATES.find(t => t.id === templateId) || TEMPLATES[0]
  const routines = tpl.build()
  st.routines.push(...routines)
  const ids = routines.map(r => r.id)
  Object.assign(st.week, tpl.week(ids))
  return tpl
}
