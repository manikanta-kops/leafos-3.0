import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
test('work cards support keyboard focus, reduced motion and all thread layouts', async ({
  page,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.route('**/__fixtures/workspace**', (route) =>
    route.continue({
      url: route.request().url().replace('/__fixtures/workspace', endpoint),
    }),
  )
  await page.goto('/')
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  const directory = resolve('../../internal-docs/step-04/screenshots')
  await mkdir(directory, { recursive: true })
  const capture = async (name: string) => {
    await page.locator('.interaction-card').scrollIntoViewIfNeeded()
    await page.screenshot({
      path: resolve(directory, `${name}.png`),
      animations: 'disabled',
    })
  }
  await capture('01-light-split')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await capture('02-dark-split')
  await page.getByRole('button', { name: 'Expand thread' }).click()
  await capture('03-dark-expanded')
  await page.getByRole('button', { name: 'Restore split view' }).click()
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.getByRole('button', { name: 'Expand thread' }).click()
  await capture('04-light-expanded')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('05-light-narrow')
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('radio', { name: 'Desktop first' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('textbox', { name: 'Your answer or additional detail' }),
  ).toBeFocused()
  await page.keyboard.type('Small beta first')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(
    page.getByText('Recorded response', { exact: true }),
  ).toBeFocused()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Small beta first',
  )
  await page.getByRole('button', { name: 'Close thread' }).click()
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  await capture('06-dark-narrow-settled')
  await page.route('**/work/command', (route) => route.abort())
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Retry same command' }),
  ).toBeInViewport()
  await page.screenshot({
    path: resolve(directory, '07-dark-narrow-recovery.png'),
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Expand thread' }).click()
  await page.screenshot({
    path: resolve(directory, '08-dark-expanded-recovery.png'),
    animations: 'disabled',
  })
})
