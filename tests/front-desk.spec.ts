/**
 * FD-* — the front-desk role: the same hotel operations as a manager (room
 * status, task control + approval) but with NO access to the staff/room
 * add-remove request workflow. Front desk uses the desktop hotel app.
 *
 * Catalogue: sevenone-docs/housekeeping/testing/user-paths.md (FD-*).
 */
import { APP, TEST_USER_PASSWORD } from '../src/config'
import { expect, test } from '../src/fixtures'
import { Api } from '../src/harness/api'
import { loginAs } from '../src/harness/login'
import { provisionHotel } from '../src/harness/seed'
import { journey } from '../src/harness/step'
import { chooseOption, selectShowing } from '../src/harness/ui'

test('FD-01: front desk signs in, runs room status, and has no Requests tab', async ({
  page,
}) => {
  const j = journey('FD-01')
  const hotel = await provisionHotel({ label: 'FrontDesk', withFrontDesk: true })
  const fd = hotel.frontDesk!

  await j.step('front desk signs in and lands on the dashboard', async () => {
    await loginAs(page, fd.email, fd.password, { expect: 'web' })
    await expect(page).toHaveURL(`${APP.web}/dashboard`)
  })
  await j.step('the nav shows manager views but NOT Requests', async () => {
    // Scope to the sidebar nav so the link match is unambiguous.
    const nav = page.getByRole('navigation')
    await expect(nav.getByRole('link', { name: 'Rooms', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Requests', exact: true })).toHaveCount(0)
  })
  await j.step('front desk can change a room’s status (a manager-level power)', async () => {
    await page.goto(`${APP.web}/rooms`)
    await chooseOption(page, selectShowing(page, 'Dirty'), 'Clean')
    await expect(selectShowing(page, 'Clean')).toBeVisible()
  })
})

test('FD-02-N: front desk is walled out of the requests workflow (UI + API)', async ({
  page,
}) => {
  const j = journey('FD-02-N')
  const hotel = await provisionHotel({ label: 'FrontDesk', withFrontDesk: true })
  const fd = hotel.frontDesk!

  await j.step('sign in as front desk', async () => {
    await loginAs(page, fd.email, fd.password, { expect: 'web' })
  })
  await j.step('deep-linking /requests bounces back to /dashboard', async () => {
    await page.goto(`${APP.web}/requests`)
    await expect(page).toHaveURL(`${APP.web}/dashboard`)
  })
  await j.step('filing an access request via the API is forbidden (403)', async () => {
    const fdApi = await Api.loggedIn(fd.email, TEST_USER_PASSWORD)
    const status = await fdApi.rawStatus(
      'POST',
      `/api/v1/hotels/${hotel.hotelId}/access-requests`,
      { resource: 'room', kind: 'add', payload: { room_number: '999' } },
    )
    expect(status).toBe(403)
  })
})

test('FD-03: front desk approves a task pending sign-off (manager-equivalent)', async ({
  page,
}) => {
  const j = journey('FD-03')
  const hotel = await provisionHotel({ label: 'FrontDesk', withFrontDesk: true })
  const fd = hotel.frontDesk!
  const room = hotel.rooms[0]

  await j.step('a housekeeper completes a task, parking it pending approval', async () => {
    const task = await hotel.admin.createTask(hotel.hotelId, {
      room_id: room.id,
      assigned_to: hotel.housekeeper.id,
      status: 'assigned',
      priority: 'normal',
    })
    const hk = await Api.loggedIn(hotel.housekeeper.email, TEST_USER_PASSWORD)
    const submitted = await hk.updateTaskStatus(
      hotel.hotelId,
      task.id,
      'completed',
    )
    expect(submitted.status).toBe('pending_approval')
  })
  await j.step('front desk approves it on the board', async () => {
    await loginAs(page, fd.email, fd.password, { expect: 'web' })
    await page.goto(`${APP.web}/tasks`)
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page.getByText('Task approved')).toBeVisible()
  })
  await j.step('the task is completed and the room cleaned (authoritative)', async () => {
    const updatedRoom = await hotel.admin.getRoom(hotel.hotelId, room.id)
    expect(updatedRoom.status).toBe('clean')
    const tasks = await hotel.admin.listTasks(hotel.hotelId)
    expect(tasks.some((tk) => tk.status === 'completed')).toBe(true)
  })
})
