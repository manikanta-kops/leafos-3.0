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
async function api(
  request: APIRequestContext,
  endpoint: string,
  path: string,
  data: unknown,
) {
  const r = await request.post(`${endpoint}/conversations/${path}`, { data })
  expect(r.ok()).toBeTruthy()
  return r.json()
}
async function setup(
  page: Page,
  request: APIRequestContext,
  scenario = 'waiting',
  query = '',
) {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.goto(
    `/tests/connection.html?fixture=1&endpoint=${endpoint}${query}`,
  )
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  const chat = await api(request, endpoint, 'resolve', {
    ...scope,
    agentId: 'ari',
    context: { kind: 'organization', organizationId: 'studio' },
  })
  const receipt = await api(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: { ...scope, chatId: chat.id, context: chat.context },
    parts: [{ type: 'text', text: 'Work acceptance scenario' }],
  })
  const target = {
    ...scope,
    chatId: chat.id,
    context: chat.context,
    threadId: receipt.threadId,
  }
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: target.threadId,
    scenario,
  })
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toBeVisible()
  return { endpoint, target, threadId: target.threadId, url: page.url() }
}
async function inspect(request: APIRequestContext, endpoint: string) {
  return api(request, endpoint, 'work/inspect', scope)
}
async function reply(
  request: APIRequestContext,
  endpoint: string,
  target: unknown,
  text: string,
) {
  return api(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target,
    parts: [{ type: 'text', text }],
  })
}

