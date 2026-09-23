import { expect, test } from '@playwright/test'

for (const theme of ['light', 'dark']) {
  test(`${theme} scenic canvas remains continuous in split expanded and narrow views`, async ({
    page,
  }) => {
    await page.emulateMedia({
      reducedMotion: 'reduce',
      colorScheme: theme as 'light' | 'dark',
    })
    await page.setViewportSize({ width: 1584, height: 992 })
    await page.goto('/')
    await expect(
      page.getByRole('textbox', { name: 'Message Ari…' }),
    ).toBeVisible()
    await expect(page.locator('.feed')).toHaveCSS('opacity', '1')
    for (const message of await page.locator('.feed-message').all())
      await expect(message).toHaveCSS('opacity', '1')
    await page.screenshot({
      path: `../../internal-docs/step-06/scenic-${theme}-root.png`,
    })
    await page
      .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
      .click()
    await expect(
      page.getByRole('textbox', { name: 'Reply in this thread…' }),
    ).toBeVisible()
    for (const layout of ['split', 'expanded', 'narrow']) {
      if (layout === 'expanded')
        await page.getByRole('button', { name: 'Expand thread' }).click()
      if (layout === 'narrow')
        await page.setViewportSize({ width: 390, height: 844 })
      await expect(
        page.getByRole('textbox', { name: 'Reply in this thread…' }),
      ).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await expect(page.locator('.thread-pane')).toHaveCSS('opacity', '1')
      await page
        .getByRole('button', { name: 'Dismiss question', exact: true })
        .scrollIntoViewIfNeeded()
      await page.screenshot({
        path: `../../internal-docs/step-06/scenic-${theme}-${layout}.png`,
      })
    }
  })
}
