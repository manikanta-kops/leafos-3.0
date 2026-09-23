import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test'
import { mergeRecords } from '../src/data/merge-records.ts'
import { emptyRecords } from '../src/data/conversations.ts'
const scope = {
  installationId: 'preview-installation',
  callerId: 'human-owner',
}
async function api(
  request: APIRequestContext,
  endpoint: string,
  path: string,
  data: unknown = scope,
) {
  const r = await request.post(`${endpoint}/conversations/${path}`, { data })
  expect(r.ok()).toBeTruthy()
  return r.json()
}
async function setup(page: Page) {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.goto(`/tests/connection.html?fixture=1&endpoint=${endpoint}`)
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Notifications, 1 unread' }),
  ).toBeVisible()
  return endpoint
}
async function open(page: Page) {
  await page.getByRole('button', { name: /^Notifications, / }).click()
}

test('inbox opening and original-context navigation never read or answer a question', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  await open(page)
  await expect(
    page.getByRole('heading', { name: 'Your answer is needed' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Open original context' }).click()
  await expect(
    page.getByRole('region', { name: 'Thread: Launch plan', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Desktop first' })).toBeVisible()
  const work = await api(request, endpoint, 'work/inspect')
  expect(work.work.interactions[0].state).toBe('pending')
  expect(work.deliveries).toHaveLength(0)
  expect(
    (await api(request, endpoint, 'settings/read')).notifications[0].read,
  ).toBe(false)
  await open(page)
  await page.getByRole('button', { name: 'Mark read', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Mark read', exact: true }),
  ).toHaveCount(0)
  expect(
    (await api(request, endpoint, 'work/inspect')).work.interactions[0].state,
  ).toBe('pending')
})

test('read state synchronizes across tabs, survives reload and rejects older responses', async ({
  page,
  context,
  request,
}) => {
  const endpoint = await setup(page)
  const other = await context.newPage()
  await other.goto(page.url())
  await open(page)
  await open(other)
  const before = await api(request, endpoint, 'settings/read')
  await page.getByRole('button', { name: 'Mark read', exact: true }).click()
  await expect(
    other.getByRole('button', { name: 'Mark read', exact: true }),
  ).toHaveCount(0)
  const after = await api(request, endpoint, 'settings/read')
  const merged = mergeRecords(mergeRecords(emptyRecords(), after), before)
  expect(merged.notifications?.[0].read).toBe(true)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Notifications, 0 unread' }),
  ).toBeVisible()
  await expect(page.locator('.attention-toast')).toHaveCount(0)
})

test('stable meaningful event identities deduplicate and new attempts create distinct history', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const work = (await api(request, endpoint, 'work/inspect')).work.workflows[0]
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: work.target.threadId,
    scenario: 'fail',
  })
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: work.target.threadId,
    scenario: 'fail',
  })
  let inbox = (await api(request, endpoint, 'settings/read')).notifications
  expect(inbox.filter((n: any) => n.kind === 'failure')).toHaveLength(1)
  const failure = inbox.find((n: any) => n.kind === 'failure')
  await api(request, endpoint, 'settings/command', {
    operationId: crypto.randomUUID(),
    target: scope,
    action: 'read',
    notificationId: failure.id,
  })
  await api(request, endpoint, 'work/command', {
    operationId: crypto.randomUUID(),
    target: work.target,
    action: 'retry',
    runId: work.runId,
    attemptId: work.attemptId,
  })
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: work.target.threadId,
    scenario: 'fail',
  })
  inbox = (await api(request, endpoint, 'settings/read')).notifications
  expect(inbox.filter((n: any) => n.kind === 'failure')).toHaveLength(2)
  expect(inbox.find((n: any) => n.id === failure.id).read).toBe(true)
})

test('cancelled targets cannot restore obsolete interaction actions', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const work = (await api(request, endpoint, 'work/inspect')).work.workflows[0]
  await api(request, endpoint, 'work/command', {
    operationId: crypto.randomUUID(),
    target: work.target,
    action: 'stop',
    runId: work.runId,
    attemptId: work.attemptId,
  })
  await open(page)
  await page.getByRole('button', { name: 'Open original context' }).click()
  await expect(
    page.getByRole('button', { name: 'Send answer', exact: true }),
  ).toHaveCount(0)
  await expect(page.locator('.interaction-card')).toContainText('cancelled')
  expect(
    (await api(request, endpoint, 'settings/read')).notifications[0].read,
  ).toBe(false)
})

test('expired application cursor and offline return restore inbox without popup bursts', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  let expired = false
  await page.route('**/conversations/events?**', async (route) => {
    if (!expired && !route.request().url().includes('threadId')) {
      expired = true
      await route.fulfill({ status: 409, json: { code: 'cursor-expired' } })
    } else await route.continue()
  })
  await page.reload()
  await expect.poll(() => expired).toBe(true)
  await expect(
    page.getByRole('button', { name: 'Notifications, 1 unread' }),
  ).toBeVisible()
  await expect(page.locator('.attention-toast')).toHaveCount(0)
  await page.context().setOffline(true)
  const work = (await api(request, endpoint, 'work/inspect')).work.workflows[0]
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: work.target.threadId,
    scenario: 'recovery',
  })
  await page.context().setOffline(false)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Notifications, 2 unread' }),
  ).toBeVisible()
  await expect(page.locator('.attention-toast')).toHaveCount(0)
})

