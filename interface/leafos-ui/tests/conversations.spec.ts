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
async function setup(page: Page) {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.goto(`/tests/connection.html?fixture=1&endpoint=${endpoint}`)
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  return endpoint
}
async function api(
  request: APIRequestContext,
  endpoint: string,
  path: string,
  body: unknown,
) {
  const response = await request.post(`${endpoint}/conversations/${path}`, {
    data: body,
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}
async function target(request: APIRequestContext, endpoint: string) {
  const context = { kind: 'organization', organizationId: 'studio' }
  const chat = await api(request, endpoint, 'resolve', {
    ...scope,
    agentId: 'ari',
    context,
  })
  return { ...scope, context, chatId: chat.id }
}
async function saved(page: Page, text: string) {
  await expect
    .poll(() =>
      page.evaluate(async (text) => {
        return new Promise<boolean>((resolve, reject) => {
          const open = indexedDB.open('leafos-conversations')
          open.onerror = () => reject(open.error)
          open.onsuccess = () => {
            const db = open.result
            const tx = db.transaction('drafts')
            const get = tx.objectStore('drafts').getAll()
            get.onsuccess = () =>
              resolve(get.result.some((d: { text: string }) => d.text === text))
            tx.oncomplete = () => db.close()
          }
        })
      }, text),
    )
    .toBe(true)
}

test('concurrent resolution and accepted ID reuse preserve original action and content', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const targets = await Promise.all(
    Array.from({ length: 6 }, () => target(request, endpoint)),
  )
  expect(new Set(targets.map((t) => t.chatId)).size).toBe(1)
  const submission = {
    submissionId: crypto.randomUUID(),
    target: targets[0],
    parts: [{ type: 'text', text: 'Original intended content' }],
  }
  const receipts = await Promise.all([
    api(request, endpoint, 'submit', submission),
    api(request, endpoint, 'submit', submission),
  ])
  expect(receipts[0].messageId).toBe(receipts[1].messageId)
  const changed = await api(request, endpoint, 'submit', {
    ...submission,
    parts: [{ type: 'text', text: 'Changed reuse must not be accepted' }],
  })
  expect(changed.alreadyAccepted).toBe(true)
  expect(changed.messageId).toBe(receipts[0].messageId)
  expect(changed.records.messages[0].parts[0].text).toBe(
    'Original intended content',
  )
  await api(request, endpoint, 'submit', {
    ...submission,
    submissionId: crypto.randomUUID(),
  })
  const inspected = await api(request, endpoint, 'inspect', scope)
  expect(inspected.submissions).toHaveLength(2)
  expect(inspected.deliveries).toHaveLength(4)
})

test('root and reply drafts survive reload and remain isolated', async ({
  page,
}) => {
  await setup(page)
  await page
    .getByRole('textbox', { name: 'Message Ari…' })
    .fill('Durable root draft')
  await saved(page, 'Durable root draft')
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Reply in this thread…' })
    .fill('Durable reply draft')
  await saved(page, 'Durable reply draft')
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Message Ari…' })).toHaveValue(
    'Durable root draft',
  )
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  await expect(
    page.getByRole('textbox', { name: 'Reply in this thread…' }),
  ).toHaveValue('Durable reply draft')
  await page.getByRole('button', { name: 'Close thread' }).click()
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('field-notes')
  await expect(page.getByRole('textbox', { name: 'Message Ari…' })).toHaveValue(
    '',
  )
})

test('lost acknowledgement survives reload, receipt recovery never sends again', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  await page.route(`**${endpoint}/conversations/submit`, async (route) => {
    await route.fetch()
    await route.abort()
  })
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Exactly one accepted action')
  await input.press('Enter')
  await expect(
    page
      .locator('.feed')
      .getByText('Exactly one accepted action', { exact: true }),
  ).toBeVisible()
  await input.fill('New text after send')
  await saved(page, 'New text after send')
  await page.reload()
  await expect(input).toHaveValue('New text after send')
  await expect(page.locator('.pending-submission')).toHaveCount(0)
  const inspected = await api(request, endpoint, 'inspect', scope)
  expect(inspected.submissions).toHaveLength(1)
  expect(inspected.deliveries).toHaveLength(1)
})

