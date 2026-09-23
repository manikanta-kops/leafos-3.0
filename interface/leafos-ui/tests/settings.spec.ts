import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test'
import { mergeRecords } from '../src/data/merge-records.ts'
import { emptyRecords } from '../src/data/conversations.ts'
import { sendExistingNotification } from '../src/platform/notification-service.ts'
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
async function setup(page: Page, request: APIRequestContext, query = '') {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.goto(
    `/tests/connection.html?fixture=1&endpoint=${endpoint}${query}`,
  )
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByLabel('Execution adapter', { exact: true }),
  ).toHaveValue('fixture:codex')
  return {
    endpoint,
    read: () => api(request, endpoint, 'settings/read'),
    save: (
      kind: string,
      id: string,
      patch: unknown,
      operationId = crypto.randomUUID(),
    ) =>
      api(request, endpoint, 'settings/command', {
        operationId,
        target: scope,
        action: 'settings',
        resource: { kind, id },
        patch,
      }),
  }
}

test('organization edit sends only intentional fields and retains opaque options', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('Use concise answers.')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.getByText(
      'Settings saved. New simulated executions use these values.',
    ),
  ).toBeVisible()
  const state = await api(request, s.endpoint, 'settings/inspect')
  expect(state.deliveries[0].patch).toEqual({
    instructions: { set: 'Use concise answers.' },
  })
  expect(
    state.settings.find((r: any) => r.id === 'organization:studio').options,
  ).toEqual({ preserved: 'fixture-option' })
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByLabel('Organization instructions', { exact: true }),
  ).toHaveValue('Use concise answers.')
})

test('global overrides span organizations and each explicit clear reveals local defaults', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  await s.save('organization', 'field-notes', {
    adapter: { set: 'fixture:alternate' },
    model: { set: 'fixture:careful' },
    effort: { set: 'deliberate' },
  })
  await s.save('agent', 'ari', {
    adapter: { set: 'fixture:codex' },
    model: { set: 'fixture:balanced' },
    effort: { set: 'high' },
  })
  let rows = (await s.read()).effective.filter((e: any) => e.agentId === 'ari')
  expect(rows.length).toBeGreaterThan(1)
  expect(rows.every((e: any) => e.values.effort === 'high')).toBe(true)
  for (const field of ['adapter', 'model', 'effort']) {
    await s.save('agent', 'ari', { [field]: { clear: true } })
    rows = (await s.read()).effective.filter((e: any) => e.agentId === 'ari')
    expect(rows.every((e: any) => e.sources[field] === 'organization')).toBe(
      true,
    )
  }
  const record = (await s.read()).settings.find(
    (r: any) => r.id === 'agent:ari',
  )
  expect(record.values).toEqual({})
  expect(record.options.preserved).toBe('fixture-agent-option')
})

test('root administrator never inherits selected organization and incompatible inheritance is explicit', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  await s.save('organization', 'studio', {
    adapter: { set: 'fixture:alternate' },
  })
  let data = await s.read()
  expect(
    data.effective.find(
      (e: any) => e.agentId === 'ari' && e.organizationId === 'studio',
    ).reasons,
  ).toContain('Saved model is incompatible with this adapter or missing.')
  const root = data.settings.find(
    (r: any) => r.target.kind === 'installation-agent',
  )
  await s.save('installation-agent', root.target.id, {
    adapter: { clear: true },
  })
  data = await s.read()
  const effective = data.effective.find(
    (e: any) => e.agentId === root.target.id && e.organizationId === null,
  )
  expect(effective.values.adapter).toBeUndefined()
  expect(effective.reasons).toContain('Choose an execution adapter.')
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByText('Explicit installation configuration', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Organization', exact: true }),
  ).toHaveCount(0)
})

test('catalog refresh keeps dirty input and missing saved selections without fallback', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('Retain this draft')
  await api(request, s.endpoint, 'settings/catalog-test', {
    ...scope,
    catalog: {
      revision: 2,
      refreshedAt: new Date().toISOString(),
      stale: true,
      adapters: [],
    },
  })
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await expect(
    page.getByLabel('Execution adapter', { exact: true }),
  ).toHaveValue('fixture:codex')
  await expect(
    page.getByLabel('Organization instructions', { exact: true }),
  ).toHaveValue('Retain this draft')
  await expect(
    page.getByText('Catalog is stale. Check availability before saving.'),
  ).toBeVisible()
  await expect(
    page.getByText('Saved adapter is missing from the catalog.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByLabel('Organization instructions', { exact: true }),
  ).toHaveValue('Retain this draft')
})

