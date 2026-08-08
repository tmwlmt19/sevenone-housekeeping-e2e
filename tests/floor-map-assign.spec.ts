/**
 * MGR-18..24 — the manager's optimized auto-assign on the floor map: seed a
 * placed floor (halls + doored rooms), open Rooms → Map → Assign, run the
 * one-click optimizer (or Quick split), and turn the plan into tasks. Covers the
 * happy split, shift overflow, the unplaced-room fallback, and the fair-share
 * balancing (even spread, proportional-by-shift, mixed sizes) plus Quick split.
 *
 * Catalogue: sevenone-docs/housekeeping/testing/user-paths.md (MGR-18..24).
 */
import { APP } from '../src/config'
import { expect, test } from '../src/fixtures'
import { Api } from '../src/harness/api'
import { loginAs } from '../src/harness/login'
import { seedCorridorFloor } from '../src/harness/map'
import { provisionHotel, type SeededHotel } from '../src/harness/seed'
import { journey } from '../src/harness/step'

const PLACED = ['101', '102', '103', '104', '105', '106'] // two wings of three

/**
 * Provision a hotel with two housekeepers and six dirty, placed rooms laid out
 * as two disjoint wings (so the optimizer produces one cluster per wing), plus
 * optionally some dirty rooms left off the map. Rooms carry no `room_type`, so
 * each estimates at the 25-minute default.
 */
async function provisionMappedHotel(
  label: string,
  opts: { unplaced?: string[] } = {},
): Promise<{ hotel: SeededHotel; placedCount: number }> {
  const unplaced = opts.unplaced ?? []
  const rooms = [...PLACED, ...unplaced].map((room_number) => ({
    room_number,
    floor: 1,
    status: 'dirty',
  }))
  const hotel = await provisionHotel({ label, withSecondHousekeeper: true, rooms })

  const idOf = (n: string) => {
    const room = hotel.rooms.find((r) => r.room_number === n)
    if (!room) throw new Error(`seeded hotel is missing room ${n}`)
    return room.id
  }
  const wings = [
    [idOf('101'), idOf('102'), idOf('103')],
    [idOf('104'), idOf('105'), idOf('106')],
  ]

  // The map PUT is a manager-scoped write, so seed it as the manager.
  const manager = await Api.loggedIn(hotel.manager.email, hotel.manager.password)
  await seedCorridorFloor(manager, hotel.hotelId, 1, wings)

  return { hotel, placedCount: PLACED.length }
}

/**
 * Provision a hotel whose dirty rooms all sit in one connected corridor — a
 * single walkable cluster, every room reachable from every other — so fair-share
 * balancing is deterministic (disconnected wings can't balance across the gap).
 * Rooms are placed in the given order along the hall.
 */
async function provisionCorridor(
  label: string,
  rooms: Array<{ number: string; type?: string }>,
  opts: { thirdHousekeeper?: boolean } = {},
): Promise<SeededHotel> {
  const hotel = await provisionHotel({
    label,
    withSecondHousekeeper: true,
    withThirdHousekeeper: opts.thirdHousekeeper,
    rooms: rooms.map((r) => ({
      room_number: r.number,
      floor: 1,
      room_type: r.type ?? null,
      status: 'dirty',
    })),
  })
  const ids = rooms.map((r) => {
    const room = hotel.rooms.find((x) => x.room_number === r.number)
    if (!room) throw new Error(`seeded hotel is missing room ${r.number}`)
    return room.id
  })
  // A single wing = one hall carrying every room = one cluster.
  const manager = await Api.loggedIn(hotel.manager.email, hotel.manager.password)
  await seedCorridorFloor(manager, hotel.hotelId, 1, [ids])
  return hotel
}

/** Open the manager's Rooms → Map → Assign view (deep-linked). */
async function openAssignView(
  page: import('@playwright/test').Page,
  hotel: SeededHotel,
): Promise<void> {
  await loginAs(page, hotel.manager.email, hotel.manager.password, { expect: 'web' })
  await page.goto(`${APP.web}/rooms?view=map&mode=assign`)
}

