import { expect, test } from '@playwright/test'

test('thread reply stays in its thread and focus returns on close', async ({
  page,
}) => {
  await page.goto('/')
  const trigger = page.getByRole('button', {
    name: 'Open thread: Launch plan',
    exact: true,
  })
  await trigger.click()
  const thread = page.getByRole('region', {
    name: 'Thread: Launch plan',
    exact: true,
  })
  await expect(
    thread.getByRole('button', { name: 'Close thread' }),
  ).toBeFocused()
  const reply = thread.getByRole('textbox', { name: 'Reply in this thread…' })
  await reply.fill('A local reply for this thread.')
  await expect(
    thread.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeEnabled()
  await reply.press('Enter')
  await expect(
    thread
      .locator('.thread-reply')
      .getByText('A local reply for this thread.', { exact: true }),
  ).toBeVisible()
  await expect(trigger).toContainText('5 replies')
  await expect(reply).toHaveValue('')
  await reply.press('Escape')
  await expect(thread).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(
    page
      .locator('.feed')
      .getByText('A local reply for this thread.', { exact: true }),
  ).toHaveCount(0)
})

test('agent drafts survive navigation and whitespace cannot be sent', async ({
  page,
}) => {
  await page.goto('/')
  await page
    .getByRole('textbox', { name: 'Message Ari…' })
    .fill('Draft for Ari')
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  const composer = page.getByRole('textbox', { name: 'Message Mira…' })
  await composer.fill('   ')
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeDisabled()
  await composer.fill('Hello Mira')
  await composer.press('Enter')
  await expect(page.getByText('Hello Mira', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ari', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message Ari…' })).toHaveValue(
    'Draft for Ari',
  )
  await expect(page.getByText('Hello Mira', { exact: true })).toHaveCount(0)
})

test('theme survives reload and narrow thread layout stays within viewport', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Switch to light mode' }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  await expect(
    page.getByRole('textbox', { name: 'Reply in this thread…' }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message Ari…' })).toBeHidden()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('button', { name: 'Close thread' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
})

test('file-only messages upload original bytes and reference stable artifacts', async ({
  page,
}) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles({
    name: 'scope.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Preview attachment'),
  })
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Send message', exact: true }).click()
  await expect(page.locator('.artifact-card')).toContainText('scope.txt')
  await page.getByRole('button', { name: 'Prepare download scope.txt' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download scope.txt' }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream!) chunks.push(chunk)
  expect(Buffer.concat(chunks).toString()).toBe('Preview attachment')
  await expect(page.locator('.attachment-list')).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('No agent is connected')
})

test('IME composition cannot submit and Shift+Enter retains a newline', async ({
  page,
}) => {
  await page.goto('/')
  const composer = page.getByRole('textbox', { name: 'Message Ari…' })
  await composer.fill('Composing')
  await composer.dispatchEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    isComposing: true,
    bubbles: true,
  })
  await expect(composer).toHaveValue('Composing')
  await expect(
    page.locator('.feed').getByText('Composing', { exact: true }),
  ).toHaveCount(0)
  await composer.press('End')
  await composer.press('Shift+Enter')
  await expect(composer).toHaveValue('Composing\n')
})