test('latest backend save wins supplied fields and older projections cannot regress', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  const old = await s.save('organization', 'studio', {
    effort: { set: 'high' },
  })
  const latest = await s.save('organization', 'studio', {
    effort: { set: 'low' },
    instructions: { set: 'latest' },
  })
  const merged = mergeRecords(
    mergeRecords(emptyRecords(), latest.records),
    old.records,
  )
  expect(
    merged.settings?.find((r) => r.id === 'organization:studio')?.values.effort,
  ).toBe('low')
  expect(
    merged.effective?.find(
      (e) => e.agentId === 'ari' && e.organizationId === 'studio',
    )?.instructions,
  ).toBe('latest')
  const reuse = await s.save(
    'organization',
    'studio',
    { effort: { set: 'high' } },
    latest.operationId,
  )
  expect(reuse.records).toEqual(latest.records)
})

test('lost save acknowledgement reconciles read-only after reload', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  await page.route('**/settings/command', async (route) => {
    await route.fetch()
    await route.abort('failed')
  })
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('Accepted once')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await api(request, s.endpoint, 'settings/inspect')).deliveries.length,
    )
    .toBe(1)
  await page.reload()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByText(
      'Settings saved. New simulated executions use these values.',
    ),
  ).toBeVisible()
  expect(
    (await api(request, s.endpoint, 'settings/inspect')).deliveries,
  ).toHaveLength(1)
})

test('uncertain save retains immutable retry and dirty input through close', async ({
  page,
  request,
}) => {
  await setup(page, request)
  const sent: any[] = []
  await page.route('**/settings/command', async (route) => {
    sent.push(route.request().postDataJSON())
    if (sent.length === 1) await route.abort('failed')
    else await route.continue()
  })
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('Original intent')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.getByText('Save uncertain.', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByLabel('Organization instructions', { exact: true }),
  ).toHaveValue('Original intent')
  await page.getByRole('button', { name: 'Retry original save' }).click()
  await expect(
    page.getByText(
      'Settings saved. New simulated executions use these values.',
    ),
  ).toBeVisible()
  expect(sent).toHaveLength(2)
  expect(sent[1]).toEqual(sent[0])
})

test('next retry uses current simulated settings while previous attempt is immutable', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  const snapshot = await api(request, s.endpoint, 'snapshot', {
    ...scope,
    threadId: null,
  })
  const thread = snapshot.threads.find((t: any) => t.title === 'Launch plan')
  let work = await api(request, s.endpoint, 'work/inspect')
  const before = structuredClone(work.work.attempts[0])
  const workflow = work.work.workflows[0]
  await api(request, s.endpoint, 'work/scenario', {
    ...scope,
    threadId: thread.id,
    scenario: 'fail',
  })
  await s.save('organization', 'studio', {
    instructions: { set: 'New execution instructions' },
    effort: { set: 'high' },
  })
  await api(request, s.endpoint, 'work/command', {
    operationId: crypto.randomUUID(),
    target: workflow.target,
    action: 'retry',
    runId: workflow.runId,
    attemptId: workflow.attemptId,
  })
  work = await api(request, s.endpoint, 'work/inspect')
  const current = work.work.attempts.at(-1)
  expect(current.suppliedSettings.instructions).toBe(
    'New execution instructions',
  )
  expect(current.suppliedSettings.values.effort).toBe('high')
  expect(
    work.work.attempts.find((a: any) => a.id === before.id).suppliedSettings,
  ).toEqual(before.suppliedSettings)
})

test('background notification driver never prompts and reports unavailable permission or errors honestly', async () => {
  let prompts = 0
  let sends = 0
  const driver = {
    isPermissionGranted: async () => false,
    requestPermission: async () => {
      prompts++
      return 'granted'
    },
    sendNotification: () => {
      sends++
    },
  }
  expect(
    await sendExistingNotification(driver, {
      title: 'Test',
      body: 'Synthetic',
    }),
  ).toEqual({ status: 'denied' })
  expect(prompts).toBe(0)
  expect(sends).toBe(0)
  driver.isPermissionGranted = async () => true
  expect(
    await sendExistingNotification(driver, {
      title: 'Test',
      body: 'Synthetic',
    }),
  ).toEqual({ status: 'requested' })
  expect(prompts).toBe(0)
  expect(sends).toBe(1)
  driver.sendNotification = () => {
    throw new Error('Suppressed transport')
  }
  expect(
    await sendExistingNotification(driver, {
      title: 'Test',
      body: 'Synthetic',
    }),
  ).toEqual({ status: 'failed' })
})