test('question stable choice and free text settle canonically and survive reload', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request)
  await page.getByRole('radio', { name: 'Desktop first' }).check()
  await page
    .getByRole('textbox', { name: 'Your answer or additional detail' })
    .fill('Keep the first release small.')
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(
    page.getByText('Recorded response', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Desktop first — Keep the first release small.',
  )
  const state = await inspect(request, endpoint)
  expect(state.deliveries).toHaveLength(1)
  expect(state.deliveries[0].answer.optionId).toBe('desktop')
  await page.reload()
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Keep the first release small.',
  )
})
test('question dismissal is not stop; approval comment is not approval', async ({
  page,
  request,
}) => {
  const q = await setup(page, request)
  await page.getByRole('button', { name: 'Dismiss question' }).click()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Dismissed without an answer',
  )
  expect(
    (await inspect(request, q.endpoint)).work.workflows.find(
      (w: { target: { threadId: string } }) => w.target.threadId === q.threadId,
    ).state,
  ).toBe('running')
  const a = await setup(page, request, 'approval')
  await page
    .getByRole('textbox', { name: 'Optional comment (not approval)' })
    .fill('Only the recorded proposal.')
  expect((await inspect(request, a.endpoint)).deliveries).toHaveLength(0)
  await page.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Declined — Only the recorded proposal.',
  )
  expect(
    (await inspect(request, a.endpoint)).deliveries[0].proposalId,
  ).toBeTruthy()
})
test('stop waits for settlement, holds new replies, resume does not revive children or approvals', async ({
  page,
  request,
}) => {
  const { endpoint, target, threadId } = await setup(page, request, 'child')
  await reply(request, endpoint, target, 'First accepted follow-up')
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  const work = page.getByRole('region', { name: 'Thread work', exact: true })
  await expect(work).toContainText('Cancellation requested')
  await expect(
    page.getByRole('button', { name: 'Resume follow-ups', exact: true }),
  ).toBeDisabled()
  await expect(page.getByText('Question or approval cancelled')).toBeVisible()
  await reply(request, endpoint, target, 'New held follow-up')
  await expect(
    page.getByRole('region', { name: 'Accepted follow-ups' }),
  ).toContainText('New held follow-up')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'confirm-stop',
  })
  const stopped = await inspect(request, endpoint)
  const stoppedRun = stopped.work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  ).runId
  await page
    .getByRole('button', { name: 'Resume follow-ups', exact: true })
    .click()
  await expect(work).toContainText('Working')
  await expect(work).not.toContainText('Follow-ups held')
  const state = await inspect(request, endpoint)
  expect(state.work.queue.map((q: { state: string }) => q.state)).toEqual([
    'consumed',
    'queued',
  ])
  expect(
    state.work.runs.find((r: { id: string }) => r.id === stoppedRun).state,
  ).toBe('cancelled')
  const running = state.work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  )
  expect(running.runId).not.toBe(stoppedRun)
  expect(running.state).toBe('running')
  expect(state.work.delegations[0].state).toBe('cancelled')
  expect(
    state.work.interactions.find(
      (i: { target: { threadId: string } }) => i.target.threadId === threadId,
    ).state,
  ).toBe('cancelled')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'late-child',
  })
  await expect(work).toContainText('Working')
  await expect(
    page.getByText(
      'Late child result retained as history; parent state is unchanged.',
    ),
  ).toBeVisible()
  const late = await inspect(request, endpoint)
  expect(
    late.work.workflows.find(
      (w: { target: { threadId: string } }) => w.target.threadId === threadId,
    ).runId,
  ).toBe(running.runId)
  expect(
    late.work.runs.find((r: { id: string }) => r.id === stoppedRun).state,
  ).toBe('cancelled')
})
test('backend queue cancellation retains authored content and targeted steering consumes only selected item', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request, 'running')
  await reply(request, endpoint, target, 'First queue item')
  await reply(request, endpoint, target, 'Second queue item')
  const queue = page.getByRole('region', { name: 'Accepted follow-ups' })
  await expect(queue.locator('li')).toHaveCount(2)
  await queue
    .locator('li')
    .filter({ hasText: 'Second queue item' })
    .getByRole('button', { name: 'Cancel queued item' })
    .click()
  await expect(queue.locator('li')).toHaveCount(1)
  await expect(
    page.locator('.thread-reply').filter({ hasText: 'Second queue item' }),
  ).toBeVisible()
  await queue.getByRole('button', { name: 'Steer current attempt' }).click()
  await expect(queue).toBeHidden()
  const state = await inspect(request, endpoint)
  expect(state.work.queue.map((q: { state: string }) => q.state)).toEqual([
    'consumed',
    'cancelled',
  ])
  expect(state.deliveries[0].queueId).not.toBe(state.deliveries[1].queueId)
})
test('unsupported and stale steering keep accepted message queued', async ({
  page,
  request,
}) => {
  const { endpoint, target, threadId } = await setup(page, request, 'running')
  await reply(request, endpoint, target, 'Leave this queued')
  const state = await inspect(request, endpoint),
    work = state.work.workflows.find(
      (w: { target: { threadId: string } }) => w.target.threadId === threadId,
    )
  const result = await api(request, endpoint, 'work/command', {
    operationId: crypto.randomUUID(),
    target,
    action: 'steer',
    runId: work.runId,
    attemptId: 'obsolete-attempt',
    queueId: state.work.queue[0].id,
  })
  expect(result.status).toBe('rejected')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'unsupported-steer',
  })
  await expect(
    page.getByRole('button', { name: 'Steer current attempt' }),
  ).toBeDisabled()
  await expect(
    page.getByText('The adapter does not support steering.'),
  ).toBeVisible()
  expect((await inspect(request, endpoint)).work.queue[0].state).toBe('queued')
})
test('published done text does not hide later failure or complete work', async ({
  page,
  request,
}) => {
  const { endpoint, threadId } = await setup(page, request, 'running')
  const snap = await api(request, endpoint, 'snapshot', { ...scope, threadId })
  const thread = snap.threads[0],
    id = crypto.randomUUID()
  await api(request, endpoint, 'emit', {
    ...scope,
    messages: [
      {
        id,
        threadId,
        authorId: 'ari',
        createdAt: new Date().toISOString(),
        revision: 1,
        status: 'final',
        parts: [{ type: 'text', text: 'Done! The output is ready.' }],
      },
    ],
    threads: [
      {
        ...thread,
        revision: thread.revision + 1,
        messageIds: [...thread.messageIds, id],
      },
    ],
  })
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Working')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'fail',
  })
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Failed')
  await expect(
    page.getByText('Done! The output is ready.', { exact: true }),
  ).toBeVisible()
})
test('child question uses exact saved child identity; accepted answer can need recovery', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request, 'child')
  await expect(page.locator('.interaction-eyebrow')).toContainText('Niko')
  await page
    .getByRole('textbox', { name: 'Your answer or additional detail' })
    .fill('Ask about desktop only')
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(
    page.getByText('Recorded response', { exact: true }),
  ).toBeVisible()
  const state = await inspect(request, endpoint)
  expect(state.deliveries[0].runId).toMatch(/^child:/)
  const second = await setup(page, request, 'recovery-answer')
  await page.getByRole('radio', { name: 'Desktop first' }).check()
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(
    page.getByText(
      'Response saved. Continuation needs recovery; no new work is authorized by this card.',
    ),
  ).toBeVisible()
  expect(
    (await inspect(request, second.endpoint)).work.interactions.find(
      (i: { target: { threadId: string } }) =>
        i.target.threadId === second.threadId,
    ).response.answer.optionId,
  ).toBe('desktop')
})
test('competing tabs display the actual first accepted answer', async ({
  page,
  browser,
  request,
}) => {
  const { endpoint, url } = await setup(page, request)
  const device = await browser.newContext()
  const second = await device.newPage()
  await second.goto(url)
  await second
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await second.getByRole('radio', { name: 'All platforms' }).check()
  let release!: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  await second.route('**/work/command', async (route) => {
    await gate
    await route.continue()
  })
  await second.getByRole('button', { name: 'Send answer', exact: true }).click()
  await page.getByRole('radio', { name: 'Desktop first' }).check()
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Desktop first',
  )
  release()
  await expect(second.locator('.interaction-card blockquote')).toContainText(
    'Desktop first',
  )
  await expect
    .poll(async () => (await inspect(request, endpoint)).deliveries.length)
    .toBe(2)
  const receipts = (await inspect(request, endpoint)).receipts
  expect(receipts[1].response.answer.optionId).toBe('desktop')
  expect(receipts[1].response.operationId).toBe(receipts[0].operationId)
  await device.close()
})
test('lost acknowledgement is read-reconciled after reload without another write', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request, 'approval')
  await page.route('**/work/command', async (route) => {
    await route.fetch()
    await route.abort()
  })
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect
    .poll(async () => (await inspect(request, endpoint)).deliveries.length)
    .toBe(1)
  await page.reload()
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Approved',
  )
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(1)
})
test('unknown receipt remains unresolved; explicit retry reuses immutable ID and payload', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request, 'running')
  let first: unknown
  await page.route('**/work/command', (route) => {
    first = route.request().postDataJSON()
    return route.abort()
  })
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toContainText('Outcome unconfirmed')
  await page.reload()
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeVisible()
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(0)
  await page.unroute('**/work/command')
  await page.getByRole('button', { name: 'Retry same command' }).click()
  await expect
    .poll(async () => (await inspect(request, endpoint)).deliveries.length)
    .toBe(1)
  expect((await inspect(request, endpoint)).deliveries[0]).toEqual(first)
})
test('superseded card cannot authorize new work and disconnected thread stream does not block command', async ({
  page,
  request,
}) => {
  const { endpoint, threadId } = await setup(page, request)
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'supersede',
  })
  await expect(page.getByText('Superseded by a newer request')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Send answer', exact: true }),
  ).toBeHidden()
  const next = await setup(page, request, 'approval')
  await page.route('**/events?*threadId*', (route) => route.abort())
  await page.reload()
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Approved',
  )
  expect((await inspect(request, next.endpoint)).deliveries).toHaveLength(1)
})