test('MGR-18: optimized auto-assign splits placed dirty rooms across the roster', async ({
  page,
}) => {
  const j = journey('MGR-18')
  const { hotel, placedCount } = await provisionMappedHotel('OptAssign')
  const hk1 = hotel.housekeeper
  const hk2 = hotel.housekeeper2!

  await j.step('manager opens Rooms → Map → Assign', async () => {
    await openAssignView(page, hotel)
  })
  await j.step('open the optimized auto-assign modal', async () => {
    await page.getByRole('button', { name: 'Optimized' }).click()
    await expect(
      page.getByRole('heading', { name: /Optimized auto-assign/ }),
    ).toBeVisible()
  })
  await j.step('the preview plans every placed room (default 8h shifts cover it)', async () => {
    await expect(
      page.getByRole('button', { name: `Assign ${placedCount} room(s)` }),
    ).toBeVisible()
  })
  await j.step('apply the plan, then create the tasks', async () => {
    await page.getByRole('button', { name: `Assign ${placedCount} room(s)` }).click()
    await page.getByRole('button', { name: `Create ${placedCount} task(s)` }).click()
    await expect(page.getByText(`${placedCount} task(s) created`)).toBeVisible()
  })
  await j.step('both housekeepers received a wing (authoritative)', async () => {
    const t1 = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: hk1.id })
    const t2 = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: hk2.id })
    expect(t1.length).toBe(3)
    expect(t2.length).toBe(3)
  })
})

test('MGR-19: optimized auto-assign flags rooms that overflow short shifts', async ({
  page,
}) => {
  const j = journey('MGR-19')
  const { hotel } = await provisionMappedHotel('OptOverflow')
  const hk1 = hotel.housekeeper
  const hk2 = hotel.housekeeper2!

  await j.step('manager opens the optimized modal', async () => {
    await openAssignView(page, hotel)
    await page.getByRole('button', { name: 'Optimized' }).click()
    await expect(
      page.getByRole('heading', { name: /Optimized auto-assign/ }),
    ).toBeVisible()
  })
  await j.step('shrink both shifts to 0h 30m — only one 25-min room fits each', async () => {
    for (const hk of [hk1, hk2]) {
      await page.getByLabel(`Shift hours for ${hk.name}`, { exact: true }).fill('0')
      await page
        .getByLabel(`Shift minutes for ${hk.name}`, { exact: true })
        .fill('30')
    }
    // Two rooms fit (one per housekeeper); the other four overflow.
    await expect(page.getByText(/won't fit/)).toBeVisible()
  })
  await j.step('apply and create — only the two fitting rooms become tasks', async () => {
    await page.getByRole('button', { name: 'Assign 2 room(s)' }).click()
    await page.getByRole('button', { name: 'Create 2 task(s)' }).click()
    await expect(page.getByText('2 task(s) created')).toBeVisible()
  })
  await j.step('exactly two rooms tasked, one per housekeeper; the rest untouched', async () => {
    const all = await hotel.admin.listTasks(hotel.hotelId)
    expect(all.length).toBe(2)
    const t1 = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: hk1.id })
    const t2 = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: hk2.id })
    expect(t1.length).toBe(1)
    expect(t2.length).toBe(1)
  })
})

test('MGR-20: optimized auto-assign leaves unplaced dirty rooms for manual tap-assign', async ({
  page,
}) => {
  const j = journey('MGR-20')
  const unplaced = ['901', '902']
  const { hotel, placedCount } = await provisionMappedHotel('OptUnplaced', {
    unplaced,
  })

  await j.step('manager opens Rooms → Map → Assign', async () => {
    await openAssignView(page, hotel)
  })
  await j.step('the two rooms with no placement are listed as “Not on the map”', async () => {
    await expect(
      page.getByRole('heading', { name: 'Not on the map' }),
    ).toBeVisible()
    for (const n of unplaced) {
      await expect(page.getByRole('button', { name: n, exact: true })).toBeVisible()
    }
  })
  await j.step('run the optimizer — it plans only the placed rooms', async () => {
    await page.getByRole('button', { name: 'Optimized' }).click()
    await expect(
      page.getByRole('button', { name: `Assign ${placedCount} room(s)` }),
    ).toBeVisible()
    await page.getByRole('button', { name: `Assign ${placedCount} room(s)` }).click()
    await page.getByRole('button', { name: `Create ${placedCount} task(s)` }).click()
    await expect(page.getByText(`${placedCount} task(s) created`)).toBeVisible()
  })
  await j.step('only the placed rooms were tasked; the unplaced ones remain', async () => {
    const tasks = await hotel.admin.listTasks(hotel.hotelId)
    expect(tasks.length).toBe(placedCount) // the 2 unplaced rooms are excluded
  })
})

const SIX = ['101', '102', '103', '104', '105', '106'].map((number) => ({ number }))

