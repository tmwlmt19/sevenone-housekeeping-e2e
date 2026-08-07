import { expect, type Page } from '@playwright/test'

/**
 * Clear the housekeeper clock-in gate. After signing in, a housekeeper lands on
 * My Tasks behind a gate that blocks work until they clock in (clock-out is
 * logout). Call this once after `loginAs(..., { expect: 'web' })` before
 * interacting with their tasks.
 */
export async function clockIn(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: 'Clock in' })
  await expect(button).toBeVisible()
  await button.click()
  // The gate lifts once the shift is open — the Clock in button is gone.
  await expect(button).toHaveCount(0)
}