test('storage reservation failure preserves answer and prevents dispatch', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(
    page,
    request,
    'waiting',
    '&work-storage=fail-reserve',
  )
  const input = page.getByRole('textbox', {
    name: 'Your answer or additional detail',
  })
  await input.fill('Preserve this exact answer')
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    'Your response could not be saved',
  )
  await expect(input).toHaveValue('Preserve this exact answer')
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(0)
})
test('failure holds existing and new replies; retry safely advances FIFO without Resume', async ({
  page,
  request,
}) => {
  const { endpoint, target, threadId } = await setup(page, request, 'running')
  await reply(request, endpoint, target, 'First held reply')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'fail',
  })
  await reply(request, endpoint, target, 'Second held reply')
  let state = await inspect(request, endpoint)
  expect(state.work.queue.map((q: { state: string }) => q.state)).toEqual([
    'held',
    'held',
  ])
  const before = state.work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  )
  await page.getByRole('button', { name: 'Retry work', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Working')
  state = await inspect(request, endpoint)
  const retry = state.work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  )
  expect(retry.attemptId).not.toBe(before.attemptId)
  expect(retry.runId).toBe(before.runId)
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'success',
    attemptId: retry.attemptId,
  })
  state = await inspect(request, endpoint)
  expect(state.work.queue.map((q: { state: string }) => q.state)).toEqual([
    'consumed',
    'queued',
  ])
  const first = state.work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  )
  expect(first.held).toBe(false)
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'success',
    attemptId: first.attemptId,
  })
  expect(
    (await inspect(request, endpoint)).work.queue.map(
      (q: { state: string }) => q.state,
    ),
  ).toEqual(['consumed', 'consumed'])
  expect(
    (await inspect(request, endpoint)).deliveries.map(
      (d: { action: string }) => d.action,
    ),
  ).toEqual(['retry'])
})
test('retry failure pauses again and later Stop supersedes retry continuation', async ({
  page,
  request,
}) => {
  const { endpoint, target, threadId } = await setup(page, request, 'failed')
  await reply(request, endpoint, target, 'Held during retry')
  await page.getByRole('button', { name: 'Retry work', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Working')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'fail',
  })
  await expect(
    page.getByRole('button', { name: 'Retry work', exact: true }),
  ).toBeEnabled()
  expect((await inspect(request, endpoint)).work.queue[0].state).toBe('held')
  await page.getByRole('button', { name: 'Retry work', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Working')
  const attempt = (await inspect(request, endpoint)).work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  ).attemptId
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Cancellation requested')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'confirm-stop',
  })
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'success',
    attemptId: attempt,
  })
  const state = await inspect(request, endpoint),
    work = state.work.workflows.find(
      (w: { target: { threadId: string } }) => w.target.threadId === threadId,
    )
  expect(work.state).toBe('cancelled')
  expect(work.held).toBe(true)
  expect(work.retryContinuation).toBeUndefined()
  expect(state.work.queue[0].state).toBe('held')
})
test('independent root work and background summaries survive organization navigation', async ({
  page,
  request,
}) => {
  const { endpoint, target, threadId } = await setup(page, request, 'failed')
  const { threadId: omit, ...rootTarget } = target
  void omit
  const fresh = await reply(
    request,
    endpoint,
    rootTarget,
    'Independent new root',
  )
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: fresh.threadId,
    scenario: 'running',
  })
  const state = await inspect(request, endpoint)
  expect(
    state.work.workflows.find(
      (w: { target: { threadId: string } }) => w.target.threadId === threadId,
    ).held,
  ).toBe(true)
  expect(
    state.work.workflows.find(
      (w: { target: { threadId: string } }) =>
        w.target.threadId === fresh.threadId,
    ).held,
  ).toBe(false)
  await page.getByRole('button', { name: 'Close thread' }).click()
  await expect(
    page.locator('.feed-message').filter({ hasText: 'Independent new root' }),
  ).toContainText('Working')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: fresh.threadId,
    scenario: 'fail',
  })
  await expect(
    page.locator('.feed-message').filter({ hasText: 'Independent new root' }),
  ).toContainText('Failed')
})

