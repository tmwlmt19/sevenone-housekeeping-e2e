/**
 * X-ROLE-01 — the flagship journey: one task's whole life across all three roles
 * and all three front-ends, tied together by the cookie-SSO handoff.
 *
 *   admin (seed)  → provisions a hotel with a manager, a housekeeper, and a room
 *   manager (web) → creates a task and assigns it to the housekeeper
 *   housekeeper   → (own browser context) Start → Mark complete on mobile
 *   backend       → completion parks the task in `pending_approval` (room stays dirty)
 *   manager (web) → approves the task on the board; the room then flips to `clean`
 *
 * This one test proves the pieces work *together*: role-based login routing,
 * the cross-origin session cookie, tenant scoping, and the task→room side effect.
 * (The forced first-login password change and the admin provisioning *wizard*
 * are exercised on their own in auth.spec / admin.spec; here the fixture seeds
 * via the API so the journey stays focused and deterministic.)
 *
 * See docs: sevenone-docs/housekeeping/testing/user-paths.md (X-ROLE-01).
 */
import { APP } from '../src/config'
import { expect, test } from '../src/fixtures'
import { loginAs, logout } from '../src/harness/login'
import { journey } from '../src/harness/step'
import { chooseOption, selectShowing } from '../src/harness/ui'

test('X-ROLE-01: one task across admin → manager → housekeeper → manager', async ({
  page,
  hotel,
  browser,
}) => {
  const j = journey('X-ROLE-01')
  const room = hotel.rooms[0]
  const roomLabel = `Room ${room.room_number}`

  await j.step('manager signs in and lands on the dashboard', async () => {
    await loginAs(page, hotel.manager.email, hotel.manager.password, {
      expect: 'web',
    })
    await expect(page).toHaveURL(`${APP.web}/dashboard`)
  })

  await j.step('manager creates a task and assigns it to the housekeeper', async () => {
    await page.goto(`${APP.web}/tasks`)
    await page.getByRole('link', { name: 'New task' }).click()
    // Route-aware modal (/tasks/new) is now open.
    await chooseOption(page, selectShowing(page, 'Select a room'), roomLabel)
    await chooseOption(
      page,
      selectShowing(page, 'Unassigned'),
      hotel.housekeeper.name,
    )
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    // Back on the board; the card exists and shows the room.
    await expect(page).toHaveURL(`${APP.web}/tasks`)
    await expect(
      page.getByRole('link', { name: new RegExp(roomLabel) }).first(),
    ).toBeVisible()
  })

  // The housekeeper is a different identity → a fresh browser context/cookie jar.
  const hkContext = await browser.newContext()
  const hkPage = await hkContext.newPage()
  try {
    await j.step('housekeeper signs in and sees the assigned task', async () => {
      await loginAs(
        hkPage,
        hotel.housekeeper.email,
        hotel.housekeeper.password,
        { expect: 'web' },
      )
      await expect(hkPage).toHaveURL(`${APP.web}/my-tasks`)
      await expect(hkPage.getByText(roomLabel)).toBeVisible()
    })

    await j.step('housekeeper taps Start, then Mark complete → Pending approval', async () => {
      await hkPage.getByRole('button', { name: 'Start' }).click()
      await hkPage.getByRole('button', { name: 'Mark complete' }).click()
      // Completion parks the task for manager sign-off; no more action button.
      await expect(hkPage.getByText('Pending approval')).toBeVisible()
      await expect(
        hkPage.getByRole('button', { name: 'Mark complete' }),
      ).toHaveCount(0)
    })
  } finally {
    await hkContext.close()
  }

  await j.step('backend parked the task pending approval; room still dirty', async () => {
    const updated = await hotel.admin.getRoom(hotel.hotelId, room.id)
    expect(updated.status).toBe('dirty')
    const tasks = await hotel.admin.listTasks(hotel.hotelId)
    expect(tasks.some((t) => t.status === 'pending_approval')).toBe(true)
  })

  await j.step('manager approves the task on the board', async () => {
    await page.goto(`${APP.web}/tasks`)
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByText('Task approved')).toBeVisible()
  })

  await j.step('approval completed the task and flipped the room clean (authoritative)', async () => {
    const updated = await hotel.admin.getRoom(hotel.hotelId, room.id)
    expect(updated.status).toBe('clean')
    const tasks = await hotel.admin.listTasks(hotel.hotelId)
    expect(tasks.some((t) => t.status === 'completed')).toBe(true)
  })

  await j.step('manager sees the clean room on the dashboard', async () => {
    await page.goto(`${APP.web}/dashboard`)
    // Room grid shows the room; its manager status control now reads Clean.
    await expect(page.getByText(room.room_number, { exact: true })).toBeVisible()
    await expect(selectShowing(page, 'Clean')).toBeVisible()
  })

  await j.step('manager logs out and the session is cleared', async () => {
    await logout(page)
    await expect(page).toHaveURL(new RegExp(`^${APP.login}`))
  })
})
