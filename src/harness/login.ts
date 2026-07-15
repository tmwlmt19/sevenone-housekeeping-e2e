import { expect, type Page } from '@playwright/test'

import { APP } from '../config'

type AppKey = 'web' | 'admin'

const ORIGIN: Record<AppKey, string> = {
  web: APP.web,
  admin: APP.admin,
}

/**
 * Drive the REAL login app and wait for the SSO cookie handoff to land the user
 * on their role's app. This is the single entry point every journey starts from
 * — exercising it here is what proves the cross-origin cookie flow works.
 *
 * If `firstLoginNewPassword` is given, the account is expected to be on a temp
 * password: the login app shows the "Set a new password" card first, which this
 * helper completes before the redirect (the AUTH-04 forced-change ceremony).
 */
export async function loginAs(
  page: Page,
  email: string,
  password: string,
  opts: { expect: AppKey; firstLoginNewPassword?: string },
): Promise<void> {
  await page.goto(`${APP.login}/`)
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  if (opts.firstLoginNewPassword) {
    // Forced first-login change card.
    await page
      .getByLabel('New password', { exact: true })
      .fill(opts.firstLoginNewPassword)
    await page
      .getByLabel('Confirm password', { exact: true })
      .fill(opts.firstLoginNewPassword)
    await page
      .getByRole('button', { name: 'Save and continue' })
      .click()
  }

  const dest = ORIGIN[opts.expect]
  await page.waitForURL((url) => url.href.startsWith(dest), { timeout: 20_000 })
}

/** Assert the login form rejected the attempt (bad credentials): the error is
 * shown and no redirect happened. */
export async function expectLoginRejected(page: Page): Promise<void> {
  await expect(
    page.getByText('Incorrect email or password'),
  ).toBeVisible()
  expect(page.url().startsWith(APP.login)).toBe(true)
}

/** Click Logout in either shell and wait to be bounced back to the login app. */
export async function logout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Logout' }).click()
  await page.waitForURL((url) => url.href.startsWith(APP.login), {
    timeout: 20_000,
  })
}
