import { ADMIN, E2E_EMAIL_DOMAIN, TEST_USER_PASSWORD } from '../config'
import { Api } from './api'

export interface SeededUser {
  id: string
  email: string
  name: string
  /** The password this user can log in with *after* seeding. For fixture users
   * this is {@link TEST_USER_PASSWORD} (forced-change already cleared); for a
   * user seeded with `clearForcedChange: false` it is the shared temp password. */
  password: string
  /** True if the account still requires a first-login password change. */
  mustChangePassword: boolean
}

export interface SeededHotel {
  hotelId: string
  hotelName: string
  /** Admin client already logged in as the platform admin. */
  admin: Api
  manager: SeededUser
  housekeeper: SeededUser
  rooms: Array<{ id: string; room_number: string }>
  /** The one-time shared temp password the provision endpoint returned. */
  tempPassword: string
}

export interface ProvisionOptions {
  /** Human label baked into the hotel name (helps identify data in the DB). */
  label?: string
  rooms?: Array<{
    room_number: string
    floor?: number | null
    room_type?: string | null
    status?: string
  }>
  /**
   * When true (default) the seed clears each staff member's forced first-login
   * password change and sets it to {@link TEST_USER_PASSWORD}, so UI logins are
   * a single step. Set false to leave the forced-change flag intact — used by
   * the tests that exercise the forced-change ceremony itself (AUTH-04).
   */
  clearForcedChange?: boolean
}

/** A short, email-safe, collision-resistant suffix for this test's data. */
export function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Provision an isolated hotel (unique name + emails) with one manager, one
 * housekeeper, and a room, via the real `POST /hotels/provision`. Because every
 * test gets its own hotel, tests never collide and need no DB reset between runs.
 */
export async function provisionHotel(
  opts: ProvisionOptions = {},
): Promise<SeededHotel> {
  const clearForced = opts.clearForcedChange ?? true
  const suffix = uniqueSuffix()
  const admin = await Api.loggedIn(ADMIN.email, ADMIN.password)

  const hotelName = `E2E ${opts.label ?? 'Hotel'} ${suffix}`
  const managerEmail = `mgr-${suffix}@${E2E_EMAIL_DOMAIN}`
  const housekeeperEmail = `hk-${suffix}@${E2E_EMAIL_DOMAIN}`

  const result = await admin.provision({
    hotel: { name: hotelName, address: null },
    rooms:
      opts.rooms ??
      [{ room_number: '201', floor: 2, room_type: 'STD', status: 'dirty' }],
    users: [
      { name: `Manager ${suffix}`, email: managerEmail, role: 'manager' },
      {
        name: `Housekeeper ${suffix}`,
        email: housekeeperEmail,
        role: 'housekeeper',
      },
    ],
  })

  const hotelId = result.hotel.id
  const tempPassword = result.temporary_password
  const find = (role: string) => {
    const u = result.users.find((x) => x.role === role)
    if (!u) throw new Error(`provision did not return a ${role}`)
    return u
  }
  const mgrRaw = find('manager')
  const hkRaw = find('housekeeper')

  // Rooms come back only as a count; fetch them to get ids/numbers.
  const rooms = (await admin.listRooms(hotelId)).map((r) => ({
    id: r.id,
    room_number: r.room_number,
  }))

  const manager: SeededUser = {
    id: mgrRaw.id,
    email: mgrRaw.email,
    name: mgrRaw.name,
    password: tempPassword,
    mustChangePassword: true,
  }
  const housekeeper: SeededUser = {
    id: hkRaw.id,
    email: hkRaw.email,
    name: hkRaw.name,
    password: tempPassword,
    mustChangePassword: true,
  }

  if (clearForced) {
    await clearForcedPasswordChange(manager)
    await clearForcedPasswordChange(housekeeper)
  }

  return { hotelId, hotelName, admin, manager, housekeeper, rooms, tempPassword }
}

/**
 * Walk a freshly provisioned user through the (API equivalent of the) forced
 * first-login password change: log in with the temp password and set the known
 * test password, which also clears `must_change_password` server-side. Mutates
 * the passed user in place.
 */
export async function clearForcedPasswordChange(user: SeededUser): Promise<void> {
  const api = await Api.loggedIn(user.email, user.password)
  await api.changeOwnPassword(user.password, TEST_USER_PASSWORD)
  user.password = TEST_USER_PASSWORD
  user.mustChangePassword = false
}
