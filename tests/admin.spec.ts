/**
 * ADM-* — the platform admin's world in the console app: provisioning hotels
 * (manual + CSV), editing a hotel/its rooms/its staff, and working the global
 * access-request queue (approve creates the staff/room; reject closes it).
 *
 * Catalogue: sevenone-docs/housekeeping/testing/user-paths.md (ADM-*).
 */
import type { Locator, Page } from '@playwright/test'

import { ADMIN, APP, TEST_USER_PASSWORD } from '../src/config'
import { expect, test } from '../src/fixtures'
import { Api } from '../src/harness/api'
import { loginAs } from '../src/harness/login'
import { uniqueSuffix } from '../src/harness/seed'
import { journey } from '../src/harness/step'
import { chooseOption, selectShowing } from '../src/harness/ui'

/** The Requests card that mentions `text` — robust against the global queue
 * showing other tests' cards in parallel (innermost matching element wins). */
function requestCard(page: Page, text: string): Locator {
  return page
    .locator('div')
    .filter({ hasText: text })
    .filter({ has: page.getByRole('button', { name: 'Approve' }) })
    .last()
}

test('ADM-01: provision a hotel manually (details → room → staff → review)', async ({
  page,
}) => {
  const j = journey('ADM-01')
  const suffix = uniqueSuffix()
  const hotelName = `E2E Manual ${suffix}`
  const staffEmail = `wizard-${suffix}@e2e-sevenone.com`

  await j.step('sign in and open the new-hotel wizard', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
    await page.goto(`${APP.admin}/hotels/new`)
  })
  await j.step('details step: hotel name', async () => {
    await page.getByLabel('Hotel name').fill(hotelName)
    await page.getByRole('button', { name: 'Continue' }).click()
  })
  await j.step('rooms step: add one room', async () => {
    await page.getByRole('button', { name: 'Add room' }).click()
    await page.getByPlaceholder('101').fill('101')
    await page.getByRole('button', { name: 'Continue' }).click()
  })
  await j.step('staff step: add one housekeeper', async () => {
    await page.getByRole('button', { name: 'Add staff member' }).click()
    await page.getByPlaceholder('Jane Doe').fill(`Wizard Hire ${suffix}`)
    await page.getByPlaceholder('jane@example.com').fill(staffEmail)
    await page.getByRole('button', { name: 'Continue' }).click()
  })
  await j.step('review → create; the shared temp password is shown once', async () => {
    await page.getByRole('button', { name: 'Create hotel' }).click()
    await expect(page.getByText('Shared temporary password')).toBeVisible()
  })
  await j.step('the new hotel appears in the list', async () => {
    await page.getByRole('link', { name: 'Back to hotels' }).click()
    await expect(page).toHaveURL(`${APP.admin}/hotels`)
    await expect(page.getByText(hotelName)).toBeVisible()
  })
})

test('ADM-02: provision a hotel via CSV import', async ({ page }) => {
  const j = journey('ADM-02')
  const suffix = uniqueSuffix()
  const hotelName = `E2E CSV ${suffix}`
  const roomsCsv = 'room_number,floor,room_type,status\n401,4,STD,clean\n402,4,DLX,dirty\n'
  const staffCsv = `email,name,role\ncsv-mgr-${suffix}@e2e-sevenone.com,CSV Manager,manager\ncsv-hk-${suffix}@e2e-sevenone.com,CSV Housekeeper,housekeeper\n`

  await j.step('sign in and open the wizard', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
    await page.goto(`${APP.admin}/hotels/new`)
    await page.getByLabel('Hotel name').fill(hotelName)
    await page.getByRole('button', { name: 'Continue' }).click()
  })
  await j.step('upload the rooms CSV', async () => {
    await page.locator('input[type="file"]').setInputFiles({
      name: 'rooms.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(roomsCsv),
    })
    // Parsed rows populate editable inputs; the header count confirms the load.
    await expect(page.getByText('2 rooms', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
  })
  await j.step('upload the staff CSV', async () => {
    await page.locator('input[type="file"]').setInputFiles({
      name: 'staff.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(staffCsv),
    })
    await expect(page.getByText('2 staff members', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
  })
  await j.step('review → create the hotel', async () => {
    await page.getByRole('button', { name: 'Create hotel' }).click()
    await expect(page.getByText('Shared temporary password')).toBeVisible()
  })
})

test('ADM-03: edit a hotel’s settings', async ({ page, hotel }) => {
  const j = journey('ADM-03')
  const newName = `${hotel.hotelName} (renamed)`
  await j.step('sign in and open the hotel', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
    await page.goto(`${APP.admin}/hotels/${hotel.hotelId}`)
  })
  await j.step('rename it and save', async () => {
    await page.getByLabel('Name', { exact: true }).fill(newName)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Hotel updated')).toBeVisible()
  })
})

test('ADM-04: edit a staff member', async ({ page, hotel }) => {
  const j = journey('ADM-04')
  const newName = `Renamed HK ${uniqueSuffix()}`
  await j.step('sign in and open the hotel', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
    await page.goto(`${APP.admin}/hotels/${hotel.hotelId}`)
  })
  await j.step('open the housekeeper’s edit modal, rename, save', async () => {
    await page.goto(`${APP.admin}/hotels/${hotel.hotelId}/staff/${hotel.housekeeper.id}`)
    // Scope to the modal (the hotel-detail form behind it also has a "Name"
    // field) and target the input by id — stable across the form's async reset,
    // where label association can momentarily flicker. Wait for the reset to
    // populate (email is a unique, stable signal) before overwriting the name.
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('#email')).toHaveValue(hotel.housekeeper.email)
    await dialog.locator('#name').fill(newName)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Staff updated')).toBeVisible()
    await expect(page.getByText(newName)).toBeVisible()
  })
})

