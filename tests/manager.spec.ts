/**
 * MGR-* — the manager runs the floor from the desktop hotel app: dashboard,
 * room status, the dirty-room → create-task nudge, task CRUD/assignment, staff
 * (read-only), and filing add/remove requests for an admin to approve.
 *
 * Catalogue: sevenone-docs/housekeeping/testing/user-paths.md (MGR-*).
 */
import { APP, TEST_USER_PASSWORD } from '../src/config'
import { expect, test } from '../src/fixtures'
import { Api } from '../src/harness/api'
import { loginAs } from '../src/harness/login'
import { provisionHotel, uniqueSuffix, type SeededHotel } from '../src/harness/seed'
import { journey } from '../src/harness/step'
import { chooseOption, selectShowing } from '../src/harness/ui'

async function asManager(page: import('@playwright/test').Page, hotel: SeededHotel) {
  await loginAs(page, hotel.manager.email, hotel.manager.password, {
    expect: 'web',
  })
}

test('MGR-01: manager reads the dashboard at a glance', async ({ page, hotel }) => {
  const j = journey('MGR-01')
  await j.step('sign in and land on the dashboard', async () => {
    await asManager(page, hotel)
    await expect(page).toHaveURL(`${APP.web}/dashboard`)
  })
  await j.step('room grid and open-tasks sections render', async () => {
    await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Open tasks' })).toBeVisible()
    await expect(
      page.getByText(hotel.rooms[0].room_number, { exact: true }),
    ).toBeVisible()
  })
})

test('MGR-02 & MGR-03: change room status, and the dirty-room prompt opens the task form prefilled', async ({
  page,
  hotel,
}) => {
  const j = journey('MGR-02/MGR-03')
  const room = hotel.rooms[0] // starts "dirty"

  await j.step('sign in and open Rooms', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/rooms`)
  })
  await j.step('MGR-02: change the room dirty → clean', async () => {
    await chooseOption(page, selectShowing(page, 'Dirty'), 'Clean')
    await expect(selectShowing(page, 'Clean')).toBeVisible()
  })
  await j.step('MGR-03: change it clean → dirty, prompting to schedule cleaning', async () => {
    await chooseOption(page, selectShowing(page, 'Clean'), 'Dirty')
    await expect(
      page.getByRole('heading', { name: 'Schedule cleaning?' }),
    ).toBeVisible()
  })
  await j.step('accept the prompt → task form opens with the room prefilled', async () => {
    await page.getByRole('button', { name: 'Create task' }).click()
    await expect(page).toHaveURL(new RegExp(`/tasks/new\\?room=${room.id}`))
    await expect(selectShowing(page, `Room ${room.room_number}`)).toBeVisible()
  })
})

test('MGR-04 & MGR-04-N: create and assign a task; the room is required', async ({
  page,
  hotel,
}) => {
  const j = journey('MGR-04')
  const room = hotel.rooms[0]

  await j.step('sign in and open the new-task form', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/tasks/new`)
  })
  await j.step('MGR-04-N: saving with no room shows a validation error and does not navigate', async () => {
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page).toHaveURL(new RegExp('/tasks/new'))
    // The validation error is the destructive <p>, distinct from the identical
    // Select placeholder text.
    await expect(page.locator('p.text-destructive', { hasText: 'Select a room' })).toBeVisible()
  })
  await j.step('MGR-04: pick room + assignee and save', async () => {
    await chooseOption(page, selectShowing(page, 'Select a room'), `Room ${room.room_number}`)
    await chooseOption(page, selectShowing(page, 'Unassigned'), hotel.housekeeper.name)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page).toHaveURL(`${APP.web}/tasks`)
  })
  await j.step('the task exists and is assigned (authoritative check)', async () => {
    const tasks = await hotel.admin.listTasks(hotel.hotelId, {
      assignedTo: hotel.housekeeper.id,
    })
    expect(tasks.length).toBe(1)
    expect(tasks[0].status).toBe('assigned')
  })
})