test('no-effort model retains incompatible default until deliberate organization effort clear', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  await page.getByLabel('Model', { exact: true }).selectOption('fixture:quick')
  await expect(page.getByLabel('Effort', { exact: true })).toHaveValue('low')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.getByText('Saved effort is not supported by this model.'),
  ).toBeVisible()
  await page.getByLabel('Effort', { exact: true }).selectOption('')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.getByText('Saved effort is not supported by this model.'),
  ).toHaveCount(0)
  const data = await s.read()
  expect(
    data.settings.find((r: any) => r.id === 'organization:studio').values
      .effort,
  ).toBeUndefined()
  expect(
    data.effective.find(
      (e: any) => e.agentId === 'ari' && e.organizationId === 'studio',
    ).values.effort,
  ).toBeUndefined()
  const operations = (await api(request, s.endpoint, 'settings/inspect'))
    .deliveries
  expect(operations[1].patch).toEqual({ effort: { clear: true } })
})

test('global override selectors use inherited catalog and explicit clear returns inheritance', async ({
  page,
  request,
}) => {
  await setup(page, request)
  await page.getByRole('button', { name: 'Global agent', exact: true }).click()
  await page.getByLabel('Model', { exact: true }).selectOption('fixture:quick')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.getByText('Saved effort is not supported by this model.'),
  ).toBeVisible()
  await page.getByLabel('Model', { exact: true }).selectOption('')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(
    page.getByText('Saved effort is not supported by this model.'),
  ).toHaveCount(0)
})

for (const failure of ['fail-read', 'fail-reserve'])
  test(`settings ${failure} preserves input and prevents dispatch`, async ({
    page,
    request,
  }) => {
    const s = await setup(page, request, `&control-storage=${failure}`)
    await page
      .getByLabel('Organization instructions', { exact: true })
      .fill('Do not lose this input')
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await expect(
      page.getByLabel('Organization instructions', { exact: true }),
    ).toHaveValue('Do not lose this input')
    expect(
      (await api(request, s.endpoint, 'settings/inspect')).deliveries,
    ).toHaveLength(0)
    await expect(page.getByRole('alert').first()).toBeVisible()
  })

test('catalog failure and refresh retain dirty fields and recovery', async ({
  page,
  request,
}) => {
  await setup(page, request)
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('Keep while refreshing')
  await page.route('**/settings/catalog', (route) => route.abort('failed'))
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await expect(
    page.getByText('Catalog unavailable. Saved selections are retained.'),
  ).toBeVisible()
  await page.unroute('**/settings/catalog')
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await expect(page.getByText('2 adapters in catalog')).toBeVisible()
  await expect(
    page.getByLabel('Organization instructions', { exact: true }),
  ).toHaveValue('Keep while refreshing')
})

test('late save acknowledgement cannot overwrite another client newer canonical fields', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  let release!: () => void
  const wait = new Promise<void>((r) => (release = r))
  await page.route('**/settings/command', async (route) => {
    const response = await route.fetch()
    await wait
    await route.fulfill({ response })
  })
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('First save')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await api(request, s.endpoint, 'settings/inspect')).deliveries.length,
    )
    .toBe(1)
  await s.save('organization', 'studio', {
    instructions: { set: 'Newer save from another client' },
  })
  release()
  await expect(
    page.getByLabel('Organization instructions', { exact: true }),
  ).toHaveValue('Newer save from another client')
})

test('dirty settings survive organization changes without retargeting', async ({
  page,
  request,
}) => {
  await setup(page, request)
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('Studio draft only')
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page
    .getByLabel('Organization', { exact: true })
    .selectOption('field-notes')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByLabel('Organization instructions', { exact: true }),
  ).not.toHaveValue('Studio draft only')
  await page.getByRole('button', { name: 'Close settings' }).click()
  await page.getByLabel('Organization', { exact: true }).selectOption('studio')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(
    page.getByLabel('Organization instructions', { exact: true }),
  ).toHaveValue('Studio draft only')
})

