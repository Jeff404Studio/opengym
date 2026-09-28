// Demo build (VITE_DEMO=1) — static demo without a backend.
import { SITE_URL } from './brand.js'

export const DEMO = import.meta.env.VITE_DEMO === '1'
export const DEMO_SEEDED = 'gym_demo_seeded_v1'
export const SITE = SITE_URL
