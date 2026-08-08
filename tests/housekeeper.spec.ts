/**
 * HK-* — the housekeeper's world: a single mobile screen of their own tasks,
 * one-tap status changes, and hard walls around everything else.
 *
 * Catalogue: sevenone-docs/housekeeping/testing/user-paths.md (HK-*).
 */
import { APP, TEST_USER_PASSWORD } from '../src/config'
import { expect, test } from '../src/fixtures'
import { Api } from '../src/harness/api'
import { loginAs, logout } from '../src/harness/login'
import { clockIn } from '../src/harness/shift'
import { journey } from '../src/harness/step'

test('HK-01: housekeeper sees only their assigned task', async ({
  page,
  hotel,
}) => {
  const j = journey('HK-01')
  const room = hotel.rooms[0]

  await j.step('a task is assigned to the housekeeper', async () => {
    await hotel.admin.createTask(hotel.hotelId, {
      room_id: room.id,
      assigned_to: hotel.housekeeper.id,
      status: 'assigned',
      priority: 'normal',
    })
  })
  await j.step('housekeeper signs in, clocks in, and lands on My Tasks', async () => {
    await loginAs(page, hotel.housekeeper.email, hotel.housekeeper.password, {
      expect: 'web',
    })
    await expect(page).toHaveURL(`${APP.web}/my-tasks`)
    await clockIn(page)
  })
  await j.step('the task card shows the room, an Assigned badge, and a Start button', async () => {
    await expect(page.getByText(`Room ${room.room_number}`)).toBeVisible()
    await expect(page.getByText('Assigned')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()
  })
})

test('HK-02 & HK-03: housekeeper starts a task and submits it for approval (room stays dirty until a manager approves)', async ({
  page,
  hotel,
}) => {
  const j = journey('HK-02/HK-03')
  const room = hotel.rooms[0]

  await j.step('seed an assigned task and sign in', async () => {
    await hotel.admin.createTask(hotel.hotelId, {
      room_id: room.id,
      assigned_to: hotel.housekeeper.id,
      status: 'assigned',
      priority: 'normal',
    })
    await loginAs(page, hotel.housekeeper.email, hotel.housekeeper.password, {
      expect: 'web',
    })
    await clockIn(page)
  })
  await j.step('HK-02: tap Start → task moves to In progress', async () => {
    await page.getByRole('button', { name: 'Start' }).click()
    await expect(page.getByText('In progress')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark complete' })).toBeVisible()
  })
  await j.step('HK-03: tap Mark complete → task goes to Pending approval, no more action button', async () => {
    await page.getByRole('button', { name: 'Mark complete' }).click()
    // A hotel with the default (no auto-approve) sends a completed task to the
    // manager for sign-off; the housekeeper can no longer act on it.
    await expect(page.getByText('Pending approval')).toBeVisible()
    await expect(page.getByText('Awaiting manager approval')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark complete' })).toHaveCount(0)
  })
  await j.step('the room has NOT been cleaned yet (approval is what flips it)', async () => {
    const updated = await hotel.admin.getRoom(hotel.hotelId, room.id)
    expect(updated.status).toBe('dirty')
    const [task] = await hotel.admin.listTasks(hotel.hotelId)
    expect(task.status).toBe('pending_approval')
  })
})

test('HK-04: a newly assigned task appears after a refetch', async ({
  page,
  hotel,
}) => {
  const j = journey('HK-04')
  const room = hotel.rooms[0]

  await j.step('sign in and clock in with no tasks yet', async () => {
    await loginAs(page, hotel.housekeeper.email, hotel.housekeeper.password, {
      expect: 'web',
    })
    await clockIn(page)
    await expect(page.getByText(/no tasks assigned to you/i)).toBeVisible()
  })
  await j.step('a manager assigns a task, then the list refetches', async () => {
    await hotel.admin.createTask(hotel.hotelId, {
      room_id: room.id,
      assigned_to: hotel.housekeeper.id,
      status: 'assigned',
      priority: 'urgent',
    })
    // Force the focus/poll refetch deterministically.
    await page.reload()
    await expect(page.getByText(`Room ${room.room_number}`)).toBeVisible()
  })
})

test('HK-06-N: housekeeper is walled out of manager screens', async ({
  page,
  hotel,
}) => {
  const j = journey('HK-06-N')
  await j.step('sign in as the housekeeper', async () => {
    await loginAs(page, hotel.housekeeper.email, hotel.housekeeper.password, {
      expect: 'web',
    })
  })
  for (const route of ['/rooms', '/staff', '/tasks', '/settings/hotel']) {
    await j.step(`deep-linking ${route} bounces back to /my-tasks`, async () => {
      await page.goto(`${APP.web}${route}`)
      await expect(page).toHaveURL(`${APP.web}/my-tasks`)
    })
  }
})

test('HK-07-N: a housekeeper cannot change status on a task that is not theirs', async ({
  hotel,
}) => {
  const j = journey('HK-07-N')
  let taskId = ''

  await j.step('create a task assigned to the manager, not the housekeeper', async () => {
    const task = await hotel.admin.createTask(hotel.hotelId, {
      room_id: hotel.rooms[0].id,
      assigned_to: hotel.manager.id,
      status: 'assigned',
      priority: 'normal',
    })
    taskId = task.id
  })
  await j.step('the housekeeper PATCHing its status is forbidden (403)', async () => {
    const hk = await Api.loggedIn(hotel.housekeeper.email, TEST_USER_PASSWORD)
    const status = await hk.rawStatus(
      'PATCH',
      `/api/v1/hotels/${hotel.hotelId}/tasks/${taskId}/status`,
      { status: 'in_progress' },
    )
    expect(status).toBe(403)
  })
})

test('HK-08: the clock-in gate blocks work until the housekeeper clocks in', async ({
  page,
  hotel,
}) => {
  const j = journey('HK-08')
  const room = hotel.rooms[0]

  await j.step('an assigned task is waiting for the housekeeper', async () => {
    await hotel.admin.createTask(hotel.hotelId, {
      room_id: room.id,
      assigned_to: hotel.housekeeper.id,
      status: 'assigned',
      priority: 'normal',
    })
  })
  await j.step('signing in lands on My Tasks behind the clock-in gate', async () => {
    await loginAs(page, hotel.housekeeper.email, hotel.housekeeper.password, {
      expect: 'web',
    })
    await expect(page).toHaveURL(`${APP.web}/my-tasks`)
    // The gate is up: the clock-in prompt shows and the task is not yet visible.
    await expect(page.getByRole('button', { name: 'Clock in' })).toBeVisible()
    await expect(page.getByText(`Room ${room.room_number}`)).toHaveCount(0)
  })
  await j.step('clocking in lifts the gate and reveals the task + on-shift badge', async () => {
    await clockIn(page)
    await expect(page.getByText(`Room ${room.room_number}`)).toBeVisible()
    await expect(page.getByText(/on shift since/i)).toBeVisible()
  })
  await j.step('logging out clears the session (and closes the shift)', async () => {
    await logout(page)
    await expect(page).toHaveURL(new RegExp(`^${APP.login}`))
  })
})