test('late cross-tab acknowledgement cannot resurrect settled journal evidence', async ({
  page,
  context,
  request,
}) => {
  const { endpoint, url } = await setup(page, request, 'approval')
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let committed = false
  await page.route('**/work/command', async (route) => {
    const response = await route.fetch()
    committed = true
    await held
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect.poll(() => committed).toBe(true)
  const second = await context.newPage()
  await second.goto(url)
  await second
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(second.locator('.interaction-card blockquote')).toContainText(
    'Approved',
  )
  await expect(
    second.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
  release()
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(1)
})
test('unknown steering never falls back to ordinary execution and recovery follows owning layout', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request, 'running')
  await reply(request, endpoint, target, 'Steer this exact queued message')
  await page.route('**/work/command', (route) => route.abort())
  await page.getByRole('button', { name: 'Steer current attempt' }).click()
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Expand thread' }).click()
  await expect(
    page.getByRole('button', { name: 'Retry same command' }),
  ).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('button', { name: 'Retry same command' }),
  ).toBeInViewport()
  expect((await inspect(request, endpoint)).work.queue[0].state).toBe('queued')
  await page.getByRole('button', { name: 'Close thread' }).click()
  await expect(
    page.getByRole('button', { name: 'Open work recovery' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Open work recovery' }).click()
  await expect(
    page.getByRole('button', { name: 'Retry same command' }),
  ).toBeVisible()
})
test('expired cursor resnapshot restores work and pending interaction without replaying commands', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request, 'approval')
  let expired = false
  await page.route('**/conversations/events?*', (route) => {
    if (!expired && route.request().url().includes('threadId')) {
      expired = true
      return route.fulfill({
        status: 409,
        body: JSON.stringify({ code: 'cursor-expired' }),
      })
    }
    return route.continue()
  })
  await page.reload()
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true }),
  ).toBeEnabled()
  await expect.poll(() => expired).toBe(true)
  await expect(
    page.getByText('Live updates disconnected. Reconnecting…'),
  ).toBeHidden()
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(0)
})
test('overlapping streams and stale revisions neither duplicate activity nor regress current work', async ({
  page,
  request,
}) => {
  const { endpoint, threadId } = await setup(page, request, 'running')
  const old = await api(request, endpoint, 'snapshot', { ...scope, threadId })
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'fail',
  })
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Failed')
  await api(request, endpoint, 'emit', {
    ...scope,
    records: { work: old.work },
  })
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Failed')
  await expect(
    page.getByText('Reviewed the launch scope.', { exact: true }),
  ).toHaveCount(1)
})
test('accepted command ID returns original outcome even when later payload changes', async ({
  page,
  request,
}) => {
  const { endpoint, target, threadId } = await setup(page, request, 'running')
  const w = (await inspect(request, endpoint)).work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  )
  const op = {
    operationId: crypto.randomUUID(),
    target,
    runId: w.runId,
    attemptId: w.attemptId,
    action: 'stop',
  }
  const original = await api(request, endpoint, 'work/command', op)
  const reused = await api(request, endpoint, 'work/command', {
    ...op,
    action: 'resume',
  })
  expect(reused).toEqual(original)
  expect(
    (await inspect(request, endpoint)).work.workflows.find(
      (w: { target: { threadId: string } }) => w.target.threadId === threadId,
    ).state,
  ).toBe('cancellation-requested')
})

