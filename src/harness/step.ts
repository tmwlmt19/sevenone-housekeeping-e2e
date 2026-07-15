import { test, type TestInfo } from '@playwright/test'

/**
 * Journey — the diagnosability core of the suite.
 *
 * A test constructs one `Journey` for the path it covers (e.g. `AUTH-01`) and
 * wraps each meaningful action in `journey.step('...', async () => { ... })`.
 * Every step:
 *   1. auto-increments a step number and logs `▶ [AUTH-01] step 3 — ...` to
 *      stdout (visible in the `list` reporter + CI logs), then `✓`/`✗`,
 *   2. wraps the body in a Playwright `test.step`, so the HTML report and the
 *      trace timeline show the exact step boundaries,
 *   3. on throw, logs `✗ ... ← FAILED HERE` and records a `failed-step`
 *      annotation, so a red test names precisely where in the path it broke.
 *
 * The result: when a test fails you can read the console top-to-bottom and see
 * the last `▶` with no matching `✓` — that's the step that broke — and the same
 * label is in the report next to the trace/screenshot/video.
 */
export class Journey {
  private n = 0

  constructor(
    readonly pathId: string,
    private readonly info: TestInfo,
  ) {
    this.info.annotations.push({ type: 'path', description: pathId })
    log(`\n━━━ [${pathId}] ${this.info.title}`)
  }

  async step<T>(label: string, body: () => Promise<T>): Promise<T> {
    const n = ++this.n
    const tag = `[${this.pathId}] step ${n} — ${label}`
    log(`  ▶ ${tag}`)
    return test.step(tag, async () => {
      try {
        const result = await body()
        log(`  ✓ ${tag}`)
        return result
      } catch (err) {
        log(`  ✗ ${tag}   ← FAILED HERE`)
        this.info.annotations.push({ type: 'failed-step', description: tag })
        throw err
      }
    })
  }

  /** A non-async marker for a plain assertion or note in the timeline. */
  note(label: string): void {
    log(`  · [${this.pathId}] ${label}`)
  }
}

/** Start a journey for the currently running test. */
export function journey(pathId: string): Journey {
  return new Journey(pathId, test.info())
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg)
}
