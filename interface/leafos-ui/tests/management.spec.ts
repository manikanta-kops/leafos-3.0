import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page) {
  const endpoint =
    '/__fixtures/workspace-' + crypto.randomUUID().replaceAll('-', '')
  await page.goto('/tests/connection.html?fixture=1&endpoint=' + endpoint)
  await expect(
    page.getByRole('heading', { name: 'Ari', exact: true }),
  ).toBeVisible()
  return endpoint
}
async function manage(page: Page, section = 'Organization') {
  await page
    .getByRole('button', { name: 'Manage workspace', exact: true })
    .click()
  await page.getByRole('button', { name: section, exact: true }).click()
  return page.getByRole('dialog')
}
async function close(page: Page) {
  await page.getByRole('button', { name: 'Close management' }).click()
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
}
const read = async (page: Page, endpoint: string) =>
  (await page.request.get(endpoint)).json()
async function persistedSelection(
  page: Page,
  endpoint: string,
  expected: { agentId?: string; organizationId?: string },
) {
  await expect
    .poll(() =>
      page.evaluate(
        async ({ endpoint, expected }) => {
          const request = indexedDB.open('leafos-client')
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          const scope = JSON.stringify([
            JSON.stringify([
              'workspace-v1',
              new URL(endpoint, location.href).href,
              true,
            ]),
            'preview-installation',
            'human-owner',
          ])
          const get = db
            .transaction('navigation')
            .objectStore('navigation')
            .get(scope)
          const saved = await new Promise<
            { value: Record<string, unknown> } | undefined
          >((resolve) => {
            get.onsuccess = () => resolve(get.result)
          })
          db.close()
          return Object.entries(expected).every(
            ([key, value]) => saved?.value[key] === value,
          )
        },
        { endpoint, expected },
      ),
    )
    .toBe(true)
}