test('old attempt outcomes cannot replace a newer retry or release its hold', async ({
  page,
  request,
}) => {
  const { endpoint, target, threadId } = await setup(page, request, 'failed')
  await reply(request, endpoint, target, 'Keep exact queue hold')
  const old = (await inspect(request, endpoint)).work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  )
  await page.getByRole('button', { name: 'Retry work', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Working')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'fail',
    attemptId: old.attemptId,
  })
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'success',
    attemptId: old.attemptId,
  })
  const current = (await inspect(request, endpoint)).work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  )
  expect(current.attemptId).not.toBe(old.attemptId)
  expect(current.state).toBe('running')
  expect(current.held).toBe(true)
  expect((await inspect(request, endpoint)).work.queue[0].state).toBe('held')
})
test('application work summaries update while another organization is selected', async ({
  page,
  request,
}) => {
  const { endpoint, threadId } = await setup(page, request, 'running')
  await page.getByRole('button', { name: 'Close thread' }).click()
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('field-notes')
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'fail',
  })
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('studio')
  await expect(
    page
      .locator('.feed-message')
      .filter({ hasText: 'Work acceptance scenario' }),
  ).toContainText('Failed')
})
test('a destination switch fences pending acknowledgement and keeps original recovery scoped', async ({
  page,
  request,
}) => {
  const { endpoint, url } = await setup(page, request, 'running')
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let committed = false
  await page.route('**/work/command', async (route) => {
    const response = await route.fetch()
    committed = true
    await held
    await route.fulfill({ response }).catch(() => {})
  })
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  await expect.poll(() => committed).toBe(true)
  await page.getByRole('button', { name: 'Connect B', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Open thread: Work acceptance scenario' }),
  ).toHaveCount(0)
  release()
  await expect(
    page.getByRole('button', { name: 'Open work recovery' }),
  ).toHaveCount(0)
  await page.goto(url)
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Cancellation requested')
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(1)
})

test('failed journal observation can be restored without remount or unsafe dispatch', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(
    page,
    request,
    'approval',
    '&work-storage=fail-read',
  )
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toContainText('Local work recovery is unavailable')
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(0)
  await page
    .getByRole('button', { name: 'Allow work storage', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Retry loading work recovery' })
    .click()
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Approved',
  )
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(1)
})

test('late command receipt cannot regress newer settlement or move the history scroll', async ({
  page,
  request,
}) => {
  const { endpoint, threadId } = await setup(page, request, 'running')
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let committed = false
  await page.route('**/work/command', async (route) => {
    const response = await route.fetch()
    committed = true
    await held
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  await expect.poll(() => committed).toBe(true)
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId,
    scenario: 'confirm-stop',
  })
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Stopped')
  await page.locator('.thread-scroll').evaluate((e) => {
    e.scrollTop = 0
  })
  release()
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Stopped')
  expect(
    await page.locator('.thread-scroll').evaluate((e) => e.scrollTop),
  ).toBe(0)
})
test('same agent work remains distinct across organization contexts', async ({
  page,
  request,
}) => {
  const { endpoint, threadId } = await setup(page, request, 'waiting')
  const chat = await api(request, endpoint, 'resolve', {
    ...scope,
    agentId: 'ari',
    context: { kind: 'organization', organizationId: 'field-notes' },
  })
  const other = await reply(
    request,
    endpoint,
    { ...scope, chatId: chat.id, context: chat.context },
    'Field Notes independent work',
  )
  await api(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: other.threadId,
    scenario: 'waiting',
  })
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('field-notes')
  await page
    .getByRole('button', { name: 'Open thread: Field Notes independent work' })
    .click()
  await page.getByRole('radio', { name: 'All platforms' }).check()
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(
    page.getByText('Recorded response', { exact: true }),
  ).toBeVisible()
  const state = await inspect(request, endpoint)
  expect(state.deliveries[0].target.context.organizationId).toBe('field-notes')
  expect(
    state.work.interactions.find(
      (i: { target: { threadId: string } }) => i.target.threadId === threadId,
    ).state,
  ).toBe('pending')
})
test('caller change fences old command acknowledgement and restores original scoped evidence', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request, 'running')
  let release!: () => void
  const held = new Promise<void>((r) => (release = r))
  let committed = false
  await page.route('**/work/command', async (route) => {
    const response = await route.fetch()
    committed = true
    await held
    await route.fulfill({ response }).catch(() => {})
  })
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  await expect.poll(() => committed).toBe(true)
  await api(request, endpoint, 'set-caller', {
    ...scope,
    nextCaller: 'another-human',
  })
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(
    page.getByRole('button', { name: 'Open thread: Work acceptance scenario' }),
  ).toHaveCount(0)
  release()
  await expect(
    page.getByRole('button', { name: 'Open work recovery' }),
  ).toHaveCount(0)
  await api(request, endpoint, 'set-caller', {
    ...scope,
    callerId: 'another-human',
    nextCaller: scope.callerId,
  })
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Cancellation requested')
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(1)
})

