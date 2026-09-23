import { test, expect, type Page } from '@playwright/test'
import { createPreviewData } from '../src/demo/fixtures.ts'

const endpoint = '**/__fixtures/workspace'
function workspace() {
  const {
    installationId,
    currentHumanId,
    actorsById,
    agentRoles,
    organizations,
    memberships,
    groups,
    groupAssignments,
  } = createPreviewData()
  return {
    installationId,
    currentHumanId,
    actorsById,
    agentRoles,
    organizations,
    memberships,
    groups,
    groupAssignments,
  }
}
async function selectOrganization(page: Page, id: string) {
  await page.getByRole('combobox', { name: 'Organization' }).selectOption(id)
}

async function expectPersisted(
  page: Page,
  expected: Record<string, unknown>,
  endpointPath = '/__fixtures/workspace',
) {
  await expect
    .poll(() =>
      page.evaluate(
        async ({ expected, endpointPath }) => {
          const scope = JSON.stringify([
            JSON.stringify([
              'workspace-v1',
              new URL(endpointPath, location.href).href,
              true,
            ]),
            'preview-installation',
            'human-owner',
          ])
          return new Promise<boolean>((resolve, reject) => {
            const opening = indexedDB.open('leafos-client')
            opening.onerror = () => reject(opening.error)
            opening.onsuccess = () => {
              const db = opening.result
              if (!db.objectStoreNames.contains('navigation')) {
                db.close()
                resolve(false)
                return
              }
              const transaction = db.transaction('navigation')
              const request = transaction.objectStore('navigation').get(scope)
              request.onsuccess = () =>
                resolve(
                  !!request.result &&
                    Object.entries(expected).every(
                      ([key, value]) =>
                        JSON.stringify(request.result.value[key]) ===
                        JSON.stringify(value),
                    ),
                )
              request.onerror = () => reject(request.error)
              transaction.oncomplete = () => db.close()
            }
          })
        },
        { expected, endpointPath },
      ),
    )
    .toBe(true)
}