test('missing original target produces an actionable result without marking read', async ({
  page,
}) => {
  await setup(page)
  await page.route('**/conversations/history', (route) =>
    route.fulfill({ status: 404, json: { message: 'Deleted target' } }),
  )
  await open(page)
  await page.getByRole('button', { name: 'Open original context' }).click()
  await expect(
    page.getByText('The original target is unavailable.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Mark read', exact: true }),
  ).toBeVisible()
})

test('settings and inbox keyboard focus, narrow light/dark, reduced motion and screenshots', async ({
  page,
}) => {
  await setup(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const mode of ['light', 'dark']) {
    const switcher = page.getByRole('button', {
      name: `Switch to ${mode} mode`,
    })
    if (await switcher.isVisible()) await switcher.click()
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await page.getByRole('button', { name: 'Settings', exact: true }).focus()
      await page.keyboard.press('Enter')
      const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
      await expect(dialog).toBeVisible()
      await page
        .getByLabel('Organization instructions', { exact: true })
        .fill('A long instruction '.repeat(30))
      await expect(
        page.getByRole('button', { name: 'Save changes', exact: true }),
      ).toBeEnabled()
      await page
        .getByRole('button', { name: 'Discard draft', exact: true })
        .click()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: `../../internal-docs/step-06/settings-${mode}-${width}.png`,
      })
      await page.keyboard.press('Escape')
      await expect(
        page.getByRole('button', { name: 'Settings', exact: true }),
      ).toBeFocused()
      await open(page)
      await page.screenshot({
        path: `../../internal-docs/step-06/inbox-${mode}-${width}.png`,
      })
      await page.keyboard.press('Escape')
    }
  }
})

test('same-browser background tabs claim one synthetic alert and startup never requests permission', async ({
  page,
  context,
  request,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  const url = `/tests/connection.html?fixture=1&endpoint=${endpoint}&notification=background`
  await page.goto(url)
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  const driver = (p: Page) => p.evaluate(() => (window as any).notificationTest)
  expect((await driver(page)).prompts).toBe(0)
  expect((await driver(page)).sends).toHaveLength(0)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page
    .getByRole('button', { name: 'Enable and test notifications' })
    .click()
  await expect(
    page.getByText(
      'Desktop notification requested. The OS may suppress it; delivery is not confirmed.',
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()
  const other = await context.newPage()
  await other.goto(url)
  await expect(
    other.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  const work = (await api(request, endpoint, 'work/inspect')).work.workflows[0]
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: work.target.threadId,
    scenario: 'fail',
  })
  await expect
    .poll(
      async () =>
        (await driver(page)).sends.length + (await driver(other)).sends.length,
    )
    .toBe(2)
  expect((await driver(page)).prompts + (await driver(other)).prompts).toBe(0)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Notifications, 2 unread' }),
  ).toBeVisible()
  expect((await driver(page)).sends).toHaveLength(0)
})

test('foreground attention suppressed at original thread and appears away from it', async ({
  page,
  request,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.goto(
    `/tests/connection.html?fixture=1&endpoint=${endpoint}&notification=foreground`,
  )
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  const work = (await api(request, endpoint, 'work/inspect')).work.workflows[0]
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: work.target.threadId,
    scenario: 'fail',
  })
  await expect(
    page.getByRole('button', { name: 'Notifications, 2 unread' }),
  ).toBeVisible()
  await expect(page.locator('.attention-toast')).toHaveCount(0)
  await page.getByRole('button', { name: 'Close thread' }).click()
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: work.target.threadId,
    scenario: 'recovery',
  })
  await expect(page.locator('.attention-toast')).toContainText(
    'Work needs recovery',
  )
})

test('uncertain read update retries same identity and never dispatches an interaction response', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const sent: any[] = []
  await page.route('**/settings/command', async (route) => {
    sent.push(route.request().postDataJSON())
    if (sent.length === 1) await route.abort('failed')
    else await route.continue()
  })
  await open(page)
  await page.getByRole('button', { name: 'Mark read', exact: true }).click()
  await expect(
    page.getByText('Read update uncertain.', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Retry original read update' }).click()
  await expect(
    page.getByRole('button', { name: 'Mark read', exact: true }),
  ).toHaveCount(0)
  expect(sent[1]).toEqual(sent[0])
  expect(
    (await api(request, endpoint, 'work/inspect')).deliveries,
  ).toHaveLength(0)
})

test('permission denial uses synthetic driver only and never enables background alerts', async ({
  page,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.goto(
    `/tests/connection.html?fixture=1&endpoint=${endpoint}&notification=background`,
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page.evaluate(() => {
    ;(window as any).notificationTest.permission = 'denied'
  })
  await page
    .getByRole('button', { name: 'Enable and test notifications' })
    .click()
  await expect(
    page.getByText(
      'Desktop notifications denied. Your persistent inbox remains available.',
    ),
  ).toBeVisible()
  const driver = await page.evaluate(() => (window as any).notificationTest)
  expect(driver.prompts).toBe(1)
  expect(driver.sends).toHaveLength(0)
  await expect(
    page.getByRole('button', { name: 'Disable desktop alerts' }),
  ).toHaveCount(0)
})
