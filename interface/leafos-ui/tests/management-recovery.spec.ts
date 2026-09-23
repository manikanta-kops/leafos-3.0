import { test, expect } from '@playwright/test'

test('late create acknowledgement cannot resurrect enrollment completed in another tab', async ({
  page,
  context,
}) => {
  const endpoint =
    '/__fixtures/workspace-' + crypto.randomUUID().replaceAll('-', '')
  const url = '/tests/connection.html?fixture=1&endpoint=' + endpoint
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**' + endpoint + '/commands', async (route) => {
    const response = await route.fetch()
    if (route.request().postDataJSON().operation.type === 'agent.create')
      await held
    await route.fulfill({ response })
  })
  await page.goto(url)
  await page.getByRole('heading', { name: 'Ari', exact: true }).waitFor()
  await page
    .getByRole('button', { name: 'Manage workspace', exact: true })
    .click()
  await page.getByRole('button', { name: 'Agents', exact: true }).click()
  await page
    .getByRole('button', { name: 'Create new agent', exact: true })
    .click()
  await page
    .getByLabel('Name', { exact: true })
    .fill('Cross-tab recovery agent')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect
    .poll(async () =>
      Object.values(
        (await (await page.request.get(endpoint)).json()).actorsById,
      ).some(
        (a: unknown) =>
          (a as { name: string }).name === 'Cross-tab recovery agent',
      ),
    )
    .toBe(true)
  const second = await context.newPage()
  await second.goto(url)
  await second.getByRole('heading', { name: 'Ari', exact: true }).waitFor()
  await second
    .getByRole('button', { name: 'Manage workspace', exact: true })
    .click()
  await second
    .getByRole('button', { name: 'Check outcome', exact: true })
    .click()
  await second
    .getByRole('button', { name: 'Add created agent', exact: true })
    .click()
  await expect(
    second.getByRole('region', { name: 'Request recovery' }),
  ).toHaveCount(0)
  release()
  // A stale response must not recreate recovery work that another tab completed.
  await expect(
    page.getByRole('region', { name: 'Request recovery' }),
  ).toHaveCount(0)
})

async function createEnrollment(page: import('@playwright/test').Page) {
  const endpoint =
    '/__fixtures/workspace-' + crypto.randomUUID().replaceAll('-', '')
  const url = '/tests/connection.html?fixture=1&endpoint=' + endpoint
  await page.goto(url)
  await page
    .getByRole('button', { name: 'Manage workspace', exact: true })
    .click()
  await page.getByRole('button', { name: 'Agents', exact: true }).click()
  await page
    .getByRole('button', { name: 'Create new agent', exact: true })
    .click()
  await page
    .getByLabel('Name', { exact: true })
    .fill('Keep this global identity')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(
    page.getByText('Finish enrollment', { exact: true }),
  ).toBeVisible()
  return { endpoint, url }
}

for (const competing of ['Add created agent', 'Keep agent without adding']) {
  test(`stale ${competing} cannot supersede an in-flight membership`, async ({
    page,
    context,
  }) => {
    const { endpoint, url } = await createEnrollment(page)
    const second = await context.newPage()
    await second.goto(url)
    await second
      .getByRole('button', { name: 'Manage workspace', exact: true })
      .click()
    await expect(
      second.getByRole('button', { name: competing, exact: true }),
    ).toBeVisible()
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let committed!: () => void
    const accepted = new Promise<void>((resolve) => {
      committed = resolve
    })
    await page.route('**' + endpoint + '/commands', async (route) => {
      const response = await route.fetch()
      committed()
      await held
      await route.fulfill({ response })
    })
    await page
      .getByRole('button', { name: 'Add created agent', exact: true })
      .click()
    await accepted
    let secondPosts = 0
    second.on('request', (req) => {
      if (req.method() === 'POST') secondPosts++
    })
    await second.getByRole('button', { name: competing, exact: true }).click()
    await expect(
      second.getByText('Outcome unresolved', { exact: true }),
    ).toBeVisible()
    await expect(
      second.getByRole('button', {
        name: 'Keep agent without adding',
        exact: true,
      }),
    ).toHaveCount(0)
    expect(secondPosts).toBe(0)
    // Competing receipt checks can complete the exact dispatched step; late responses cannot restore it.
    await second
      .getByRole('button', { name: 'Check outcome', exact: true })
      .click()
    await expect(
      second.getByRole('region', { name: 'Request recovery' }),
    ).toHaveCount(0)
    release()
    await expect(
      page.getByRole('region', { name: 'Request recovery' }),
    ).toHaveCount(0)
    const data = await (await page.request.get(endpoint)).json()
    const agent = Object.values(data.actorsById).find(
      (a) => (a as { name: string }).name === 'Keep this global identity',
    ) as { id: string }
    expect(
      data.memberships.filter(
        (m: { actorId: string }) => m.actorId === agent.id,
      ),
    ).toHaveLength(1)
  })
}

for (const rejected of [false, true]) {
  test(`keep acknowledged agent after reload ${rejected ? 'and rejected membership' : 'with unavailable organization'}`, async ({
    page,
  }) => {
    const { endpoint } = await createEnrollment(page)
    if (rejected) {
      await page.route('**' + endpoint + '/commands', (route) =>
        route.fulfill({
          status: 400,
          json: {
            outcome: 'rejected',
            code: 'unavailable',
            message: 'Organization unavailable.',
          },
        }),
      )
      await page
        .getByRole('button', { name: 'Add created agent', exact: true })
        .click()
      await expect(
        page.getByText('Request rejected', { exact: true }),
      ).toBeVisible()
    }
    const data = await (await page.request.get(endpoint)).json()
    const agent = Object.values(data.actorsById).find(
      (a) => (a as { name: string }).name === 'Keep this global identity',
    ) as { id: string }
    if (!rejected) {
      const unavailable = {
        ...data,
        organizations: [],
        memberships: [],
        groups: [],
        groupAssignments: [],
      }
      await page.route(
        (url) => url.pathname === endpoint,
        (route) => route.fulfill({ json: unavailable }),
      )
    }
    await page.reload()
    await page
      .getByRole('button', { name: 'Manage workspace', exact: true })
      .click()
    let posts = 0
    page.on('request', (req) => {
      if (req.method() === 'POST') posts++
    })
    await page
      .getByRole('button', { name: 'Keep agent without adding', exact: true })
      .click()
    await expect(
      page.getByText('Global agent kept without adding membership.', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Create organization', exact: true }),
    ).toBeEnabled()
    expect(posts).toBe(0)
    const actual = await (await page.request.get(endpoint)).json()
    expect(actual.actorsById[agent.id]).toBeTruthy()
    expect(
      actual.memberships.some(
        (m: { actorId: string }) => m.actorId === agent.id,
      ),
    ).toBe(false)
    await page.reload()
    await page
      .getByRole('button', { name: 'Manage workspace', exact: true })
      .click()
    await expect(
      page.getByRole('region', { name: 'Request recovery' }),
    ).toHaveCount(0)
  })
}