test('organization, agent, sidebar and group preferences restore alongside accepted history', async ({
  page,
}) => {
  await page.goto('/')
  await selectOrganization(page, 'field-notes')
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Message Mira…' })
    .fill('Session only')
  await page.getByRole('textbox', { name: 'Message Mira…' }).press('Enter')
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible()
  await expectPersisted(page, {
    organizationId: 'field-notes',
    agentId: 'mira',
    collapsed: true,
    closedGroups: ['research'],
  })
  await page.reload()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('field-notes')
  await expect(
    page.getByRole('heading', { name: 'Mira', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible()
  // Step 3 replaces session-only text: accepted fixture history survives a frontend reload.
  await expect(page.getByText('Session only', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(
    page.getByRole('button', { name: 'Research', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false')
})

test('empty organizations and removed memberships cannot display the previous conversation', async ({
  page,
}) => {
  const data = workspace()
  data.organizations.push({ id: 'empty', name: 'Empty workspace' })
  await page.route(endpoint, (route) => route.fulfill({ json: data }))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Ari', exact: true }),
  ).toBeVisible()
  await selectOrganization(page, 'empty')
  await expect(
    page.getByRole('heading', { name: 'No agents in this organization' }),
  ).toBeVisible()
  await expect(
    page.getByText('Your morning brief is ready.', { exact: false }),
  ).toHaveCount(0)
  await expectPersisted(page, { organizationId: 'empty' })
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'No agents in this organization' }),
  ).toBeVisible()
  await selectOrganization(page, 'studio')
  data.memberships = data.memberships.filter((m) => m.actorId !== 'ari')
  data.groupAssignments = data.groupAssignments.filter(
    (a) => !a.membershipId.endsWith('-ari'),
  )
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(
    page.getByRole('heading', { name: 'Mira', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toHaveCount(0)
})

test('group appearances share a chat and root-admin targeting survives organization changes', async ({
  page,
}) => {
  await page.goto('/')
  await selectOrganization(page, 'field-notes')
  await page
    .getByRole('region', { name: 'Research', exact: true })
    .getByRole('button', { name: 'Ari', exact: true })
    .click()
  await page
    .getByRole('textbox', { name: 'Message Ari…' })
    .fill('Shared appearance')
  await page.getByRole('textbox', { name: 'Message Ari…' }).press('Enter')
  await page
    .getByRole('region', { name: 'Favorites', exact: true })
    .getByRole('button', { name: 'Ari', exact: true })
    .click()
  await expect(
    page.getByText('Shared appearance', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Message Admin…' })
    .fill('Installation conversation')
  await page.getByRole('textbox', { name: 'Message Admin…' }).press('Enter')
  await page
    .getByRole('button', {
      name: 'Open thread: Installation conversation',
      exact: true,
    })
    .click()
  await selectOrganization(page, 'studio')
  await expect(
    page.getByRole('region', {
      name: 'Thread: Installation conversation',
      exact: true,
    }),
  ).toBeVisible()
  await expectPersisted(page, { agentId: 'admin', target: 'installation' })
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Admin', exact: true }),
  ).toBeVisible()
})

test('loading, malformed data, retry, unavailable cache and recovery are explicit', async ({
  page,
}) => {
  let release: () => void = () => {}
  const delay = new Promise<void>((resolve) => {
    release = resolve
  })
  let mode = 'loading'
  await page.route(endpoint, async (route) => {
    if (mode === 'loading') await delay
    if (mode === 'bad')
      return route.fulfill({ json: { installationId: 'broken' } })
    if (mode === 'error') return route.fulfill({ status: 503 })
    return route.fulfill({ json: workspace() })
  })
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Opening your workspace…' }),
  ).toBeVisible()
  mode = 'bad'
  release()
  await expect(
    page.getByRole('heading', { name: 'Workspace unavailable' }),
  ).toBeVisible()
  await expect(
    page.getByText('The workspace response is invalid or incompatible.'),
  ).toBeVisible()
  mode = 'ready'
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(
    page.getByRole('heading', { name: 'Ari', exact: true }),
  ).toBeVisible()
  const draft = page.getByRole('textbox', { name: 'Message Ari…' })
  await draft.fill('Keep this draft')
  await page.locator('input[type=file]').setInputFiles({
    name: 'retained.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Local metadata only'),
  })
  mode = 'error'
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(
    page.getByText('Showing the last loaded workspace. Try refreshing.'),
  ).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeDisabled()
  mode = 'ready'
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(draft).toBeEnabled()
  await expect(draft).toHaveValue('Keep this draft')
  await expect(page.locator('.attachment-list')).toContainText('retained.txt')
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
})

test('installation and caller identities namespace saved navigation', async ({
  page,
}) => {
  const data = workspace()
  await page.route(endpoint, (route) => route.fulfill({ json: data }))
  await page.goto('/')
  await selectOrganization(page, 'field-notes')
  data.installationId = 'another-installation'
  await page.reload()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('studio')
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toHaveCount(0)
  await selectOrganization(page, 'field-notes')
  data.currentHumanId = 'second-human'
  data.actorsById['second-human'] = {
    kind: 'human',
    id: 'second-human',
    name: 'Another person',
  }
  await page.reload()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('studio')
  await expect(page.getByRole('textbox')).toHaveCount(0)
})

test('duplicate display names remain distinguishable and no organizations is safe', async ({
  page,
}) => {
  const data = workspace()
  data.organizations[1].name = data.organizations[0].name
  data.actorsById.mira.name = 'Ari'
  await page.route(endpoint, (route) => route.fulfill({ json: data }))
  await page.goto('/')
  await expect(
    page.getByRole('option', { name: 'Leaf Studio (field-notes)' }),
  ).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: 'Ari (mira)', exact: true }),
  ).toBeVisible()
  data.organizations = []
  data.memberships = []
  data.groups = []
  data.groupAssignments = []
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(
    page.getByRole('heading', { name: 'No organizations yet' }),
  ).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: 'Admin', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: 'Message Admin…' }),
  ).toBeVisible()
})

test('reduced-motion keyboard disclosure and compact rail preserve agent access', async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const group = page.getByRole('button', { name: 'Product', exact: true })
  await group.focus()
  await page.keyboard.press('Enter')
  await expect(group).toHaveAttribute('aria-expanded', 'false')
  await expect(group).toBeFocused()
  expect(
    await page
      .locator('.app-shell')
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe('0s')
  await page.screenshot({
    path: testInfo.outputPath('reduced-motion-desktop.png'),
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: 'Message Mira…' }),
  ).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath('reduced-motion-narrow.png'),
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('changing destination cancels old requests and isolates same-identity preferences', async ({
  page,
}) => {
  const data = workspace()
  let release: () => void = () => {}
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  let delayA = false
  let aborted = false
  page.on('requestfailed', (request) => {
    if (request.url().endsWith('/__fixtures/a')) aborted = true
  })
  await page.route('**/__fixtures/a', async (route) => {
    if (delayA) await delayed
    await route.fulfill({ json: data }).catch(() => {})
  })
  await page.route('**/__fixtures/b', (route) => route.fulfill({ json: data }))
  await page.goto('/tests/connection.html')
  await selectOrganization(page, 'field-notes')
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('field-notes')
  await expectPersisted(
    page,
    { organizationId: 'field-notes' },
    '/__fixtures/a',
  )
  delayA = true
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await page.getByRole('button', { name: 'Connect B', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('studio')
  release()
  await expect.poll(() => aborted).toBe(true)
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('studio')
  delayA = false
  await page.getByRole('button', { name: 'Connect A', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('field-notes')
})

test('unavailable local storage does not block navigation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('Unavailable storage')
      },
    })
  })
  await page.goto('/')
  await expect(
    page.getByText('Local preferences are unavailable or still loading.', {
      exact: false,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Mira', exact: true }),
  ).toBeVisible()
})

for (const [endpointValue, message] of [
  ['http://[', 'The workspace URL is invalid.'],
  ['ftp://example.test', 'The workspace URL must use HTTP or HTTPS.'],
]) {
  test(`built startup renders configuration error for ${endpointValue}`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(
      `/tests/connection.html?endpoint=${encodeURIComponent(endpointValue)}`,
    )
    await expect(
      page.getByRole('heading', { name: 'Workspace unavailable' }),
    ).toBeVisible()
    await expect(page.getByText(message, { exact: false })).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Reload client' }),
    ).toBeVisible()
    await expect(page.getByRole('textbox')).toHaveCount(0)
    expect(errors).toEqual([])
  })
}