test('review: reordered receipt target keys still settle accepted work', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request, 'waiting')
  for (const path of ['command', 'receipt']) {
    await page.route(`**/work/${path}`, async (route) => {
      const response = await route.fetch()
      const body = await response.json()
      if (body.target) {
        const t = body.target
        body.target = {
          threadId: t.threadId,
          context: {
            organizationId: t.context.organizationId,
            kind: t.context.kind,
          },
          chatId: t.chatId,
          callerId: t.callerId,
          installationId: t.installationId,
        }
      }
      await route.fulfill({ response, json: body })
    })
  }
  await page.getByRole('radio', { name: 'Desktop first' }).check()
  await page.getByRole('button', { name: 'Send answer', exact: true }).click()
  await expect(page.locator('.interaction-card blockquote')).toContainText(
    'Desktop first',
  )
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
  await expect(
    page.getByRole('button', { name: 'Stop work', exact: true }),
  ).toBeEnabled()
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(1)
})

test('review: explicit retry waits for in-flight automatic receipt lookup', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request, 'running')
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let lookupStarted = false
  await page.route('**/work/receipt', async (route) => {
    lookupStarted = true
    await gate
    await route.continue()
  })
  await page.route('**/work/command', (route) => route.abort())
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toContainText('Outcome unconfirmed')
  await expect.poll(() => lookupStarted).toBe(true)
  await page.unroute('**/work/command')
  await page
    .getByRole('button', { name: 'Retry same command', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Retry same command', exact: true })
    .click()
  release()
  await expect
    .poll(async () => (await inspect(request, endpoint)).deliveries.length)
    .toBe(1)
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toBeHidden()
})

