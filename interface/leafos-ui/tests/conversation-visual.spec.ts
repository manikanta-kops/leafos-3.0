import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

test('conversation layouts retain focus, fit narrow screens, and honor reduced motion', async ({
  page,
}) => {
  const suffix = crypto.randomUUID().replaceAll('-', '')
  await page.route('**/__fixtures/workspace**', (route) =>
    route.continue({
      url: route
        .request()
        .url()
        .replace('/__fixtures/workspace', `/__fixtures/workspace-${suffix}`),
    }),
  )
  const directory = resolve('../../internal-docs/step-03/screenshots')
  const capture = async (name: string) => {
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .every((animation) => animation.playState !== 'running') &&
            Array.from(
              document.querySelectorAll(
                '.conversation,.thread-pane,.composer-wrap,.feed,.thread-reply',
              ),
            ).every((element) => {
              const style = getComputedStyle(element)
              return (
                style.transform === 'none' && Number(style.opacity) >= 0.999
              )
            }),
        ),
      )
      .toBe(true)
    if (process.env.STEP3_SCREENSHOTS === '1') {
      await mkdir(directory, { recursive: true })
      await page.screenshot({
        path: resolve(directory, `${name}.png`),
        animations: 'disabled',
      })
    }
  }
  await page.goto('/')
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  await capture('01-light-feed')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await capture('02-dark-feed')
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  const trigger = page.getByRole('button', {
    name: 'Open thread: Launch plan',
    exact: true,
  })
  await trigger.click()
  await expect(page.getByRole('button', { name: 'Close thread' })).toBeFocused()
  await capture('03-dark-split')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await capture('04-light-split')
  await page.getByRole('button', { name: 'Expand thread' }).click()
  await expect(page.getByRole('textbox', { name: 'Message Ari…' })).toBeHidden()
  await capture('05-light-expanded')
  await page.getByRole('button', { name: 'Restore split view' }).click()
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(
    page.getByRole('textbox', { name: 'Reply in this thread…' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await capture('06-dark-narrow-thread')
  await page
    .getByRole('textbox', { name: 'Reply in this thread…' })
    .press('Escape')
  await expect(trigger).toBeFocused()
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await capture('07-light-narrow-feed')
})