test('explicit retry waits behind receipt lookup and never replays another tab settlement', async ({
  page,
  context,
  request,
}) => {
  await setup(page, request)
  let commands = 0
  await page.route('**/settings/command', async (route) => {
    commands++
    await route.abort('failed')
  })
  let release!: () => void
  const wait = new Promise<void>((r) => (release = r))
  let reading = false
  await page.route('**/settings/receipt', async (route) => {
    reading = true
    const id = route.request().postDataJSON().operationId
    await wait
    await route.fulfill({ json: { operationId: id, status: 'unknown' } })
  })
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('Cross tab exact intent')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => reading).toBe(true)
  await page.getByRole('button', { name: 'Retry original save' }).click()
  const other = await context.newPage()
  await other.goto(page.url())
  await other.getByRole('button', { name: 'Settings', exact: true }).click()
  await other.getByRole('button', { name: 'Retry original save' }).click()
  await expect(
    other.getByText(
      'Settings saved. New simulated executions use these values.',
    ),
  ).toBeVisible()
  release()
  await expect(
    page.getByText(
      'Settings saved. New simulated executions use these values.',
    ),
  ).toBeVisible()
  expect(commands).toBe(1)
})

test('explicit retry is not lost while unknown receipt read is in flight', async ({
  page,
  request,
}) => {
  await setup(page, request)
  let commands = 0
  let release!: () => void
  const wait = new Promise<void>((r) => (release = r))
  let reading = false
  await page.route('**/settings/command', async (route) => {
    commands++
    if (commands === 1) await route.abort('failed')
    else await route.continue()
  })
  await page.route('**/settings/receipt', async (route) => {
    reading = true
    const id = route.request().postDataJSON().operationId
    await wait
    await route.fulfill({ json: { operationId: id, status: 'unknown' } })
  })
  await page
    .getByLabel('Organization instructions', { exact: true })
    .fill('Wait then retry')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => reading).toBe(true)
  await page.getByRole('button', { name: 'Retry original save' }).click()
  release()
  await expect(
    page.getByText(
      'Settings saved. New simulated executions use these values.',
    ),
  ).toBeVisible()
  expect(commands).toBe(2)
})

test('queued admission and new continuation read current simulated instructions', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  let work = (await api(request, s.endpoint, 'work/inspect')).work
  const w = work.workflows[0],
    interaction = work.interactions[0]
  await s.save('organization', 'studio', {
    instructions: { set: 'Continuation inputs' },
  })
  await api(request, s.endpoint, 'work/command', {
    operationId: crypto.randomUUID(),
    target: w.target,
    action: 'respond',
    runId: interaction.runId,
    attemptId: interaction.attemptId,
    interactionId: interaction.id,
    interactionVersion: interaction.version,
    answer: { kind: 'dismiss' },
  })
  work = (await api(request, s.endpoint, 'work/inspect')).work
  expect(work.attempts.at(-1).suppliedSettings.instructions).toBe(
    'Continuation inputs',
  )
  await api(request, s.endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: w.target,
    parts: [{ type: 'text', text: 'Queued with no frozen settings' }],
  })
  await s.save('organization', 'studio', {
    instructions: { set: 'Queue admission inputs' },
  })
  await api(request, s.endpoint, 'work/scenario', {
    ...scope,
    threadId: w.target.threadId,
    scenario: 'success',
  })
  work = (await api(request, s.endpoint, 'work/inspect')).work
  expect(work.attempts.at(-1).suppliedSettings.instructions).toBe(
    'Queue admission inputs',
  )
  expect(work.attempts.at(-2).suppliedSettings.instructions).toBe(
    'Continuation inputs',
  )
})

test('unavailable catalog adapter retains canonical selection and reports reason independently of connection', async ({
  page,
  request,
}) => {
  const s = await setup(page, request)
  const catalog = await api(request, s.endpoint, 'settings/catalog')
  catalog.revision++
  catalog.adapters[0].available = false
  catalog.adapters[0].reason = 'Harness not available on the host'
  await api(request, s.endpoint, 'settings/catalog-test', { ...scope, catalog })
  await page.getByRole('button', { name: 'Refresh catalog' }).click()
  await expect(
    page.getByLabel('Execution adapter', { exact: true }),
  ).toHaveValue('fixture:codex')
  await expect(
    page.getByText('Harness not available on the host', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Refresh catalog' }),
  ).toBeEnabled()
})
