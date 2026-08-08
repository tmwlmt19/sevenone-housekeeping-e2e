/**
 * AUTH-* — authentication & session, the cross-cutting seam every journey rides.
 * Covers role-based login routing, the SSO cookie handoff, the forced first-login
 * password change, forgot/reset password, logout, and the defensive redirects.
 *
 * Catalogue: sevenone-docs/housekeeping/testing/user-paths.md (AUTH-*).
 */
import { ADMIN, APP } from '../src/config'
import { expect, test } from '../src/fixtures'
import { Api } from '../src/harness/api'
import { closeDb, isResetTokenUsed, mintResetToken } from '../src/harness/db'
import { expectLoginRejected, loginAs, logout } from '../src/harness/login'
import { provisionHotel } from '../src/harness/seed'
import { journey } from '../src/harness/step'

test.afterAll(async () => {
  await closeDb()
})

test('AUTH-01: admin signs in and lands in the console', async ({ page }) => {
  const j = journey('AUTH-01')
  await j.step('sign in as the platform admin', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
  })
  await j.step('landed on the admin console origin', async () => {
    expect(page.url().startsWith(APP.admin)).toBe(true)
  })
})

test('AUTH-02: manager signs in and lands on the dashboard', async ({
  page,
  hotel,
}) => {
  const j = journey('AUTH-02')
  await j.step('sign in as the hotel manager', async () => {
    await loginAs(page, hotel.manager.email, hotel.manager.password, {
      expect: 'web',
    })
  })
  await j.step('redirected to /dashboard', async () => {
    await expect(page).toHaveURL(`${APP.web}/dashboard`)
  })
})

test('AUTH-03: housekeeper signs in and lands on mobile My Tasks', async ({
  page,
  hotel,
}) => {
  const j = journey('AUTH-03')
  await j.step('sign in as the housekeeper', async () => {
    await loginAs(page, hotel.housekeeper.email, hotel.housekeeper.password, {
      expect: 'web',
    })
  })
  await j.step('redirected to /my-tasks', async () => {
    await expect(page).toHaveURL(`${APP.web}/my-tasks`)
  })
})

test('AUTH-04: forced password change on first login, then temp password stops working', async ({
  page,
  browser,
}) => {
  const j = journey('AUTH-04')
  // A freshly provisioned user still carries must_change_password=true.
  const fresh = await provisionHotel({ label: 'ForcedChange', clearForcedChange: false })
  const newPassword = 'BrandNewPass123!'

  await j.step('log in with the temp password → set a new one → land in the app', async () => {
    await loginAs(page, fresh.manager.email, fresh.tempPassword, {
      expect: 'web',
      firstLoginNewPassword: newPassword,
    })
    await expect(page).toHaveURL(`${APP.web}/dashboard`)
  })

  await j.step('the original temp password is now rejected', async () => {
    const ctx = await browser.newContext()
    const p2 = await ctx.newPage()
    await p2.goto(`${APP.login}/`)
    await p2.getByLabel('Email', { exact: true }).fill(fresh.manager.email)
    await p2.getByLabel('Password', { exact: true }).fill(fresh.tempPassword)
    await p2.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expectLoginRejected(p2)
    await ctx.close()
  })
})

test('AUTH-05: forgot-password shows the same confirmation for known and unknown emails', async ({
  page,
  hotel,
}) => {
  const j = journey('AUTH-05')
  const confirmation = /if that email exists/i

  await j.step('request a reset for a real account', async () => {
    await page.goto(`${APP.login}/`)
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await page.getByLabel('Email', { exact: true }).fill(hotel.manager.email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText(confirmation)).toBeVisible()
  })

  await j.step('an unknown email yields the identical confirmation (no enumeration)', async () => {
    await page.goto(`${APP.login}/`)
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await page
      .getByLabel('Email', { exact: true })
      .fill('nobody-unknown@e2e-sevenone.com')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText(confirmation)).toBeVisible()
  })
})

test('AUTH-06: reset password via an emailed token', async ({ page, hotel }) => {
  const j = journey('AUTH-06')
  const newPassword = 'ResetViaLink123!'
  let rawToken = ''

  await j.step('mint a reset token (email send is a no-op in dev)', async () => {
    rawToken = await mintResetToken(hotel.housekeeper.id)
  })

  await j.step('open the reset link and set a new password', async () => {
    await page.goto(`${APP.login}/reset-password?token=${rawToken}`)
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Confirm password', { exact: true }).fill(newPassword)
    await page.getByRole('button', { name: 'Reset password' }).click()
    await expect(page.getByText(/your password has been reset/i)).toBeVisible()
  })

  await j.step('the token is single-use (consumed) and the new password works', async () => {
    expect(await isResetTokenUsed(rawToken)).toBe(true)
    // A fresh API login with the new password succeeds.
    const api = new Api()
    await api.login(hotel.housekeeper.email, newPassword)
  })
})

