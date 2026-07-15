import type { Page, TestInfo } from '@playwright/test'

/**
 * Wire a page for post-mortem diagnosis. Collects browser console errors, page
 * errors, and failed/4xx+ network responses for the life of the test, and — only
 * when the test fails — attaches them to the report next to the trace/screenshot/
 * video. So a red test tells you, in one place: which step broke (see step.ts),
 * what the browser logged, and which request went wrong.
 *
 * Returns a teardown function the fixture calls after the test body.
 */
export function attachDiagnostics(
  page: Page,
  testInfo: TestInfo,
): () => Promise<void> {
  const consoleErrors: string[] = []
  const networkProblems: string[] = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[console.error] ${msg.text()}`)
  })
  page.on('pageerror', (err) => {
    consoleErrors.push(`[pageerror] ${err.message}`)
  })
  page.on('requestfailed', (req) => {
    networkProblems.push(
      `[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'unknown'}`,
    )
  })
  page.on('response', (res) => {
    if (res.status() >= 400) {
      networkProblems.push(
        `[${res.status()}] ${res.request().method()} ${res.url()}`,
      )
    }
  })

  return async () => {
    const failed = testInfo.status !== testInfo.expectedStatus
    if (!failed) return
    if (consoleErrors.length) {
      await testInfo.attach('browser-console-errors', {
        body: consoleErrors.join('\n'),
        contentType: 'text/plain',
      })
    }
    if (networkProblems.length) {
      await testInfo.attach('failed-network-requests', {
        body: networkProblems.join('\n'),
        contentType: 'text/plain',
      })
    }
  }
}
