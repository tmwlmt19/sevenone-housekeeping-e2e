/**
 * Boundary / unhappy paths that are cheapest and clearest to assert at the
 * HTTP + routing layer: uniqueness conflicts, role walls, and error routes.
 * (Role-based UI redirects live with their role in the other specs; deep RBAC
 * and self-protection are also covered by the backend pytest suite.)
 *
 * Catalogue: sevenone-docs/housekeeping/testing/user-paths.md
 * (ADM-04-N, ADM-05-N, HK boundary, NAV/404).
 */
import { APP, TEST_USER_PASSWORD } from '../src/config'
import { expect, test } from '../src/fixtures'
import { Api } from '../src/harness/api'
import { loginAs } from '../src/harness/login'
import { provisionHotel } from '../src/harness/seed'
import { journey } from '../src/harness/step'

test('ADM-05-N: a duplicate room number is rejected (409)', async () => {
  const j = journey('ADM-05-N')
  const hotel = await provisionHotel({
    label: 'DupRoom',
    rooms: [
      { room_number: '301', floor: 3, room_type: 'STD', status: 'clean' },
      { room_number: '302', floor: 3, room_type: 'STD', status: 'clean' },
    ],
  })
  await j.step('renaming room 302 → 301 conflicts', async () => {
    const status = await hotel.admin.rawStatus(
      'PUT',
      `/api/v1/hotels/${hotel.hotelId}/rooms/${hotel.rooms[1].id}`,
      { room_number: hotel.rooms[0].room_number },
    )
    expect(status).toBe(409)
  })
})

test('ADM-04-N: a duplicate staff email is rejected (409)', async ({ hotel }) => {
  const j = journey('ADM-04-N')
  await j.step("setting the housekeeper's email to the manager's conflicts", async () => {
    const status = await hotel.admin.rawStatus(
      'PUT',
      `/api/v1/hotels/${hotel.hotelId}/users/${hotel.housekeeper.id}`,
      { email: hotel.manager.email },
    )
    expect(status).toBe(409)
  })
})

test('HK-STAFF-N: a housekeeper cannot list staff (403)', async ({ hotel }) => {
  const j = journey('HK-STAFF-N')
  await j.step('housekeeper GET /users is forbidden', async () => {
    const hk = await Api.loggedIn(hotel.housekeeper.email, TEST_USER_PASSWORD)
    const status = await hk.rawStatus('GET', `/api/v1/hotels/${hotel.hotelId}/users`)
    expect(status).toBe(403)
  })
})

test('API-401-N: an unauthenticated API call is rejected (401)', async () => {
  const j = journey('API-401-N')
  await j.step('GET /auth/me with no session is 401', async () => {
    const anon = new Api()
    const status = await anon.rawStatus('GET', '/api/v1/auth/me')
    expect(status).toBe(401)
  })
})

test('NAV-404-N: an unknown route renders the not-found page', async ({
  page,
  hotel,
}) => {
  const j = journey('NAV-404-N')
  // Sign in first: an *unauthenticated* visit to any URL races the /auth/me 401
  // bounce to login against the 404 render. Authenticated, the 404 is stable.
  await j.step('sign in as manager', async () => {
    await loginAs(page, hotel.manager.email, hotel.manager.password, {
      expect: 'web',
    })
  })
  await j.step('a bogus hotel-app URL shows the 404 page', async () => {
    await page.goto(`${APP.web}/this-route-does-not-exist`)
    await expect(page.getByText('This page could not be found.')).toBeVisible()
  })
})
