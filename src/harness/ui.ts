import { type Locator, type Page } from '@playwright/test'

/**
 * Pick an option from a shadcn/Radix `<Select>`. These render as a `combobox`
 * trigger button that opens a portal of `option` items — not a native <select>,
 * so we click the trigger then the option.
 */
export async function chooseOption(
  page: Page,
  trigger: Locator,
  optionName: string | RegExp,
): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: optionName }).click()
}

/** The Radix Select trigger currently showing `text` (e.g. its placeholder or
 * current value). Use to target one of several selects on a form. */
export function selectShowing(page: Page, text: string | RegExp): Locator {
  return page.getByRole('combobox').filter({ hasText: text })
}
