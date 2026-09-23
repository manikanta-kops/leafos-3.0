import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test'

const scope = {
  installationId: 'preview-installation',
  callerId: 'human-owner',
}
const newEndpoint = () =>
  `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
async function start(page: Page, endpoint: string, extra = '') {
  await page.goto(
    `/tests/connection.html?fixture=1&endpoint=${endpoint}${extra}`,
  )
  await expect(
    page.getByRole('button', { name: 'Notifications, 1 unread' }),
  ).toBeVisible()
}
async function failWork(request: APIRequestContext, endpoint: string) {
  const result = await request.post(`${endpoint}/conversations/work/inspect`, {
    data: scope,
  })
  const work = (await result.json()).work.workflows[0]
  const failed = await request.post(`${endpoint}/conversations/work/scenario`, {
    data: { ...scope, threadId: work.target.threadId, scenario: 'fail' },
  })
  expect(failed.ok()).toBeTruthy()
}

test('read reservation failure remains visible and does not silently swallow the action', async ({
  page,
  request,
}) => {
  const endpoint = newEndpoint()
  let writes = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/settings/command')) writes++
  })
  await start(page, endpoint, '&control-storage=fail-reserve')
  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click()
  await page.getByRole('button', { name: 'Mark read', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  expect(writes).toBe(0)
  const response = await request.post(
    `${endpoint}/conversations/settings/read`,
    { data: scope },
  )
  expect((await response.json()).notifications[0].read).toBe(false)
  await page
    .getByRole('button', { name: 'Retry Mark read', exact: true })
    .click()
  await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
  expect(writes).toBe(0)
  await page.getByRole('button', { name: 'Close notifications' }).click()
  await page.getByRole('button', { name: 'Allow work storage' }).click()
  await page.getByRole('button', { name: 'Notifications, 1 unread' }).click()
  await page.getByRole('button', { name: 'Mark read', exact: true }).click()
  await expect(page.getByRole('button', { name: /Mark read/ })).toHaveCount(0)
  expect(writes).toBe(1)
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Notifications, 0 unread' }),
  ).toBeVisible()
})

test('failed disable preference write cannot claim that background alerts are disabled', async ({
  page,
}) => {
  await start(page, newEndpoint(), '&notification=background')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page
    .getByRole('button', { name: 'Enable and test notifications' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Disable desktop alerts' }),
  ).toBeVisible()
  await page.evaluate(() => {
    const original = Storage.prototype.setItem
    Object.assign(window, {
      restorePreferenceWrite: () => {
        Storage.prototype.setItem = original
      },
    })
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith('leafos:desktop-notifications:') &&
        value === 'disabled'
      )
        throw new DOMException('Storage unavailable', 'QuotaExceededError')
      return original.call(this, key, value)
    }
  })
  await page.getByRole('button', { name: 'Disable desktop alerts' }).click()
  const actual = await page.evaluate(() =>
    Object.keys(localStorage)
      .filter((k) => k.startsWith('leafos:desktop-notifications:'))
      .map((k) => localStorage.getItem(k)),
  )
  expect(actual).toEqual(['enabled'])
  await expect(
    page.getByText('Background desktop alerts disabled.', { exact: true }),
  ).toHaveCount(0)
  await expect(page.getByText(/could not be saved/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Disable desktop alerts' }),
  ).toBeVisible()
  await page.evaluate(() => (window as any).restorePreferenceWrite())
  await page.getByRole('button', { name: 'Disable desktop alerts' }).click()
  await expect(
    page.getByText('Background desktop alerts disabled.', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Enable and test notifications' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Disable desktop alerts' }),
  ).toHaveCount(0)
})

test('ineligible background tab cannot consume live foreground attention', async ({
  page,
  context,
  request,
}) => {
  const endpoint = newEndpoint()
  await start(page, endpoint, '&notification=background')
  const foreground = await context.newPage()
  await foreground.addInitScript(() => {
    const gate = { hold: false, release: () => {} }
    Object.assign(window, { reviewAttentionGate: gate })
    const original = window.fetch
    window.fetch = async (...args) => {
      const response = await original(...args)
      const url = String(args[0])
      if (
        !url.includes('/conversations/events?') ||
        url.includes('threadId=') ||
        !response.body
      )
        return response
      const body = response.body.pipeThrough(
        new TransformStream({
          async transform(chunk, controller) {
            if (gate.hold)
              await new Promise<void>((resolve) => {
                gate.release = resolve
              })
            controller.enqueue(chunk)
          },
        }),
      )
      return new Response(body, {
        status: response.status,
        headers: response.headers,
      })
    }
  })
  await start(foreground, endpoint, '&notification=foreground')
  await foreground.evaluate(() => {
    ;(window as any).reviewAttentionGate.hold = true
  })
  await failWork(request, endpoint)
  await expect(
    page.getByRole('button', { name: 'Notifications, 2 unread' }),
  ).toBeVisible()
  // The synthetic foreground probe runs inside attention processing. Waiting for
  // it proves the background tab evaluated this live event before releasing it.
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).notificationTest.attentionChecks),
    )
    .toBeGreaterThan(0)
  expect(
    await page.evaluate(() => (window as any).notificationTest.sends),
  ).toHaveLength(0)
  await foreground.evaluate(() => {
    const gate = (window as any).reviewAttentionGate
    gate.hold = false
    gate.release()
  })
  await expect(
    foreground.getByRole('button', { name: 'Notifications, 2 unread' }),
  ).toBeVisible()
  await expect(foreground.locator('.attention-toast')).toContainText(
    'Work failed',
  )
  await foreground.reload()
  await expect(
    foreground.getByRole('button', { name: 'Notifications, 2 unread' }),
  ).toBeVisible()
  await expect(foreground.locator('.attention-toast')).toHaveCount(0)
})