test('AUTH-07: logout clears the session', async ({ page, hotel }) => {
  const j = journey('AUTH-07')
  await j.step('sign in as manager', async () => {
    await loginAs(page, hotel.manager.email, hotel.manager.password, {
      expect: 'web',
    })
  })
  await j.step('log out → bounced to the login app', async () => {
    await logout(page)
    expect(page.url().startsWith(APP.login)).toBe(true)
  })
  await j.step('revisiting an app route with no session redirects back to login', async () => {
    await page.goto(`${APP.web}/dashboard`)
    await page.waitForURL((url) => url.href.startsWith(APP.login), {
      timeout: 20_000,
    })
  })
})

test('AUTH-08: an unauthenticated deep link is bounced to login, then returned after sign-in', async ({
  page,
  hotel,
}) => {
  const j = journey('AUTH-08')
  await j.step('open a protected hotel-app URL with no session', async () => {
    await page.goto(`${APP.web}/tasks`)
    // The API client 401s → redirects to the login app carrying ?redirect=.
    await page.waitForURL((url) => url.href.startsWith(APP.login), {
      timeout: 20_000,
    })
    expect(page.url()).toContain('redirect=')
  })
  await j.step('sign in → returned to the originally requested /tasks', async () => {
    await page.getByLabel('Email', { exact: true }).fill(hotel.manager.email)
    await page.getByLabel('Password', { exact: true }).fill(hotel.manager.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).toHaveURL(`${APP.web}/tasks`)
  })
})

test('AUTH-01-N: a wrong password is rejected with no session', async ({
  page,
}) => {
  const j = journey('AUTH-01-N')
  await j.step('submit a valid email with a wrong password', async () => {
    await page.goto(`${APP.login}/`)
    await page.getByLabel('Email', { exact: true }).fill(ADMIN.email)
    await page.getByLabel('Password', { exact: true }).fill('definitely-wrong')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  })
  await j.step('error shown, still on login, no redirect', async () => {
    await expectLoginRejected(page)
  })
})

test('AUTH-08-N: an admin with a hotel-app ?redirect= still lands on the admin console', async ({
  page,
}) => {
  const j = journey('AUTH-08-N')
  await j.step('arrive at login carrying a hotel-app redirect', async () => {
    const foreign = encodeURIComponent(`${APP.web}/tasks`)
    await page.goto(`${APP.login}/?redirect=${foreign}`)
  })
  await j.step('sign in as admin', async () => {
    await page.getByLabel('Email', { exact: true }).fill(ADMIN.email)
    await page.getByLabel('Password', { exact: true }).fill(ADMIN.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL((url) => url.href.startsWith(APP.admin), {
      timeout: 20_000,
    })
  })
  await j.step('landed on the admin console, never the hotel app', async () => {
    expect(page.url().startsWith(APP.admin)).toBe(true)
    expect(page.url().startsWith(APP.web)).toBe(false)
  })
})

test('AUTH-09-N: losing the session mid-use bounces to login', async ({
  page,
  context,
  hotel,
}) => {
  const j = journey('AUTH-09-N')
  await j.step('sign in as manager', async () => {
    await loginAs(page, hotel.manager.email, hotel.manager.password, {
      expect: 'web',
    })
  })
  await j.step('clear the session cookie, then navigate', async () => {
    await context.clearCookies()
    await page.goto(`${APP.web}/rooms`)
  })
  await j.step('the 401 redirects back to the login app', async () => {
    await page.waitForURL((url) => url.href.startsWith(APP.login), {
      timeout: 20_000,
    })
  })
})

test('AUTH-10: the login password field can be shown and hidden', async ({
  page,
}) => {
  const j = journey('AUTH-10')
  const field = page.getByLabel('Password', { exact: true })

  await j.step('open the login page; the password field is masked', async () => {
    await page.goto(`${APP.login}/`)
    await field.fill('some-secret-value')
    await expect(field).toHaveAttribute('type', 'password')
  })
  await j.step('the eye toggle reveals the password', async () => {
    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(field).toHaveAttribute('type', 'text')
  })
  await j.step('toggling again re-masks it', async () => {
    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(field).toHaveAttribute('type', 'password')
  })
})
