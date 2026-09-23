import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
test('media cards and recovery keep keyboard actions visible in all layouts', async ({
  page,
  request,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.route('**/__fixtures/workspace**', (route) =>
    route.continue({
      url: route.request().url().replace('/__fixtures/workspace', endpoint),
    }),
  )
  await page.goto('/')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  const thread = page.getByRole('region', {
    name: 'Thread: Launch plan',
    exact: true,
  })
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 300
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ece7fa'
    ctx.fillRect(0, 0, 640, 300)
    ctx.fillStyle = '#6246c8'
    ctx.fillRect(24, 24, 592, 252)
    ctx.fillStyle = '#ffffff'
    ctx.font = '32px sans-serif'
    ctx.fillText('Synthetic design reference', 48, 104)
    ctx.font = '20px sans-serif'
    ctx.fillText('Interface • Conversations • Desktop', 48, 158)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await thread.locator('input[type=file]').setInputFiles([
    {
      name: 'design-reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    },
    {
      name: 'release-checklist.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Synthetic release checklist'),
    },
  ])
  await expect(thread.getByText(/Uploaded/)).toHaveCount(2)
  const directory = resolve('../../internal-docs/step-05/screenshots')
  const capture = async (name: string) => {
    await expect(
      thread.getByRole('textbox', { name: 'Reply in this thread…' }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true)
    const box = await thread
      .getByRole('button', { name: 'Send message', exact: true })
      .boundingBox()
    expect(box!.y + box!.height).toBeLessThanOrEqual(
      (await page.viewportSize())!.height,
    )
    if (process.env.STEP5_SCREENSHOTS === '1') {
      await mkdir(directory, { recursive: true })
      await page.screenshot({
        path: resolve(directory, `${name}.png`),
        animations: 'disabled',
      })
    }
  }
  await capture('01-light-split-pending')
  await thread
    .getByRole('textbox', { name: 'Reply in this thread…', exact: true })
    .fill('The outline and visual reference are ready.')
  await thread
    .getByRole('button', { name: 'Send message', exact: true })
    .click()
  await expect(
    thread
      .getByRole('region', { name: 'File: design-reference.png' })
      .locator('img'),
  ).toBeVisible()
  const download = thread.getByRole('button', {
    name: 'Prepare download release-checklist.txt',
  })
  await download.focus()
  await page.keyboard.press('Enter')
  const link = thread.getByRole('link', {
    name: 'Download release-checklist.txt',
  })
  await expect(link).toBeVisible()
  await link.focus()
  await expect(link).toBeFocused()
  await capture('02-light-split-completed')
  await page.getByRole('button', { name: 'Expand thread' }).click()
  await capture('03-light-expanded-completed')
  await page.getByRole('button', { name: 'Restore split view' }).click()
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.getByRole('button', { name: 'Expand thread' }).click()
  await capture('04-dark-expanded-completed')
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('05-dark-narrow-completed')
  const target = {
    installationId: 'preview-installation',
    callerId: 'human-owner',
    context: { kind: 'organization', organizationId: 'studio' },
    chatId: 'chat-ari-studio',
    threadId: 'thread-launch',
  }
  // Derive the fixture chat identity instead of depending on the UI's selected state.
  const chatResponse = await request.post(`${endpoint}/conversations/resolve`, {
    data: {
      installationId: target.installationId,
      callerId: target.callerId,
      context: target.context,
      agentId: 'ari',
    },
  })
  target.chatId = (await chatResponse.json()).id
  await request.post(`${endpoint}/conversations/media/scenario`, {
    data: { target, scenario: { upload: 'fail' } },
  })
  await thread.locator('input[type=file]').setInputFiles({
    name: 'retry-this.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic retry bytes'),
  })
  await expect(thread.getByText(/Upload outcome unconfirmed/)).toBeVisible()
  await capture('06-dark-narrow-error')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Restore split view' }).click()
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await capture('07-light-narrow-error')
  await thread.getByRole('button', { name: 'Retry upload' }).focus()
  await expect(
    thread.getByRole('button', { name: 'Retry upload' }),
  ).toBeFocused()
})