test('MGR-21: optimized auto-assign shares a light day across the whole roster', async ({
  page,
}) => {
  const j = journey('MGR-21')
  const hotel = await provisionCorridor('OptFairThree', SIX, { thirdHousekeeper: true })
  const crew = [hotel.housekeeper, hotel.housekeeper2!, hotel.housekeeper3!]

  await j.step('run the optimizer with three housekeepers on an ample day', async () => {
    await openAssignView(page, hotel)
    await page.getByRole('button', { name: 'Optimized' }).click()
    await page.getByRole('button', { name: 'Assign 6 room(s)' }).click()
    await page.getByRole('button', { name: 'Create 6 task(s)' }).click()
    await expect(page.getByText('6 task(s) created')).toBeVisible()
  })
  await j.step('all three get an equal share — nobody is left idle', async () => {
    for (const hk of crew) {
      const tasks = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: hk.id })
      expect(tasks.length).toBe(2) // 6 rooms ÷ 3 = 2 each, not 3/3/0
    }
  })
})

test('MGR-22: optimized auto-assign splits in proportion to shift length', async ({
  page,
}) => {
  const j = journey('MGR-22')
  const hotel = await provisionCorridor('OptProportional', SIX)
  const full = hotel.housekeeper // stays at the default 8h
  const half = hotel.housekeeper2! // dropped to 4h below

  await j.step('open the optimizer and halve the second housekeeper’s shift', async () => {
    await openAssignView(page, hotel)
    await page.getByRole('button', { name: 'Optimized' }).click()
    await page.getByLabel(`Shift hours for ${half.name}`, { exact: true }).fill('4')
    await expect(page.getByRole('button', { name: 'Assign 6 room(s)' })).toBeVisible()
  })
  await j.step('apply and create the tasks', async () => {
    await page.getByRole('button', { name: 'Assign 6 room(s)' }).click()
    await page.getByRole('button', { name: 'Create 6 task(s)' }).click()
    await expect(page.getByText('6 task(s) created')).toBeVisible()
  })
  await j.step('the 8h housekeeper gets twice the work of the 4h one (4 vs 2)', async () => {
    const fullTasks = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: full.id })
    const halfTasks = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: half.id })
    expect(fullTasks.length).toBe(4)
    expect(halfTasks.length).toBe(2)
  })
})

test('MGR-23: Quick split evenly bands the floor across the roster', async ({
  page,
}) => {
  const j = journey('MGR-23')
  const hotel = await provisionCorridor('QuickSplit', SIX)
  const hk1 = hotel.housekeeper
  const hk2 = hotel.housekeeper2!

  await j.step('use Quick split (no modal) then create the tasks', async () => {
    await openAssignView(page, hotel)
    await page.getByRole('button', { name: 'Quick split' }).click()
    await page.getByRole('button', { name: 'Create 6 task(s)' }).click()
    await expect(page.getByText('6 task(s) created')).toBeVisible()
  })
  await j.step('the even-band split hands each housekeeper half the floor (3 / 3)', async () => {
    const t1 = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: hk1.id })
    const t2 = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: hk2.id })
    expect(t1.length).toBe(3)
    expect(t2.length).toBe(3)
  })
})

test('MGR-24: optimized auto-assign balances mixed room sizes within one room', async ({
  page,
}) => {
  const j = journey('MGR-24')
  // Three suites (40m) + two standards (20m) = 160m. A fair 80/80 split lands as
  // two big rooms vs three small ones — equal cleaning time, unequal room counts.
  const spec = [
    { number: '101', type: 'STE' },
    { number: '102', type: 'STE' },
    { number: '103', type: 'STE' },
    { number: '104', type: 'STD' },
    { number: '105', type: 'STD' },
  ]
  const minutes: Record<string, number> = { STE: 40, STD: 20 }
  const hotel = await provisionCorridor('OptLumpy', spec)
  const roomMinutes = new Map(
    spec.map((r) => [
      hotel.rooms.find((x) => x.room_number === r.number)!.id,
      minutes[r.type],
    ]),
  )

  await j.step('run the optimizer and create the tasks', async () => {
    await openAssignView(page, hotel)
    await page.getByRole('button', { name: 'Optimized' }).click()
    await page.getByRole('button', { name: 'Assign 5 room(s)' }).click()
    await page.getByRole('button', { name: 'Create 5 task(s)' }).click()
    await expect(page.getByText('5 task(s) created')).toBeVisible()
  })
  await j.step('both carry equal cleaning time despite different room counts', async () => {
    const loadOf = async (hkId: string) => {
      const tasks = await hotel.admin.listTasks(hotel.hotelId, { assignedTo: hkId })
      const mins = tasks.reduce((n, t) => n + (roomMinutes.get(t.room_id) ?? 0), 0)
      return { count: tasks.length, mins }
    }
    const a = await loadOf(hotel.housekeeper.id)
    const b = await loadOf(hotel.housekeeper2!.id)
    expect(a.mins).toBe(80)
    expect(b.mins).toBe(80)
    expect([a.count, b.count].sort()).toEqual([2, 3]) // equal time, unequal counts
  })
})