test('organization create and partial edit survive read-after-write and reload', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await manage(page)
  await page
    .getByRole('button', { name: 'Create organization', exact: true })
    .click()
  await page.getByLabel('Name', { exact: true }).fill('Quiet Lab')
  await page.getByLabel('Description').fill('A place to explore')
  await page.getByLabel('Instructions').fill('Keep observations grounded.')
  await save(page)
  await expect(
    page.getByText('Organization saved.', { exact: true }),
  ).toBeVisible()
  const created = (await read(page, endpoint)).organizations.find(
    (o: { name: string }) => o.name === 'Quiet Lab',
  )
  expect(created.instructions).toBe('Keep observations grounded.')
  await close(page)
  await page
    .getByRole('combobox', { name: 'Organization', exact: true })
    .selectOption(created.id)
  await persistedSelection(page, endpoint, { organizationId: created.id })
  await page.reload()
  await manage(page)
  await expect(
    page.getByText('Keep observations grounded.', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Edit organization' }).click()
  await page.getByLabel('Description').fill('Updated purpose')
  let payload: { operation: { fields: unknown } } | undefined
  page.on('request', (req) => {
    if (req.method() === 'POST') payload = req.postDataJSON()
  })
  await save(page)
  await expect(
    page.getByText('Organization saved.', { exact: true }),
  ).toBeVisible()
  expect(payload?.operation.fields).toEqual({ description: 'Updated purpose' })
  await page.reload()
  await manage(page)
  await expect(page.getByText('Updated purpose', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Keep observations grounded.', { exact: true }),
  ).toBeVisible()
})

test('global catalog includes unassigned duplicate names and memberships deduplicate', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await manage(page, 'Agents')
  await expect(
    page.getByText('No organization memberships', { exact: true }).last(),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Add Ari (unassigned-ari)', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Add Ari (unassigned-ari)', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByText('Membership saved.', { exact: true }),
  ).toBeVisible()
  const data = await read(page, endpoint)
  expect(
    data.memberships.filter(
      (m: { actorId: string; organizationId: string }) =>
        m.actorId === 'unassigned-ari' && m.organizationId === 'studio',
    ),
  ).toHaveLength(1)
  await close(page)
  await page
    .getByRole('button', { name: 'Ari (unassigned-ari)', exact: true })
    .click()
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  await expect(page.getByText('A little space to think.')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toHaveCount(0)
  await persistedSelection(page, endpoint, { agentId: 'unassigned-ari' })
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Ari (unassigned-ari)', exact: true }),
  ).toHaveAttribute('aria-current', 'page')
})

test('create and add recovers failed membership after reload using one global identity', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await manage(page, 'Agents')
  await page.getByRole('button', { name: 'Create new agent' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Juniper')
  await save(page)
  await expect(
    page.getByText('Finish enrollment', { exact: true }),
  ).toBeVisible()
  const before = await read(page, endpoint)
  const agent = Object.values(before.actorsById).find(
    (a) => (a as { name: string }).name === 'Juniper',
  ) as { id: string }
  expect(agent.id).toBeTruthy()
  await page.route('**' + endpoint + '/commands', (route) =>
    route.fulfill({
      status: 400,
      json: {
        outcome: 'rejected',
        code: 'fixture-rejection',
        message: 'Membership could not be added.',
      },
    }),
  )
  await page.getByRole('button', { name: 'Add created agent' }).click()
  await expect(
    page.getByText('Request rejected', { exact: true }),
  ).toBeVisible()
  await page.reload()
  await manage(page, 'Agents')
  await expect(
    page.getByText('Global agent: ' + agent.id, { exact: true }),
  ).toBeVisible()
  await page.unroute('**' + endpoint + '/commands')
  await page
    .getByRole('button', { name: 'Keep agent and retry membership' })
    .click()
  await page.getByRole('button', { name: 'Add created agent' }).click()
  await expect(
    page.getByRole('region', { name: 'Request recovery' }),
  ).toHaveCount(0)
  const after = await read(page, endpoint)
  expect(
    Object.values(after.actorsById).filter(
      (a) => (a as { name: string }).name === 'Juniper',
    ),
  ).toHaveLength(1)
  expect(
    after.memberships.some((m: { actorId: string }) => m.actorId === agent.id),
  ).toBe(true)
})

test('uncertain create survives reload and receipt lookup never replays or duplicates it', async ({
  page,
}) => {
  const endpoint = await setup(page)
  let posts = 0
  await page.route('**' + endpoint + '/commands', async (route) => {
    posts++
    await route.fetch()
    await route.abort('failed')
  })
  await manage(page, 'Agents')
  await page.getByRole('button', { name: 'Create new agent' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Uncertain agent')
  await page.getByLabel('Then add to Leaf Studio').uncheck()
  await save(page)
  await expect(
    page.getByText('Outcome unresolved', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Uncertain agent',
  )
  await page.reload()
  await manage(page)
  await page.getByRole('button', { name: 'Check outcome' }).click()
  await expect(
    page.getByRole('region', { name: 'Request recovery' }),
  ).toHaveCount(0)
  expect(posts).toBe(1)
  expect(
    Object.values((await read(page, endpoint)).actorsById).filter(
      (a) => (a as { name: string }).name === 'Uncertain agent',
    ),
  ).toHaveLength(1)
})

test('missing receipt remains unresolved and prevents a new create', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await page.route('**' + endpoint + '/commands', (route) =>
    route.abort('failed'),
  )
  await manage(page)
  await page
    .getByRole('button', { name: 'Create organization', exact: true })
    .click()
  await page.getByLabel('Name', { exact: true }).fill('Unknown org')
  await save(page)
  await expect(
    page.getByText('Outcome unresolved', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Check outcome' }).click()
  await expect(
    page.getByText('No receipt is available.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await page.reload()
  await manage(page)
  await expect(
    page.getByText('Outcome unresolved', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Create organization', exact: true }),
  ).toBeDisabled()
})

test('rejected edit keeps input and pending command retains its original organization', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await manage(page)
  await page.getByRole('button', { name: 'Edit organization' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Captured target')
  await page.route('**' + endpoint + '/commands', (route) =>
    route.fulfill({
      status: 400,
      json: {
        outcome: 'rejected',
        code: 'validation',
        message: 'Try a different name.',
      },
    }),
  )
  await save(page)
  await expect(
    page.getByText('Request rejected', { exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Captured target',
  )
  await page.getByRole('button', { name: 'Return to editing' }).click()
  await page.unroute('**' + endpoint + '/commands')
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**' + endpoint + '/commands', async (route) => {
    await held
    await route.continue()
  })
  await save(page)
  await expect(
    page.getByText('Waiting for acknowledgement…', { exact: true }),
  ).toBeVisible()
  await close(page)
  await page
    .getByRole('combobox', { name: 'Organization', exact: true })
    .selectOption('field-notes')
  release()
  await expect
    .poll(async () => (await read(page, endpoint)).organizations[0].name)
    .toBe('Captured target')
  await expect(
    page.getByRole('combobox', { name: 'Organization', exact: true }),
  ).toHaveValue('field-notes')
  expect((await read(page, endpoint)).organizations[1].name).toBe('Field Notes')
})

test('membership removal preserves global identity, other membership and contributions', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await manage(page, 'Agents')
  await page
    .getByRole('button', { name: 'Remove membership', exact: true })
    .first()
    .click()
  await expect(
    page.getByText('Already accepted work may finish;', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Confirm remove membership' }).click()
  await expect(
    page.getByText('Remove membership saved.', { exact: true }),
  ).toBeVisible()
  await close(page)
  await expect(
    page.getByRole('heading', { name: 'Mira', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toHaveCount(0)
  const state = await read(page, endpoint)
  expect(state.actorsById.ari).toBeTruthy()
  expect(
    state.memberships.some(
      (m: { actorId: string; organizationId: string }) =>
        m.actorId === 'ari' && m.organizationId === 'field-notes',
    ),
  ).toBe(true)
  await manage(page, 'Agents')
  await page.getByRole('button', { name: 'Add Ari (ari)', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Add Ari (ari)', exact: true }),
  ).toBeDisabled()
  await close(page)
  await page.getByRole('button', { name: 'Ari', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toBeVisible()
})

test('visual groups create rename order appearances and delete only grouping', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await manage(page, 'Visual groups')
  await page.getByRole('button', { name: 'Create group', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill('Favorites')
  await save(page)
  await page
    .getByRole('combobox', { name: 'Add appearance to Favorites' })
    .selectOption('membership-studio-ari')
  await expect(
    page.getByText('Appearance saved.', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('combobox', { name: 'Add appearance to Favorites' })
    .selectOption('membership-studio-mira')
  await expect(
    page.getByRole('button', { name: 'Move Mira up in Favorites' }),
  ).toBeEnabled()
  await page.getByRole('button', { name: 'Move Mira up in Favorites' }).focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Move Mira up in Favorites' }),
  ).toBeDisabled()
  await page
    .getByRole('button', { name: 'Move Favorites up', exact: true })
    .click()
  await expect(
    page.getByText('Group order saved.', { exact: true }),
  ).toBeVisible()
  const favorite = page.getByRole('region', { name: 'Manage Favorites' })
  await favorite.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByLabel('Group name').fill('Priority')
  await page.getByRole('button', { name: 'Save name' }).click()
  await expect(
    page.getByRole('region', { name: 'Manage Priority' }),
  ).toBeVisible()
  await close(page)
  await page
    .getByRole('region', { name: 'Priority', exact: true })
    .getByRole('button', { name: 'Ari', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toBeVisible()
  await page.reload()
  await manage(page, 'Visual groups')
  await page
    .getByRole('region', { name: 'Manage Priority' })
    .getByRole('button', { name: 'Remove appearance' })
    .first()
    .click()
  await expect(
    page.getByText('Appearance removal saved.', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('region', { name: 'Manage Engineering' })
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await page.getByRole('button', { name: 'Confirm delete group' }).click()
  await expect(
    page.getByRole('region', { name: 'Manage Engineering' }),
  ).toHaveCount(0)
  await close(page)
  await expect(
    page
      .getByRole('region', { name: 'Ungrouped', exact: true })
      .getByRole('button', { name: 'Niko', exact: true }),
  ).toBeVisible()
  expect(
    (await read(page, endpoint)).memberships.some(
      (m: { actorId: string }) => m.actorId === 'niko',
    ),
  ).toBe(true)
})

test('management dialog traps focus, Escape returns it, narrow dark and reduced motion fit', async ({
  page,
}, info) => {
  await setup(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await manage(page, 'Agents')
  await page.getByRole('button', { name: 'Create new agent' }).click()
  await expect(page.getByLabel('Name', { exact: true })).toBeFocused()
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab')
    expect(
      await page.evaluate(() => !!document.activeElement?.closest('dialog')),
    ).toBe(true)
  }
  expect(
    await page
      .getByRole('dialog')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('management-narrow-dark.png') })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Manage workspace', exact: true }),
  ).toBeFocused()
})

test('journal write failure prevents dispatch and keeps input while navigation works', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'leafos-management')
        throw new Error('Storage full')
      return put.apply(this, args)
    }
  })
  const endpoint = await setup(page)
  let posts = 0
  page.on('request', (req) => {
    if (req.url().endsWith(endpoint + '/commands')) posts++
  })
  await manage(page)
  await page
    .getByRole('button', { name: 'Create organization', exact: true })
    .click()
  await page.getByLabel('Name', { exact: true }).fill('Retained input')
  await save(page)
  await expect(
    page.getByText('Could not save recovery information.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(
    'Retained input',
  )
  expect(posts).toBe(0)
  await close(page)
  await page
    .getByRole('combobox', { name: 'Organization', exact: true })
    .selectOption('field-notes')
  await expect(
    page.getByRole('combobox', { name: 'Organization', exact: true }),
  ).toHaveValue('field-notes')
})

test('late acknowledgement fetches current state and cannot regress another client save', async ({
  page,
}) => {
  const endpoint = await setup(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let accepted!: () => void
  const acceptance = new Promise<void>((resolve) => {
    accepted = resolve
  })
  await page.route('**' + endpoint + '/commands', async (route) => {
    const response = await route.fetch()
    accepted()
    await held
    await route.fulfill({ response })
  })
  await manage(page)
  await page.getByRole('button', { name: 'Edit organization' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Earlier save')
  await save(page)
  await acceptance
  await expect(
    page.getByRole('button', { name: 'Saving…', exact: true }),
  ).toBeDisabled()
  const response = await page.request.post(endpoint + '/commands', {
    data: {
      commandId: crypto.randomUUID(),
      installationId: 'preview-installation',
      callerId: 'human-owner',
      operation: {
        type: 'organization.update',
        organizationId: 'studio',
        fields: { name: 'Latest save' },
      },
    },
  })
  expect(response.ok()).toBe(true)
  release()
  await expect(
    page.getByRole('heading', { name: 'Latest save', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Earlier save', exact: true }),
  ).toHaveCount(0)
})

test('connection switch isolates pending writes and journal is recoverable on return', async ({
  page,
}) => {
  const endpoint = await setup(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**' + endpoint + '/commands', async (route) => {
    await route.fetch()
    await held
    await route.abort('failed')
  })
  await manage(page)
  await page
    .getByRole('button', { name: 'Create organization', exact: true })
    .click()
  await page.getByLabel('Name', { exact: true }).fill('Connection A only')
  await save(page)
  await expect(
    page.getByText('Waiting for acknowledgement…', { exact: true }),
  ).toBeVisible()
  await close(page)
  const initial = await read(page, endpoint)
  await page.route('**/__fixtures/b', (route) =>
    route.fulfill({
      json: {
        ...initial,
        installationId: 'installation-b',
        organizations: [{ id: 'b', name: 'Connection B' }],
        memberships: [],
        groups: [],
        groupAssignments: [],
      },
    }),
  )
  await page.getByRole('button', { name: 'Connect B', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: 'Organization', exact: true }),
  ).toHaveValue('b')
  release()
  await manage(page)
  await expect(
    page.getByRole('region', { name: 'Request recovery' }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Connection B', exact: true }),
  ).toBeVisible()
  await page.goto('/tests/connection.html?fixture=1&endpoint=' + endpoint)
  await manage(page)
  await expect(
    page.getByText('Outcome unresolved', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Check outcome' }).click()
  await expect(
    page.getByRole('region', { name: 'Request recovery' }),
  ).toHaveCount(0)
  await close(page)
  await expect(
    page.getByRole('option', { name: 'Connection A only' }),
  ).toHaveCount(1)
})

test('caller change hides old recovery and returning caller recovers the original request', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await page.route('**' + endpoint + '/commands', async (route) => {
    await route.fetch()
    await route.abort('failed')
  })
  await manage(page)
  await page
    .getByRole('button', { name: 'Create organization', exact: true })
    .click()
  await page.getByLabel('Name', { exact: true }).fill('Owner request')
  await save(page)
  await expect(
    page.getByText('Outcome unresolved', { exact: true }),
  ).toBeVisible()
  const changed = await read(page, endpoint)
  changed.currentHumanId = 'another-human'
  changed.actorsById['another-human'] = {
    id: 'another-human',
    kind: 'human',
    name: 'Second human',
  }
  await page.route('**' + endpoint, (route) => route.fulfill({ json: changed }))
  await close(page)
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await manage(page)
  await expect(
    page.getByRole('region', { name: 'Request recovery' }),
  ).toHaveCount(0)
  await page.unroute('**' + endpoint)
  await page.reload()
  await manage(page)
  await expect(
    page.getByText('Outcome unresolved', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Check outcome' }).click()
  await expect(
    page.getByRole('region', { name: 'Request recovery' }),
  ).toHaveCount(0)
})

test('failed ordering preserves canonical order and retries only after definite rejection', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await page.route('**' + endpoint + '/commands', (route) =>
    route.fulfill({
      status: 400,
      json: {
        outcome: 'rejected',
        code: 'test-rejection',
        message: 'Ordering could not be saved.',
      },
    }),
  )
  await manage(page, 'Visual groups')
  await page
    .getByRole('button', { name: 'Move Product down', exact: true })
    .click()
  await expect(
    page.getByText('Ordering could not be saved.', { exact: true }),
  ).toBeVisible()
  expect(
    (await read(page, endpoint)).groups
      .filter((g: { organizationId: string }) => g.organizationId === 'studio')
      .map((g: { name: string }) => g.name),
  ).toEqual(['Product', 'Engineering'])
  await page.getByRole('button', { name: 'Return to editing' }).click()
  await page.unroute('**' + endpoint + '/commands')
  await page
    .getByRole('button', { name: 'Move Product down', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Move Product down', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByText('Group order saved.', { exact: true }),
  ).toBeVisible()
  expect(
    (await read(page, endpoint)).groups
      .filter((g: { organizationId: string }) => g.organizationId === 'studio')
      .map((g: { name: string }) => g.name),
  ).toEqual(['Engineering', 'Product'])
})

test('global discovery loading error retry and empty search remain usable', async ({
  page,
}, info) => {
  const endpoint = await setup(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**' + endpoint + '/agents?*', async (route) => {
    await held
    await route.fulfill({ status: 503, json: { message: 'Unavailable' } })
  })
  await manage(page, 'Agents')
  await expect(page.getByText('Loading global agents…')).toBeVisible()
  await page.screenshot({ path: info.outputPath('catalog-loading-light.png') })
  release()
  await expect(
    page.getByText('Global agent discovery is unavailable.', { exact: false }),
  ).toBeVisible()
  await page.screenshot({ path: info.outputPath('catalog-error-light.png') })
  await page.unroute('**' + endpoint + '/agents?*')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Add Ari (unassigned-ari)', exact: true }),
  ).toBeVisible()
  await page.getByLabel('Find a global agent').fill('No such identity')
  await expect(page.getByText('No agents match this search.')).toBeVisible()
  await page.screenshot({ path: info.outputPath('catalog-empty-light.png') })
})

test('another tab cannot overwrite an unresolved create journal', async ({
  page,
  context,
}) => {
  const endpoint = await setup(page)
  const other = await context.newPage()
  await other.goto('/tests/connection.html?fixture=1&endpoint=' + endpoint)
  await manage(page)
  await manage(other)
  for (const current of [page, other]) {
    await current
      .getByRole('button', { name: 'Create organization', exact: true })
      .click()
    await current
      .getByLabel('Name', { exact: true })
      .fill(current === page ? 'First request' : 'Second request')
  }
  await page.route('**' + endpoint + '/commands', async (route) => {
    await route.fetch()
    await route.abort('failed')
  })
  await save(page)
  await expect(
    page.getByText('Outcome unresolved', { exact: true }),
  ).toBeVisible()
  let posts = 0
  other.on('request', (req) => {
    if (req.method() === 'POST') posts++
  })
  await save(other)
  await expect(
    other.getByText('This recovery step changed in another tab.', {
      exact: false,
    }),
  ).toBeVisible()
  expect(posts).toBe(0)
  await other.reload()
  await manage(other)
  await other.getByRole('button', { name: 'Check outcome' }).click()
  await expect(
    other.getByText('Organization saved.', { exact: true }),
  ).toBeVisible()
  const data = await read(other, endpoint)
  expect(
    data.organizations.some(
      (o: { name: string }) => o.name === 'First request',
    ),
  ).toBe(true)
  expect(
    data.organizations.some(
      (o: { name: string }) => o.name === 'Second request',
    ),
  ).toBe(false)
})

test('root admin membership appearance retains organization context separately from installation shortcut', async ({
  page,
}) => {
  await setup(page)
  await manage(page, 'Agents')
  await page
    .getByRole('button', { name: 'Add Admin (admin)', exact: true })
    .click()
  await expect(
    page.getByText('Membership saved.', { exact: true }),
  ).toBeVisible()
  await close(page)
  await page
    .getByRole('region', { name: 'Ungrouped', exact: true })
    .getByRole('button', { name: 'Admin', exact: true })
    .click()
  await expect(
    page.getByRole('textbox', { name: 'Message Admin…' }),
  ).toBeVisible()
  await page
    .getByRole('textbox', { name: 'Message Admin…' })
    .fill('Organization admin conversation')
  await page.getByRole('textbox', { name: 'Message Admin…' }).press('Enter')
  await expect(
    page
      .locator('.feed')
      .getByText('Organization admin conversation', { exact: true }),
  ).toBeVisible()
  await page
    .locator('.installation-agents')
    .getByRole('button', { name: 'Admin', exact: true })
    .click()
  await expect(
    page
      .locator('.feed')
      .getByText('Organization admin conversation', { exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('textbox', { name: 'Message Admin…' }),
  ).toBeVisible()
})