for (const field of [
  'installationId',
  'callerId',
  'chatId',
  'threadId',
  'context-kind',
  'context-id',
]) {
  test(`changed receipt ${field} cannot settle original command`, async ({
    page,
    request,
  }) => {
    const { endpoint } = await setup(page, request, 'running')
    for (const path of ['command', 'receipt'])
      await page.route(`**/work/${path}`, async (route) => {
        const response = await route.fetch()
        const body = await response.json()
        if (body.target) {
          if (field === 'context-kind')
            body.target.context = {
              kind: 'installation',
              installationId: scope.installationId,
            }
          else if (field === 'context-id')
            body.target.context.organizationId = 'different-organization'
          else body.target[field] = 'different-resource'
        }
        await route.fulfill({ response, json: body })
      })
    await page.getByRole('button', { name: 'Stop work', exact: true }).click()
    await expect(
      page.getByRole('region', { name: 'Work command recovery' }),
    ).toContainText('Outcome unconfirmed')
    await expect(
      page.getByRole('button', { name: 'Retry same command', exact: true }),
    ).toBeEnabled()
    expect((await inspect(request, endpoint)).deliveries).toHaveLength(1)
    await page.unroute('**/work/receipt')
    await page.getByRole('button', { name: 'Check command outcome' }).click()
    await expect(
      page.getByRole('region', { name: 'Work command recovery' }),
    ).toBeHidden()
  })
}
for (const outcome of ['accepted', 'rejected']) {
  test(`pending explicit retries coalesce and do not write after receipt is ${outcome}`, async ({
    page,
    request,
  }) => {
    const { endpoint } = await setup(page, request, 'running')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    let lookup = false
    await page.route('**/work/receipt', async (route) => {
      lookup = true
      await gate
      await route.continue()
    })
    await page.route('**/work/command', async (route) => {
      await route.fetch(
        outcome === 'rejected'
          ? {
              postData: {
                ...route.request().postDataJSON(),
                attemptId: 'obsolete-attempt',
              },
            }
          : {},
      )
      await route.abort()
    })
    await page.getByRole('button', { name: 'Stop work', exact: true }).click()
    await expect.poll(() => lookup).toBe(true)
    await page.unroute('**/work/command')
    await page
      .getByRole('button', { name: 'Retry same command', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Retry same command', exact: true })
      .click()
    release()
    if (outcome === 'accepted')
      await expect(
        page.getByRole('region', { name: 'Work command recovery' }),
      ).toBeHidden()
    else
      await expect(
        page.getByRole('region', { name: 'Work command recovery' }),
      ).toContainText('Not accepted')
    expect((await inspect(request, endpoint)).deliveries).toHaveLength(1)
  })
}
test('reordered command target keys reach the same fixture workflow', async ({
  page,
  request,
}) => {
  const { endpoint, target, threadId } = await setup(page, request, 'running')
  const work = (await inspect(request, endpoint)).work.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === threadId,
  )
  const receipt = await api(request, endpoint, 'work/command', {
    operationId: crypto.randomUUID(),
    action: 'stop',
    runId: work.runId,
    attemptId: work.attemptId,
    target: {
      threadId: target.threadId,
      context: {
        organizationId: target.context.organizationId,
        kind: target.context.kind,
      },
      chatId: target.chatId,
      callerId: target.callerId,
      installationId: target.installationId,
    },
  })
  expect(receipt.status).toBe('accepted')
  await expect(
    page.getByRole('region', { name: 'Thread work', exact: true }),
  ).toContainText('Cancellation requested')
})

test('destination change abandons explicit retry waiting on an automatic receipt read', async ({
  page,
  request,
}) => {
  const { endpoint, url } = await setup(page, request, 'running')
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  let lookup = false
  await page.route('**/work/receipt', async (route) => {
    lookup = true
    await gate
    await route.continue().catch(() => {})
  })
  await page.route('**/work/command', (route) => route.abort())
  await page.getByRole('button', { name: 'Stop work', exact: true }).click()
  await expect.poll(() => lookup).toBe(true)
  await page.unroute('**/work/command')
  await page
    .getByRole('button', { name: 'Retry same command', exact: true })
    .click()
  await page.getByRole('button', { name: 'Connect B', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Open thread: Work acceptance scenario' }),
  ).toHaveCount(0)
  release()
  await page.unroute('**/work/receipt')
  await page.goto(url)
  await page
    .getByRole('button', { name: 'Open thread: Work acceptance scenario' })
    .click()
  await expect(
    page.getByRole('region', { name: 'Work command recovery' }),
  ).toContainText('Outcome unconfirmed')
  expect((await inspect(request, endpoint)).deliveries).toHaveLength(0)
})