test('MGR-05: edit and reassign a task', async ({ page, hotel }) => {
  const j = journey('MGR-05')
  let taskId = ''

  await j.step('seed an unassigned task', async () => {
    const task = await hotel.admin.createTask(hotel.hotelId, {
      room_id: hotel.rooms[0].id,
      status: 'pending',
      priority: 'low',
    })
    taskId = task.id
  })
  await j.step('sign in and open the task from the board', async () => {
    await asManager(page, hotel)
    // Load the board first so rooms/staff are cached, then open the card — this
    // mirrors real use and avoids racing the edit modal against the rooms query.
    await page.goto(`${APP.web}/tasks`)
    await page
      .getByRole('link', { name: new RegExp(`Room ${hotel.rooms[0].room_number}`) })
      .click()
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskId}`))
  })
  await j.step('assign it to the housekeeper and save', async () => {
    // The room now displays (form populated); safe to edit and save.
    await expect(
      selectShowing(page, `Room ${hotel.rooms[0].room_number}`),
    ).toBeVisible()
    await chooseOption(page, selectShowing(page, 'Unassigned'), hotel.housekeeper.name)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page).toHaveURL(`${APP.web}/tasks`)
  })
  await j.step('the task now belongs to the housekeeper', async () => {
    const [task] = await hotel.admin.listTasks(hotel.hotelId)
    expect(task.assigned_to).toBe(hotel.housekeeper.id)
  })
})

test('MGR-06, MGR-07 & MGR-09: view staff, file a staff add request, and track it', async ({
  page,
  hotel,
}) => {
  const j = journey('MGR-06/07/09')
  const suffix = uniqueSuffix()
  const newName = `Requested Person ${suffix}`
  const newEmail = `req-${suffix}@e2e-sevenone.com`

  await j.step('MGR-06: staff list shows the hotel team, read-only', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/staff`)
    await expect(page.getByText(hotel.housekeeper.name)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Request staff' })).toBeVisible()
  })
  await j.step('MGR-07: file an add-staff request', async () => {
    await page.getByRole('link', { name: 'Request staff' }).click()
    await page.getByLabel('Name', { exact: true }).fill(newName)
    await page.getByLabel('Email', { exact: true }).fill(newEmail)
    await page.getByRole('button', { name: 'Submit request' }).click()
    await expect(page).toHaveURL(`${APP.web}/staff`)
  })
  await j.step('MGR-09: the request shows as Pending on My Requests', async () => {
    await page.goto(`${APP.web}/requests`)
    await expect(page.getByText(newEmail)).toBeVisible()
    await expect(page.getByText('Pending')).toBeVisible()
  })
})

test('MGR-08: file a room add request', async ({ page, hotel }) => {
  const j = journey('MGR-08')
  const roomNumber = `E2E-${uniqueSuffix()}`

  await j.step('sign in and open the room request form', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/rooms`)
    await page.getByRole('link', { name: 'Request room' }).click()
  })
  await j.step('submit a new-room request', async () => {
    await page.getByLabel('Room number', { exact: true }).fill(roomNumber)
    await page.getByRole('button', { name: 'Submit request' }).click()
    await expect(page).toHaveURL(`${APP.web}/rooms`)
  })
  await j.step('it appears as Pending on My Requests', async () => {
    await page.goto(`${APP.web}/requests`)
    await expect(page.getByText(roomNumber)).toBeVisible()
    await expect(page.getByText('Pending')).toBeVisible()
  })
})

test('MGR-10: manager changes their own password', async ({ page, hotel }) => {
  const j = journey('MGR-10')
  await j.step('sign in and open Account', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/account`)
  })
  await j.step('submit the change-password form', async () => {
    await page.getByLabel('Current password', { exact: true }).fill(TEST_USER_PASSWORD)
    await page.getByLabel('New password', { exact: true }).fill('MgrNewPass123!')
    await page.getByLabel('Confirm new password', { exact: true }).fill('MgrNewPass123!')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect(page.getByText('Password changed')).toBeVisible()
  })
  await j.step('the new password works for a fresh login', async () => {
    const api = new Api()
    await api.login(hotel.manager.email, 'MgrNewPass123!')
  })
})

test('MGR-11-N: a manager is bounced from admin-only hotel settings', async ({
  page,
  hotel,
}) => {
  const j = journey('MGR-11-N')
  await j.step('sign in as manager', async () => {
    await asManager(page, hotel)
  })
  await j.step('deep-linking /settings/hotel redirects to /dashboard', async () => {
    await page.goto(`${APP.web}/settings/hotel`)
    await expect(page).toHaveURL(`${APP.web}/dashboard`)
  })
})

test('MGR-12-N: tenant isolation — a manager cannot read another hotel', async ({
  hotel,
}) => {
  const j = journey('MGR-12-N')
  let otherHotelId = ''
  await j.step('provision a second, unrelated hotel', async () => {
    const other = await provisionHotel({ label: 'OtherTenant' })
    otherHotelId = other.hotelId
  })
  await j.step("reading the other hotel's rooms 404s for this manager", async () => {
    const mgr = await Api.loggedIn(hotel.manager.email, TEST_USER_PASSWORD)
    const status = await mgr.rawStatus(
      'GET',
      `/api/v1/hotels/${otherHotelId}/rooms`,
    )
    expect(status).toBe(404)
  })
})
