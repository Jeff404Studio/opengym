/**
 * Consent gate shared by enqueue, chat and cadence.
 * Must stay aligned with frontend CONSENT_VERSION in lib/coach.js — bump both together.
 */
export const CONSENT_VERSION = 1

export function hasConsent(S) {
  const c = S?.coach?.consent
  return !!(c?.agreedAt && c.version === CONSENT_VERSION)
}
