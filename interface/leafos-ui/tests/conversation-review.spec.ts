import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page, extra = '') {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.goto(
    `/tests/connection.html?fixture=1&endpoint=${endpoint}${extra}`,
  )
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  return endpoint
}

async function captureRecovery(page: Page, name: string) {
  if (process.env.STEP3_REVIEW_SCREENSHOTS !== '1') return
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .every((animation) => animation.playState !== 'running') &&
          Array.from(
            document.querySelectorAll(
              '.conversation,.thread-pane,.composer-wrap,.feed,.thread-reply',
            ),
          ).every((element) => {
            const style = getComputedStyle(element)
            return style.transform === 'none' && Number(style.opacity) >= 0.999
          }),
      ),
    )
    .toBe(true)
  const directory = resolve(
    '../../internal-docs/step-03/screenshots/review-fixes',
  )
  await mkdir(directory, { recursive: true })
  await page.screenshot({
    path: resolve(directory, `${name}.png`),
    animations: 'disabled',
  })
}

test('expanded thread keeps uncertain reply and recovery visible', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await page.route(`**${endpoint}/conversations/submit`, (route) =>
    route.abort(),
  )
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  await page.getByRole('button', { name: 'Expand thread' }).click()
  const input = page.getByRole('textbox', { name: 'Reply in this thread…' })
  await input.fill('Retain visible uncertain reply')
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(
    page.getByText('Reply · Acceptance not yet confirmed', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Check and retry original send' }),
  ).toBeVisible()
})