async function harness(page: Page) {
  await page.route('**/__fixtures/a', (route) =>
    route.fulfill({ json: workspace() }),
  )
  await page.route('**/__fixtures/b', (route) =>
    route.fulfill({ json: workspace() }),
  )
  await page.goto('/tests/connection.html')
  await expect(
    page.getByRole('heading', { name: 'Ari', exact: true }),
  ).toBeVisible()
  await expectPersisted(page, { organizationId: 'studio' }, '/__fixtures/a')
}

test('delayed preferences never delay context changes or retarget subsequent text', async ({
  page,
}) => {
  await harness(page)
  await page.getByRole('button', { name: 'Hold writes', exact: true }).click()
  // Multiple actions in one task must derive from current state, not a stale render.
  await page
    .getByRole('button', { name: 'Product', exact: true })
    .evaluate((button) => {
      ;(button as HTMLButtonElement).click()
      ;(button as HTMLButtonElement).click()
    })
  await expect(
    page.getByRole('button', { name: 'Product', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true')
  await selectOrganization(page, 'field-notes')
  await expect(page.getByText('Write held', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Open thread: Launch plan', exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole('textbox', { name: 'Message Ari…' })
    .fill('Only Field Notes')
  await page.getByRole('textbox', { name: 'Message Ari…' }).press('Enter')
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Mira', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Research', exact: true }),
  ).toHaveAttribute('aria-expanded', 'false')
  await selectOrganization(page, 'studio')
  await page.getByRole('button', { name: 'Ari', exact: true }).click()
  await expect(page.getByText('Only Field Notes', { exact: true })).toHaveCount(
    0,
  )
  await selectOrganization(page, 'field-notes')
  await expect(
    page.getByText('Only Field Notes', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Research', exact: true }).click()
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible()
  // The first write is still held despite all intervening UI actions.
  await expect(page.getByText('Write held', { exact: true })).toBeVisible()
  await page
    .getByRole('button', { name: 'Release writes', exact: true })
    .click()
  await expectPersisted(
    page,
    {
      organizationId: 'field-notes',
      agentId: 'mira',
      collapsed: true,
      closedGroups: [],
    },
    '/__fixtures/a',
  )
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Mira', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible()
})

test('write rejection preserves navigation and subsequent writes recover', async ({
  page,
}) => {
  await harness(page)
  await page.getByRole('button', { name: 'Reject writes', exact: true }).click()
  await selectOrganization(page, 'field-notes')
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Mira', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Local preferences are unavailable or still loading.', {
      exact: false,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Allow writes', exact: true }).click()
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()
  await expectPersisted(
    page,
    { organizationId: 'field-notes', agentId: 'mira', collapsed: true },
    '/__fixtures/a',
  )
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'Mira', exact: true }),
  ).toBeVisible()
})

test('blocked restoration times out and late preferences cannot override navigation', async ({
  page,
}) => {
  await harness(page)
  await selectOrganization(page, 'field-notes')
  await expectPersisted(
    page,
    { organizationId: 'field-notes' },
    '/__fixtures/a',
  )
  await page.goto('/tests/connection.html?storage=slow-read')
  await expect(page.getByText('Restoring workspace…')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Ari', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('studio')
  await page.getByRole('button', { name: 'Niko', exact: true }).click()
  await page.getByRole('button', { name: 'Release reads', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Niko', exact: true }),
  ).toBeVisible()
  await expectPersisted(
    page,
    { organizationId: 'studio', agentId: 'niko' },
    '/__fixtures/a',
  )
})

test('held writes stay scoped and preserve ordering when returning to a connection', async ({
  page,
}) => {
  await harness(page)
  await page.getByRole('button', { name: 'Hold writes', exact: true }).click()
  await selectOrganization(page, 'field-notes')
  await expect(page.getByText('Write held', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Connect B', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('studio')
  await page.getByRole('button', { name: 'Connect A', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: 'Organization' }),
  ).toHaveValue('field-notes')
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await page
    .getByRole('button', { name: 'Release writes', exact: true })
    .click()
  await expectPersisted(
    page,
    { organizationId: 'field-notes', agentId: 'mira' },
    '/__fixtures/a',
  )
})
