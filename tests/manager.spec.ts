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

test('MGR-13: pending add-requests show inline on the staff & rooms pages', async ({
  page,
  hotel,
}) => {
  const j = journey('MGR-13')
  const suffix = uniqueSuffix()
  const newName = `Inline Hire ${suffix}`
  const newEmail = `inline-${suffix}@e2e-sevenone.com`
  const roomNumber = `INL-${suffix}`

  await j.step('a manager files a staff-add and a room-add request', async () => {
    const mgr = await Api.loggedIn(hotel.manager.email, TEST_USER_PASSWORD)
    await mgr.fileRequest(hotel.hotelId, {
      resource: 'staff',
      kind: 'add',
      payload: { name: newName, email: newEmail, role: 'housekeeper' },
    })
    await mgr.fileRequest(hotel.hotelId, {
      resource: 'room',
      kind: 'add',
      payload: { room_number: roomNumber, room_type: 'STD' },
    })
  })
  await j.step('the requested staff appears on Staff, flagged Pending', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/staff`)
    await expect(page.getByText(newName)).toBeVisible()
    await expect(page.getByText('Pending', { exact: true })).toBeVisible()
  })
  await j.step('the requested room appears on Rooms, flagged Pending', async () => {
    await page.goto(`${APP.web}/rooms`)
    await expect(page.getByText(roomNumber)).toBeVisible()
    await expect(page.getByText('Pending', { exact: true })).toBeVisible()
  })
})

test('MGR-14: a pending removal flags the existing staff/room row', async ({
  page,
  hotel,
}) => {
  const j = journey('MGR-14')

  await j.step('a manager files remove requests for the housekeeper and the room', async () => {
    const mgr = await Api.loggedIn(hotel.manager.email, TEST_USER_PASSWORD)
    await mgr.fileRequest(hotel.hotelId, {
      resource: 'staff',
      kind: 'remove',
      target_id: hotel.housekeeper.id,
    })
    await mgr.fileRequest(hotel.hotelId, {
      resource: 'room',
      kind: 'remove',
      target_id: hotel.rooms[0].id,
    })
  })
  await j.step('the housekeeper row shows Pending removal on Staff', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/staff`)
    await expect(page.getByText(hotel.housekeeper.name)).toBeVisible()
    await expect(page.getByText('Pending removal')).toBeVisible()
  })
  await j.step('the room row shows Pending removal on Rooms', async () => {
    await page.goto(`${APP.web}/rooms`)
    await expect(page.getByText('Pending removal')).toBeVisible()
  })
})

test('MGR-15: with auto-approve on, a completed task skips sign-off and cleans the room', async ({
  page,
  hotel,
}) => {
  const j = journey('MGR-15')
  const room = hotel.rooms[0]
  let taskId = ''

  await j.step('seed a task assigned to the housekeeper', async () => {
    const task = await hotel.admin.createTask(hotel.hotelId, {
      room_id: room.id,
      assigned_to: hotel.housekeeper.id,
      status: 'assigned',
      priority: 'normal',
    })
    taskId = task.id
  })
  await j.step('manager turns on auto-approve from the Tasks page', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/tasks`)
    const toggle = page.getByRole('checkbox')
    // The checkbox is controlled by the persisted hotel flag, so it only flips
    // once the PATCH round-trips — click, then wait for the reflected state.
    await toggle.click()
    await expect(toggle).toBeChecked()
  })
  await j.step('the housekeeper completing the task goes straight to Completed', async () => {
    const hk = await Api.loggedIn(hotel.housekeeper.email, TEST_USER_PASSWORD)
    const updated = await hk.updateTaskStatus(hotel.hotelId, taskId, 'completed')
    expect(updated.status).toBe('completed')
  })
  await j.step('and the room was cleaned (no manager approval needed)', async () => {
    const updatedRoom = await hotel.admin.getRoom(hotel.hotelId, room.id)
    expect(updatedRoom.status).toBe('clean')
  })
})

test('MGR-16: manager reassigns a housekeeper’s whole workload to another (call-in)', async ({
  page,
}) => {
  const j = journey('MGR-16')
  const hotel = await provisionHotel({
    label: 'Workload',
    withSecondHousekeeper: true,
  })
  const out = hotel.housekeeper // the one who "called in"
  const cover = hotel.housekeeper2!

  await j.step('seed two open tasks assigned to the housekeeper who is out', async () => {
    for (let i = 0; i < 2; i++) {
      await hotel.admin.createTask(hotel.hotelId, {
        room_id: hotel.rooms[0].id,
        assigned_to: out.id,
        status: 'assigned',
        priority: 'normal',
      })
    }
  })
  await j.step('manager opens the Move-workload dialog on the Tasks page', async () => {
    await loginAs(page, hotel.manager.email, hotel.manager.password, {
      expect: 'web',
    })
    await page.goto(`${APP.web}/tasks`)
    await page.getByRole('button', { name: 'Move workload' }).click()
  })
  await j.step('pick who is out, hand the whole workload to the covering housekeeper, submit', async () => {
    await chooseOption(page, selectShowing(page, 'Select a housekeeper'), out.name)
    // "Move their tasks to" is now a multi-select: open it and check the one
    // covering housekeeper (a single pick hands them everything).
    await page
      .getByRole('button', { name: 'Everyone else (split evenly)' })
      .click()
    await page
      .getByRole('menuitemcheckbox', { name: cover.name })
      .click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Move tasks' }).click()
    await expect(page.getByText('2 tasks moved')).toBeVisible()
  })
  await j.step('all open tasks now belong to the covering housekeeper (authoritative)', async () => {
    const outTasks = await hotel.admin.listTasks(hotel.hotelId, {
      assignedTo: out.id,
    })
    expect(outTasks.length).toBe(0)
    const coverTasks = await hotel.admin.listTasks(hotel.hotelId, {
      assignedTo: cover.id,
    })
    expect(coverTasks.length).toBe(2)
    expect(coverTasks.every((t) => t.status === 'assigned')).toBe(true)
  })
})

test('MGR-17: manager clears completed tasks off the board', async ({
  page,
  hotel,
}) => {
  const j = journey('MGR-17')

  await j.step('seed a completed task', async () => {
    await hotel.admin.createTask(hotel.hotelId, {
      room_id: hotel.rooms[0].id,
      assigned_to: hotel.housekeeper.id,
      status: 'completed',
      priority: 'normal',
    })
  })
  await j.step('manager opens the board and clears completed', async () => {
    await asManager(page, hotel)
    await page.goto(`${APP.web}/tasks`)
    await page.getByRole('button', { name: 'Clear completed' }).click()
    // Confirm in the alert dialog.
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Clear', exact: true })
      .click()
    await expect(page.getByText('1 completed task cleared')).toBeVisible()
  })
  await j.step('the completed task is gone from the board (soft-archived)', async () => {
    // Default list no longer returns the archived task.
    const tasks = await hotel.admin.listTasks(hotel.hotelId)
    expect(tasks.length).toBe(0)
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
