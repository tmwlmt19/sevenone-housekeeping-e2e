import { test as base, expect } from '@playwright/test'

import { attachDiagnostics } from './harness/diagnostics'
import { provisionHotel, type SeededHotel } from './harness/seed'

/**
 * The suite's custom `test`. Two things come for free on every test:
 *
 *  - `page` is wrapped with {@link attachDiagnostics}, so a failing test attaches
 *    the browser console + bad network requests to the report automatically.
 *  - `hotel` provisions an isolated, uniquely-named hotel (manager + housekeeper
 *    + a room, forced-change already cleared) via the real API. Because each
 *    test owns its data, tests run in parallel with no shared-state coupling and
 *    need no DB reset between runs.
 *
 * Import `{ test, expect }` from here instead of `@playwright/test`.
 */
export const test = base.extend<{ hotel: SeededHotel }>({
  page: async ({ page }, use, testInfo) => {
    const teardown = attachDiagnostics(page, testInfo)
    await use(page)
    await teardown()
  },

  hotel: async ({}, use) => {
    const hotel = await provisionHotel()
    await use(hotel)
  },
})

export { expect }