test('transient initial draft read failure recovers through Retry saving', async ({
  page,
}) => {
  await setup(page, '&draft=fail-read')
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Retained while storage recovers')
  await expect(
    page.getByText('Draft is not saved on this device.'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Allow draft storage' }).click()
  await page.getByRole('button', { name: 'Retry saving' }).click()
  await expect(
    page.getByText('Draft saved on this device', { exact: true }),
  ).toBeVisible()
  await input.press('Enter')
  await expect(input).toHaveValue('')
  await expect(
    page.getByText('Retained while storage recovers', { exact: true }),
  ).toBeVisible()
})

test('incomplete Markdown preserves literal content without stripping suffix characters', async ({
  page,
}) => {
  await setup(page)
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('**incomplete')
  await input.press('Enter')
  await expect(
    page.getByRole('button', {
      name: 'Open thread: **incomplete',
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.locator('.message-text').filter({ hasText: 'incom' }).last(),
  ).toHaveText('**incomplete')
})

const scope = {
  installationId: 'preview-installation',
  callerId: 'human-owner',
}
for (const layout of ['expanded', 'narrow'] as const) {
  for (const outcome of ['uncertain', 'rejected'] as const) {
    test(`${layout} thread exposes ${outcome} reply recovery and original target`, async ({
      page,
    }) => {
      const endpoint = await setup(page)
      if (layout === 'narrow')
        await page.setViewportSize({ width: 390, height: 844 })
      await page
        .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
        .click()
      if (layout === 'expanded')
        await page.getByRole('button', { name: 'Expand thread' }).click()
      const pane = page.getByRole('region', {
        name: 'Thread: Launch plan',
        exact: true,
      })
      let blocked = true
      if (outcome === 'uncertain')
        await page.route(`**${endpoint}/conversations/submit`, (route) =>
          blocked ? route.abort() : route.continue(),
        )
      else
        await page.request.post(`${endpoint}/commands`, {
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
      const text = `Keep ${layout} ${outcome} reply`
      const input = pane.getByRole('textbox', { name: 'Reply in this thread…' })
      await input.fill(text)
      await input.press('Enter')
      await expect(input).toHaveValue('')
      await expect(pane.getByText(text, { exact: true }).first()).toBeVisible()
      await expect(
        pane.getByText('In thread: Launch plan', { exact: true }),
      ).toBeVisible()
      if (outcome === 'uncertain') {
        await expect(
          pane.getByText('Reply · Acceptance not yet confirmed', {
            exact: true,
          }),
        ).toBeVisible()
        const retry = pane.getByRole('button', {
          name: 'Check and retry original send',
        })
        await expect(retry).toBeInViewport()
        await captureRecovery(page, `${layout}-${outcome}`)
        blocked = false
        await retry.click()
        await expect(pane.locator('.pending-submission')).toHaveCount(0)
        await expect(
          pane.getByText(text, { exact: true }).first(),
        ).toBeVisible()
        const response = await page.request.post(
          `${endpoint}/conversations/inspect`,
          { data: scope },
        )
        const inspected = await response.json()
        expect(inspected.submissions).toHaveLength(1)
        expect(inspected.submissions[0].target.threadId).toBeTruthy()
      } else {
        await expect(
          pane.getByText('Reply · Not accepted', { exact: true }),
        ).toBeVisible()
        await expect(
          pane.getByText(
            'A participant no longer belongs to this organization.',
            { exact: true },
          ),
        ).toBeVisible()
        await expect(
          pane.getByRole('button', { name: 'Dismiss', exact: true }),
        ).toBeInViewport()
        await expect(
          pane.getByRole('button', { name: 'Check and retry original send' }),
        ).toHaveCount(0)
        await captureRecovery(page, `${layout}-${outcome}`)
      }
    })
  }
  test(`${layout} thread exposes live disconnection and reconnect`, async ({
    page,
  }) => {
    const endpoint = await setup(page)
    await page.route(`**${endpoint}/conversations/events?**`, (route) =>
      route.abort(),
    )
    if (layout === 'narrow')
      await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
      .click()
    if (layout === 'expanded')
      await page.getByRole('button', { name: 'Expand thread' }).click()
    const pane = page.getByRole('region', {
      name: 'Thread: Launch plan',
      exact: true,
    })
    await expect(
      pane.getByText('Live updates disconnected. Reconnecting…', {
        exact: false,
      }),
    ).toBeVisible()
    await expect(
      pane.getByRole('button', { name: 'Reconnect', exact: true }),
    ).toBeVisible()
  })
}

test('draft read retry retains text and restores subsequent cross-tab observation', async ({
  page,
  context,
}) => {
  const endpoint = await setup(page, '&draft=fail-read')
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Typed before failed read recovery')
  await page.getByRole('button', { name: 'Allow draft storage' }).click()
  await page.getByRole('button', { name: 'Retry saving' }).click()
  await expect(
    page.getByText('Draft saved on this device', { exact: true }),
  ).toBeVisible()
  const other = await context.newPage()
  await other.goto(`/tests/connection.html?fixture=1&endpoint=${endpoint}`)
  const second = other.getByRole('textbox', { name: 'Message Ari…' })
  await expect(second).toHaveValue('Typed before failed read recovery')
  await second.fill('A later saved edit from another tab')
  await expect(
    other.getByText('Draft saved on this device', { exact: true }),
  ).toBeVisible()
  await expect(input).toHaveValue('A later saved edit from another tab')
})

test('streamed incomplete inline delimiters remain literal until canonical finalization', async ({
  page,
}) => {
  const endpoint = await setup(page)
  const response = await page.request.post(
    `${endpoint}/conversations/snapshot`,
    { data: { ...scope, threadId: null } },
  )
  const snapshot = await response.json()
  const thread = snapshot.threads.find(
    (item: { title: string }) => item.title === 'Launch plan',
  )
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  const pane = page.getByRole('region', {
    name: 'Thread: Launch plan',
    exact: true,
  })
  const id = crypto.randomUUID()
  const updated = {
    ...thread,
    revision: thread.revision + 1,
    messageIds: [...thread.messageIds, id],
    replyCount: thread.replyCount + 1,
  }
  const pieces = [
    '*',
    '**',
    '**incomplete',
    '`',
    '`unfinished',
    'Before **partial',
    '```ts\nconst unfinished = 1',
    '**complete** and `complete`',
  ]
  for (const [index, text] of pieces.entries()) {
    await page.request.post(`${endpoint}/conversations/emit`, {
      data: {
        ...scope,
        threads: [updated],
        messages: [
          {
            id,
            threadId: thread.id,
            authorId: 'ari',
            createdAt: new Date().toISOString(),
            revision: index + 1,
            status: index === pieces.length - 1 ? 'final' : 'draft',
            parts: [{ type: 'text', text }],
          },
        ],
      },
    })
    const body = pane.locator('.thread-reply .message-text').last()
    await expect(body).toHaveText(
      index === pieces.length - 1 ? 'complete and complete' : text,
    )
  }
  await expect(pane.getByText('Final text', { exact: true })).toBeVisible()
})

for (const layout of ['expanded', 'narrow'] as const) {
  test(`${layout} thread keeps local outbox failure accessible`, async ({
    page,
  }) => {
    await setup(page, '&outbox=fail-read')
    if (layout === 'narrow')
      await page.setViewportSize({ width: 390, height: 844 })
    await page
      .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
      .click()
    if (layout === 'expanded')
      await page.getByRole('button', { name: 'Expand thread' }).click()
    const pane = page.getByRole('region', {
      name: 'Thread: Launch plan',
      exact: true,
    })
    await expect(pane.getByRole('alert')).toContainText(
      'Local send history is unavailable.',
    )
    await expect(pane.getByRole('alert')).toBeVisible()
  })
}

test('closing a thread preserves its recovery on the feed and reopening moves it back', async ({
  page,
}) => {
  const endpoint = await setup(page)
  await page.route(`**${endpoint}/conversations/submit`, (route) =>
    route.abort(),
  )
  await page
    .getByRole('button', { name: 'Open thread: Launch plan', exact: true })
    .click()
  const pane = page.getByRole('region', {
    name: 'Thread: Launch plan',
    exact: true,
  })
  await pane
    .getByRole('textbox', { name: 'Reply in this thread…' })
    .fill('Recovery belongs to the original thread')
  await pane
    .getByRole('textbox', { name: 'Reply in this thread…' })
    .press('Enter')
  await expect(
    pane.getByText('Reply · Acceptance not yet confirmed', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.conversation .pending-submission')).toHaveCount(0)
  await pane.getByRole('button', { name: 'Close thread' }).click()
  await expect(page.locator('.conversation .pending-submission')).toHaveCount(1)
  await page.getByRole('button', { name: 'Open original thread' }).click()
  await expect(
    pane.getByText('Recovery belongs to the original thread', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.conversation .pending-submission')).toHaveCount(0)
})