test('missing receipt retains uncertainty and explicit retry reuses captured target and ID', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  let block = true
  await page.route(`**${endpoint}/conversations/submit`, (route) =>
    block ? route.abort() : route.continue(),
  )
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Original studio send')
  await input.press('Enter')
  await expect(
    page.getByText('Acceptance not yet confirmed', { exact: false }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByText('Acceptance not yet confirmed', { exact: false }),
  ).toBeVisible()
  expect(
    (await api(request, endpoint, 'inspect', scope)).deliveries,
  ).toHaveLength(0)
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('field-notes')
  await expect(page.locator('.pending-submission')).toHaveCount(0)
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('studio')
  block = false
  await page
    .getByRole('button', { name: 'Check and retry original send' })
    .click()
  await expect(page.locator('.pending-submission')).toHaveCount(0)
  const inspected = await api(request, endpoint, 'inspect', scope)
  expect(inspected.submissions).toHaveLength(1)
  expect(inspected.submissions[0].target.context.organizationId).toBe('studio')
})

test('late acknowledgement from one tab cannot resurrect settlement in another', async ({
  page,
  context,
  request,
}) => {
  const endpoint = await setup(page)
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**${endpoint}/conversations/submit`, async (route) => {
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Shared receipt')
  await input.press('Enter')
  await expect(
    page.locator('.feed').getByText('Shared receipt', { exact: true }),
  ).toBeVisible()
  await input.fill('Keep newer draft')
  await saved(page, 'Keep newer draft')
  const other = await context.newPage()
  await other.goto(page.url())
  await expect(other.locator('.pending-submission')).toHaveCount(0)
  release()
  await expect(input).toHaveValue('Keep newer draft')
  await expect(page.locator('.pending-submission')).toHaveCount(0)
  expect(
    (await api(request, endpoint, 'inspect', scope)).submissions,
  ).toHaveLength(1)
})

test('safe markdown, ordered unknown parts and stream finalization retain message identity', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const initial = await api(request, endpoint, 'snapshot', {
    ...scope,
    threadId: null,
  })
  const thread = initial.threads.find(
    (t: { title: string }) => t.title === 'Launch plan',
  )
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  const message = {
    id: crypto.randomUUID(),
    threadId: thread.id,
    authorId: 'ari',
    createdAt: new Date().toISOString(),
    revision: 1,
    status: 'draft',
    parts: [{ type: 'text', text: 'Fixture fragment' }],
  }
  const updated = {
    ...thread,
    messageIds: [...thread.messageIds, message.id],
    revision: thread.revision + 1,
    replyCount: thread.replyCount + 1,
  }
  await api(request, endpoint, 'emit', {
    ...scope,
    messages: [message],
    threads: [updated],
  })
  const pane = page.getByRole('region', {
    name: 'Thread: Launch plan',
    exact: true,
  })
  await expect(pane.getByText('Fixture fragment', { exact: true })).toHaveCount(
    1,
  )
  const final = {
    ...message,
    revision: 2,
    status: 'final',
    parts: [
      {
        type: 'text',
        text: '**Final fixture output**\n\n- one\n- two\n\n```js\n<script>alert(1)</script>\n```\n\n[Safe](https://example.com) [Unsafe](javascript:alert(1))',
      },
      { type: 'future-widget' },
      { type: 'text', text: 'After unknown part' },
    ],
  }
  await api(request, endpoint, 'emit', {
    ...scope,
    messages: [final],
    threads: [updated],
  })
  await expect(
    pane.getByText('Final fixture output', { exact: true }),
  ).toHaveCount(1)
  await expect(pane.getByText('Fixture fragment', { exact: true })).toHaveCount(
    0,
  )
  await expect(
    pane.getByText('Unsupported content: future-widget'),
  ).toBeVisible()
  await expect(pane.locator('a[href^="javascript:"]')).toHaveCount(0)
  await expect(pane.getByRole('link', { name: 'Safe' })).toHaveAttribute(
    'href',
    'https://example.com',
  )
  await api(request, endpoint, 'emit', {
    ...scope,
    messages: [message],
    threads: [thread],
  })
  await expect(
    pane.getByText('Final fixture output', { exact: true }),
  ).toHaveCount(1)
  await expect(pane.getByText('Fixture fragment', { exact: true })).toHaveCount(
    0,
  )
})

test('bounded older root history preserves visible anchor and deterministic order', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const destination = await target(request, endpoint)
  for (let n = 0; n < 25; n++)
    await api(request, endpoint, 'submit', {
      submissionId: crypto.randomUUID(),
      target: destination,
      parts: [
        { type: 'text', text: `History root ${String(n).padStart(2, '0')}` },
      ],
    })
  await page.reload()
  await expect(page.getByText('History root 24', { exact: true })).toHaveCount(
    1,
  )
  await expect(page.getByText('History root 00', { exact: true })).toHaveCount(
    0,
  )
  const anchor = page.getByText('History root 05', { exact: true })
  await anchor.scrollIntoViewIfNeeded()
  const before = (await anchor.boundingBox())!.y
  await page.getByRole('button', { name: 'Show earlier messages' }).click()
  await expect(page.getByText('History root 00', { exact: true })).toHaveCount(
    1,
  )
  const after = (await anchor.boundingBox())!.y
  expect(Math.abs(after - before)).toBeLessThan(70)
})

test('delayed restoration cannot replace fresh typing and slow writes keep the latest edit', async ({
  page,
}) => {
  await setup(page)
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Older saved value')
  await saved(page, 'Older saved value')
  await page.goto(`${page.url()}&draft=slow-read`)
  await input.fill('Typed while restoring')
  await page.getByRole('button', { name: 'Release draft reads' }).click()
  await expect(input).toHaveValue('Typed while restoring')
  await saved(page, 'Typed while restoring')
  await page.getByRole('button', { name: 'Hold draft writes' }).click()
  await input.fill('First slow edit')
  await input.fill('Newest slow edit')
  await page.getByRole('button', { name: 'Release draft writes' }).click()
  await saved(page, 'Newest slow edit')
  await page.reload()
  await page.getByRole('button', { name: 'Release draft reads' }).click()
  await expect(input).toHaveValue('Newest slow edit')
})

test('cross-tab draft conflict preserves editor text and conditionally resolves', async ({
  page,
  context,
}) => {
  await setup(page)
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Shared baseline')
  await saved(page, 'Shared baseline')
  const other = await context.newPage()
  await other.goto(page.url())
  const second = other.getByRole('textbox', { name: 'Message Ari…' })
  await expect(second).toHaveValue('Shared baseline')
  await other.getByRole('button', { name: 'Hold draft writes' }).click()
  await second.fill('Keep this local editor')
  await input.fill('Saved from first tab')
  await saved(page, 'Saved from first tab')
  await other.getByRole('button', { name: 'Release draft writes' }).click()
  await expect(
    other.getByText(
      'This draft changed in another tab. Your text is preserved.',
    ),
  ).toBeVisible()
  await expect(second).toHaveValue('Keep this local editor')
  await other.getByRole('button', { name: 'Keep my text' }).click()
  await saved(other, 'Keep this local editor')
  await expect(input).toHaveValue('Keep this local editor')
})

test('draft failure and reservation failure preserve text and prevent dispatch', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  await page.goto(`${page.url()}&draft=fail-write`)
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Keep when storage fails')
  await expect(
    page.getByText('Draft is not saved on this device.'),
  ).toBeVisible()
  await input.press('Enter')
  await expect(input).toHaveValue('Keep when storage fails')
  expect(
    (await api(request, endpoint, 'inspect', scope)).deliveries,
  ).toHaveLength(0)
  await page.getByRole('button', { name: 'Allow draft storage' }).click()
  await page.getByRole('button', { name: 'Retry saving' }).click()
  await saved(page, 'Keep when storage fails')
  await page.goto(page.url().replace('draft=fail-write', 'draft=fail-reserve'))
  await expect(input).toHaveValue('Keep when storage fails')
  await input.press('Enter')
  await expect(
    page.getByText('Message could not be saved. Your input is retained.'),
  ).toBeVisible()
  await expect(input).toHaveValue('Keep when storage fails')
  expect(
    (await api(request, endpoint, 'inspect', scope)).deliveries,
  ).toHaveLength(0)
})

test('newly enrolled agent resolves a usable empty chat through management fixture', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const created = await request.post(`${endpoint}/commands`, {
    data: {
      ...scope,
      commandId: crypto.randomUUID(),
      operation: {
        type: 'agent.create',
        fields: { name: 'New chat partner', description: 'Newly enrolled' },
      },
    },
  })
  const { resourceId } = await created.json()
  await request.post(`${endpoint}/commands`, {
    data: {
      ...scope,
      commandId: crypto.randomUUID(),
      operation: {
        type: 'membership.add',
        organizationId: 'studio',
        agentId: resourceId,
      },
    },
  })
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await page
    .getByRole('button', { name: 'New chat partner', exact: true })
    .click()
  const input = page.getByRole('textbox', { name: 'Message New chat partner…' })
  await expect(input).toBeVisible()
  await expect(page.getByText('A little space to think.')).toBeVisible()
  await input.fill('Hello new partner')
  await input.press('Enter')
  await expect(
    page.locator('.feed').getByText('Hello new partner', { exact: true }),
  ).toBeVisible()
  const inspected = await api(request, endpoint, 'inspect', scope)
  expect(inspected.submissions).toHaveLength(1)
})

test('snapshot cursor replays a concurrent event without a gap and background scope survives navigation', async ({
  page,
  request,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  let release = () => {}
  let captured = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const ready = new Promise<void>((resolve) => {
    captured = resolve
  })
  let first = true
  await page.route(`**${endpoint}/conversations/snapshot`, async (route) => {
    if (first && route.request().postDataJSON().threadId === null) {
      first = false
      const response = await route.fetch()
      captured()
      await held
      return route.fulfill({ response })
    }
    return route.continue()
  })
  await page.goto(`/tests/connection.html?fixture=1&endpoint=${endpoint}`)
  await ready
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toBeVisible()
  const destination = await target(request, endpoint)
  await api(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: destination,
    parts: [{ type: 'text', text: 'Between snapshot and subscription' }],
  })
  release()
  await expect(
    page
      .locator('.feed')
      .getByText('Between snapshot and subscription', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('field-notes')
  await api(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: destination,
    parts: [{ type: 'text', text: 'Background organization update' }],
  })
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('studio')
  await expect(
    page
      .locator('.feed')
      .getByText('Background organization update', { exact: true }),
  ).toBeVisible()
  expect(
    (await api(request, endpoint, 'inspect', scope)).deliveries,
  ).toHaveLength(2)
})

test('expired replay cursor takes a fresh snapshot and reconnect never dispatches work', async ({
  page,
  request,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  let streams = 0
  let snapshots = 0
  page.on('request', (req) => {
    if (req.url().endsWith('/snapshot')) snapshots++
  })
  await page.route(`**${endpoint}/conversations/events?**`, (route) => {
    streams++
    if (streams === 1)
      return route.fulfill({ contentType: 'text/event-stream', body: '\n' })
    if (streams === 2)
      return route.fulfill({ status: 409, json: { code: 'cursor-expired' } })
    return route.continue()
  })
  await page.goto(`/tests/connection.html?fixture=1&endpoint=${endpoint}`)
  await expect.poll(() => snapshots).toBeGreaterThanOrEqual(2)
  await expect.poll(() => streams).toBeGreaterThanOrEqual(3)
  const destination = await target(request, endpoint)
  await api(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: destination,
    parts: [{ type: 'text', text: 'After cursor reset' }],
  })
  await expect(
    page.locator('.feed').getByText('After cursor reset', { exact: true }),
  ).toBeVisible()
  expect(
    (await api(request, endpoint, 'inspect', scope)).deliveries,
  ).toHaveLength(1)
})

test('thread switch fences a late snapshot and replaces the detailed subscription', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let captured = false
  await page.route(`**${endpoint}/conversations/snapshot`, async (route) => {
    if (route.request().postDataJSON().threadId === 'launch-plan') {
      const response = await route.fetch()
      captured = true
      await held
      return route.fulfill({ response }).catch(() => {})
    }
    return route.continue()
  })
  const initial = await api(request, endpoint, 'snapshot', {
    ...scope,
    threadId: null,
  })
  const first = initial.threads.find(
    (t: { title: string }) => t.title === 'Launch plan',
  )
  // Use the discovered opaque ID, never assume a title encodes routing.
  await page.unroute(`**${endpoint}/conversations/snapshot`)
  await page.route(`**${endpoint}/conversations/snapshot`, async (route) => {
    if (route.request().postDataJSON().threadId === first.id) {
      const response = await route.fetch()
      captured = true
      await held
      return route.fulfill({ response }).catch(() => {})
    }
    return route.continue()
  })
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  await expect.poll(() => captured).toBe(true)
  const alternate = initial.threads.find(
    (t: { id: string; chatId: string }) =>
      t.id !== first.id && t.chatId === first.chatId,
  )
  await page
    .getByRole('button', {
      name: `Open thread: ${alternate.title}`,
      exact: true,
    })
    .click()
  await expect(
    page.getByRole('region', {
      name: `Thread: ${alternate.title}`,
      exact: true,
    }),
  ).toBeVisible()
  release()
  await expect(
    page.getByRole('region', { name: 'Thread: Launch plan', exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('region', {
      name: `Thread: ${alternate.title}`,
      exact: true,
    }),
  ).toBeVisible()
})

test('intentional identical sends get new identities and independent roots', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  for (let n = 0; n < 2; n++) {
    await input.fill('Intentional duplicate')
    await input.press('Enter')
    await expect(input).toHaveValue('')
    await expect(
      page.locator('.feed').getByText('Intentional duplicate', { exact: true }),
    ).toHaveCount(n + 1)
  }
  const inspected = await api(request, endpoint, 'inspect', scope)
  expect(
    new Set(
      inspected.submissions.map(
        (s: { submissionId: string }) => s.submissionId,
      ),
    ).size,
  ).toBe(2)
  expect(
    new Set(inspected.receipts.map((r: { threadId: string }) => r.threadId))
      .size,
  ).toBe(2)
})

test('authoritative rejection is retained distinctly and never retried as uncertain', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  await request.post(`${endpoint}/commands`, {
    data: {
      ...scope,
      commandId: crypto.randomUUID(),
      operation: {
        type: 'membership.remove',
        organizationId: 'studio',
        membershipId: 'membership-studio-ari',
      },
    },
  })
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Rejected membership send')
  await input.press('Enter')
  await expect(
    page.getByText('New thread · Not accepted', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Check and retry original send' }),
  ).toHaveCount(0)
  const inspected = await api(request, endpoint, 'inspect', scope)
  expect(inspected.submissions).toHaveLength(0)
  expect(inspected.receipts[0].status).toBe('rejected')
})

test('connection changes isolate drafts and pending sends with identical installation IDs', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  await page.route(`**${endpoint}/conversations/submit`, (route) =>
    route.abort(),
  )
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Uncertain at original destination')
  await input.press('Enter')
  await expect(page.locator('.pending-submission')).toHaveCount(1)
  await input.fill('Original destination draft')
  await saved(page, 'Original destination draft')
  await page.getByRole('button', { name: 'Connect B', exact: true }).click()
  await expect(input).toHaveValue('')
  await expect(page.locator('.pending-submission')).toHaveCount(0)
  await page.goto(`/tests/connection.html?fixture=1&endpoint=${endpoint}`)
  await expect(input).toHaveValue('Original destination draft')
  await expect(page.locator('.pending-submission')).toHaveCount(1)
  expect(
    (await api(request, endpoint, 'inspect', scope)).deliveries,
  ).toHaveLength(0)
})

test('new root content does not move a reader away from older messages', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const destination = await target(request, endpoint)
  for (let n = 0; n < 8; n++)
    await api(request, endpoint, 'submit', {
      submissionId: crypto.randomUUID(),
      target: destination,
      parts: [
        {
          type: 'text',
          text: `Reading history ${n}\n\n${'A paragraph to read. '.repeat(12)}`,
        },
      ],
    })
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toBeVisible()
  const scroll = page.locator('.conversation-scroll')
  await scroll.evaluate((el) => {
    el.scrollTop = 180
    el.dispatchEvent(new Event('scroll'))
  })
  const before = await scroll.evaluate((el) => el.scrollTop)
  await api(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: destination,
    parts: [{ type: 'text', text: 'New while reading old' }],
  })
  await expect(
    page.getByRole('button', { name: 'Back to latest messages' }),
  ).toBeVisible()
  expect(
    Math.abs((await scroll.evaluate((el) => el.scrollTop)) - before),
  ).toBeLessThan(10)
  await page.getByRole('button', { name: 'Back to latest messages' }).click()
  await expect(
    page.getByText('New while reading old', { exact: true }),
  ).toBeInViewport()
})

test('history failure renders retry and recovers without duplicate roots', async ({
  page,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  let fail = true
  await page.route(`**${endpoint}/conversations/history`, (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: { message: 'History temporarily unavailable' },
        })
      : route.continue(),
  )
  await page.goto(`/tests/connection.html?fixture=1&endpoint=${endpoint}`)
  await expect(
    page.getByText('History unavailable.', { exact: true }),
  ).toBeVisible()
  fail = false
  await page.getByRole('button', { name: 'Retry history' }).click()
  await expect(
    page.getByText('History unavailable.', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toHaveCount(1)
})

test('caller changes resolve distinct direct chats and isolate saved drafts and receipts', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const originalTarget = await target(request, endpoint)
  const submission = {
    submissionId: crypto.randomUUID(),
    target: originalTarget,
    parts: [{ type: 'text', text: 'Original human history' }],
  }
  await api(request, endpoint, 'submit', submission)
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Original human draft')
  await saved(page, 'Original human draft')
  await api(request, endpoint, 'set-caller', {
    ...scope,
    nextCaller: 'human-second',
  })
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(input).toHaveValue('')
  await expect(
    page.locator('.feed').getByText('Original human history', { exact: true }),
  ).toHaveCount(0)
  const secondScope = { ...scope, callerId: 'human-second' }
  const secondChat = await api(request, endpoint, 'resolve', {
    ...secondScope,
    agentId: 'ari',
    context: originalTarget.context,
  })
  expect(secondChat.id).not.toBe(originalTarget.chatId)
  expect(
    (
      await api(request, endpoint, 'receipt', {
        ...secondScope,
        submissionId: submission.submissionId,
      })
    ).status,
  ).toBe('unknown')
  await api(request, endpoint, 'set-caller', {
    ...secondScope,
    nextCaller: 'human-owner',
  })
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(input).toHaveValue('Original human draft')
  await expect(
    page.locator('.feed').getByText('Original human history', { exact: true }),
  ).toBeVisible()
})

test('thread history pages retain ordered replies without duplicate roots', async ({
  page,
  request,
}) => {
  const endpoint = await setup(page)
  const destination = await target(request, endpoint)
  const snapshot = await api(request, endpoint, 'snapshot', {
    ...scope,
    threadId: null,
  })
  const thread = snapshot.threads.find(
    (t: { title: string }) => t.title === 'Launch plan',
  )
  for (let n = 0; n < 24; n++)
    await api(request, endpoint, 'submit', {
      submissionId: crypto.randomUUID(),
      target: { ...destination, threadId: thread.id },
      parts: [
        { type: 'text', text: `Older reply ${String(n).padStart(2, '0')}` },
      ],
    })
  await page.reload()
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  const pane = page.getByRole('region', {
    name: 'Thread: Launch plan',
    exact: true,
  })
  await expect(
    pane.locator('.thread-reply').getByText('Older reply 23', { exact: true }),
  ).toHaveCount(1)
  await expect(
    pane.locator('.thread-reply').getByText('Older reply 00', { exact: true }),
  ).toHaveCount(0)
  await pane.getByRole('button', { name: 'Show earlier messages' }).click()
  await expect(
    pane.locator('.thread-reply').getByText('Older reply 00', { exact: true }),
  ).toHaveCount(1)
  const text = await pane
    .locator('.thread-reply .message-text')
    .allTextContents()
  expect(text.filter((t) => t.startsWith('Older reply'))).toEqual(
    Array.from(
      { length: 24 },
      (_, n) => `Older reply ${String(n).padStart(2, '0')}`,
    ),
  )
})

test('malformed stream response re-snapshots and recovers without applying invalid content', async ({
  page,
  request,
}) => {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  let first = true
  let snapshots = 0
  page.on('request', (req) => {
    if (req.url().endsWith('/snapshot')) snapshots++
  })
  await page.route(`**${endpoint}/conversations/events?**`, (route) => {
    if (first) {
      first = false
      return route.fulfill({
        contentType: 'text/event-stream',
        body: 'data: {"broken":\n\n',
      })
    }
    return route.continue()
  })
  await page.goto(`/tests/connection.html?fixture=1&endpoint=${endpoint}`)
  await expect.poll(() => snapshots).toBeGreaterThanOrEqual(2)
  const destination = await target(request, endpoint)
  await api(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: destination,
    parts: [{ type: 'text', text: 'Recovered after malformed event' }],
  })
  await expect(
    page
      .locator('.feed')
      .getByText('Recovered after malformed event', { exact: true }),
  ).toBeVisible()
})
