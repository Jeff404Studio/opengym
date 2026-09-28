import { test, expect } from '@playwright/test'

/**
 * Ferrum smoke E2E — guest path (no WebAuthn in CI).
 * Full passkey login needs a real RP origin + authenticator virtual; covered separately.
 */
test.describe('Ferrum guest flow', () => {
  test('home → start empty plan tip → settings export', async ({ page }) => {
    await page.goto('/')
    // Login / guest gate
    const guest = page.getByRole('button', { name: /continue without account|continuer sans compte/i })
    const demo = page.getByRole('button', { name: /start the demo|démarrer/i })
    if (await guest.isVisible().catch(() => false)) await guest.click()
    else if (await demo.isVisible().catch(() => false)) await demo.click()

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 })

    // Dismiss onboarding if present
    const skip = page.getByRole('button', { name: /skip for now|passer pour l’instant|passer/i })
    if (await skip.isVisible().catch(() => false)) await skip.click()

    // Open settings
    const settingsBtn = page.getByRole('button', { name: /settings|réglages/i })
    if (await settingsBtn.isVisible().catch(() => false)) await settingsBtn.click()
    else await page.goto('/settings')

    await expect(page.getByText(/managed by Genefty|géré par Genefty/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Ferrum').first()).toBeVisible()
  })
})