test('ADM-05: edit a room', async ({ page, hotel }) => {
  const j = journey('ADM-05')
  await j.step('sign in and open the room edit modal', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
    await page.goto(`${APP.admin}/hotels/${hotel.hotelId}/rooms/${hotel.rooms[0].id}`)
  })
  await j.step('change the room status and save', async () => {
    await chooseOption(page, selectShowing(page, 'Dirty'), 'Out of service')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Room updated')).toBeVisible()
  })
})

test('ADM-06: approve an access request (creates the staff member)', async ({
  page,
  hotel,
}) => {
  const j = journey('ADM-06')
  const suffix = uniqueSuffix()
  const email = `approve-me-${suffix}@e2e-sevenone.com`

  await j.step('a manager files a staff-add request', async () => {
    const mgr = await Api.loggedIn(hotel.manager.email, TEST_USER_PASSWORD)
    await mgr.fileRequest(hotel.hotelId, {
      resource: 'staff',
      kind: 'add',
      payload: { name: `Approve Me ${suffix}`, email, role: 'housekeeper' },
    })
  })
  await j.step('admin sees it in the queue and approves it', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
    await page.goto(`${APP.admin}/requests`)
    await expect(page.getByText(email)).toBeVisible()
    await requestCard(page, email).getByRole('button', { name: 'Approve' }).click()
  })
  await j.step('a confirmation popup notes success and the welcome email', async () => {
    const dialog = page.getByRole('dialog')
    await expect(
      dialog.getByRole('heading', { name: 'Staff member added' }),
    ).toBeVisible()
    // The popup names the new user and states a welcome email was sent to them.
    await expect(dialog.getByText(email)).toBeVisible()
    await expect(dialog.getByText(/welcome email/i)).toBeVisible()
    await dialog.getByRole('button', { name: 'Done' }).click()
  })
  await j.step('the pending card clears from the queue', async () => {
    await expect(page.getByText(email)).toHaveCount(0)
  })
  await j.step('the new user really exists (authoritative check)', async () => {
    const users = await hotel.admin.request<Array<{ email: string }>>(
      'GET',
      `/api/v1/hotels/${hotel.hotelId}/users`,
    )
    expect(users.some((u) => u.email === email)).toBe(true)
  })
})

test('ADM-07: reject an access request', async ({ page, hotel }) => {
  const j = journey('ADM-07')
  const suffix = uniqueSuffix()
  const email = `reject-me-${suffix}@e2e-sevenone.com`

  await j.step('a manager files a staff-add request', async () => {
    const mgr = await Api.loggedIn(hotel.manager.email, TEST_USER_PASSWORD)
    await mgr.fileRequest(hotel.hotelId, {
      resource: 'staff',
      kind: 'add',
      payload: { name: `Reject Me ${suffix}`, email, role: 'housekeeper' },
    })
  })
  await j.step('admin opens the queue and rejects it', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
    await page.goto(`${APP.admin}/requests`)
    await page
      .locator('div')
      .filter({ hasText: email })
      .filter({ has: page.getByRole('button', { name: 'Reject' }) })
      .last()
      .getByRole('button', { name: 'Reject' })
      .click()
    // Confirm in the reject dialog.
    await page.getByRole('dialog').getByRole('button', { name: 'Reject' }).click()
  })
  await j.step('rejection succeeds and the card clears', async () => {
    await expect(page.getByText('Request rejected')).toBeVisible()
    await expect(page.getByText(email)).toHaveCount(0)
  })
})

test('ADM-08: the admin account page enforces the current password', async ({
  page,
}) => {
  const j = journey('ADM-08')
  // The change-password *happy* path is proven end-to-end by MGR-10 against an
  // isolated user. Rotating the SHARED e2e admin here would break the many
  // parallel tests that authenticate as it, so ADM-08 instead asserts the
  // admin-app account form is wired correctly by exercising the guard: a wrong
  // current password is rejected and surfaced on the field (nothing changes).
  await j.step('sign in and open Account', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
    await page.goto(`${APP.admin}/account`)
  })
  await j.step('submitting a wrong current password is rejected on the field', async () => {
    await page.getByLabel('Current password', { exact: true }).fill('not-my-password')
    await page.getByLabel('New password', { exact: true }).fill('WhateverNew123!')
    await page.getByLabel('Confirm new password', { exact: true }).fill('WhateverNew123!')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByText('Current password is incorrect')).toBeVisible()
  })
})

test('ADM-09: admin sets a UI preference (theme)', async ({ page }) => {
  const j = journey('ADM-09')
  await j.step('sign in to the console', async () => {
    await loginAs(page, ADMIN.email, ADMIN.password, { expect: 'admin' })
  })
  await j.step('switch the theme to Dark via the preferences menu', async () => {
    await page.getByRole('button', { name: 'Preferences' }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()
    await expect(page.locator('html.dark')).toHaveCount(1)
  })
})
