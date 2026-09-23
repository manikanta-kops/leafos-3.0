import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test'
import { createHash } from 'node:crypto'
const scope = {
  installationId: 'preview-installation',
  callerId: 'human-owner',
}
async function setup(page: Page, request: APIRequestContext, suffix = '') {
  const endpoint = `/__fixtures/workspace-${crypto.randomUUID().replaceAll('-', '')}`
  await page.goto(
    `/tests/connection.html?fixture=1&endpoint=${endpoint}${suffix}`,
  )
  await expect(
    page.getByRole('textbox', { name: 'Message Ari…' }),
  ).toBeVisible()
  const chat = await post(request, endpoint, 'resolve', {
    ...scope,
    agentId: 'ari',
    context: { kind: 'organization', organizationId: 'studio' },
  })
  return {
    endpoint,
    target: { ...scope, context: chat.context, chatId: chat.id },
  }
}
async function post(
  request: APIRequestContext,
  endpoint: string,
  path: string,
  data: unknown,
) {
  const result = await request.post(`${endpoint}/conversations/${path}`, {
    data,
  })
  expect(result.ok()).toBeTruthy()
  return result.json()
}
async function upload(
  request: APIRequestContext,
  endpoint: string,
  target: object,
  bytes = Buffer.from('synthetic audio'),
  purpose = 'attachment',
  name = 'same.bin',
  mimeType = 'application/octet-stream',
) {
  const intent = {
    uploadId: crypto.randomUUID(),
    target,
    name,
    mimeType,
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    purpose,
  }
  const url = `${endpoint}/conversations/media/uploads/${intent.uploadId}?intent=${encodeURIComponent(JSON.stringify(intent))}`
  const result = await request.put(url, {
    data: bytes,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  expect(result.ok()).toBeTruthy()
  return { receipt: await result.json(), intent, url, bytes }
}
async function inspect(
  request: APIRequestContext,
  endpoint: string,
  target: object,
) {
  return (
    await request.get(
      `${endpoint}/conversations/media/inspect?target=${encodeURIComponent(JSON.stringify(target))}`,
    )
  ).json()
}
async function attach(
  page: Page,
  text = 'actual bytes',
  name = 'sample.txt',
  mimeType = 'text/plain',
) {
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name, mimeType, buffer: Buffer.from(text) })
}
async function send(page: Page, text = '') {
  if (text) await page.getByRole('textbox', { name: 'Message Ari…' }).fill(text)
  const button = page
    .getByRole('button', { name: 'Send message', exact: true })
    .first()
  await expect(button).toBeEnabled()
  await button.click()
}

test('binary integrity, duplicate names, immutable upload receipt and ordered mixed parts', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  const a = await upload(
    request,
    endpoint,
    target,
    Buffer.from([0, 255, 1, 2]),
    'attachment',
    'duplicate.bin',
  )
  const b = await upload(
    request,
    endpoint,
    target,
    Buffer.from([9, 8, 7]),
    'attachment',
    'duplicate.bin',
  )
  expect(a.receipt.artifact.id).not.toBe(b.receipt.artifact.id)
  const reused = await request.put(
    a.url.replace(
      encodeURIComponent(JSON.stringify(a.intent)),
      encodeURIComponent(
        JSON.stringify({
          ...a.intent,
          sha256: b.intent.sha256,
          size: b.bytes.length,
        }),
      ),
    ),
    { data: b.bytes },
  )
  expect((await reused.json()).artifact.id).toBe(a.receipt.artifact.id)
  const downloaded = await request.get(
    `${endpoint}/conversations/media/artifacts/${a.receipt.artifact.id}/content?target=${encodeURIComponent(JSON.stringify(target))}`,
  )
  expect(await downloaded.body()).toEqual(a.bytes)
  const parts = [
    { type: 'file', artifactId: a.receipt.artifact.id, purpose: 'attachment' },
    { type: 'text', text: 'Caption between originals' },
    { type: 'file', artifactId: b.receipt.artifact.id, purpose: 'attachment' },
  ]
  const receipt = await post(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target,
    parts,
  })
  expect(receipt.records.messages[0].parts).toEqual(parts)
  expect((await inspect(request, endpoint, target)).uploads).toHaveLength(2)
})

test('actual bytes survive reload and file-only dispatch consumes the saved association', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await attach(page, 'recovered original')
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  await send(page)
  await expect(page.locator('.attachment-list')).toHaveCount(0)
  const saved = await post(request, endpoint, 'inspect', scope)
  expect(saved.submissions).toHaveLength(1)
  expect(saved.submissions[0].parts[0].type).toBe('file')
  expect((await inspect(request, endpoint, target)).uploads).toHaveLength(1)
})

for (const behavior of ['fail', 'lost-ack', 'slow'])
  test(`upload ${behavior}: no duplicate finalization after reload and explicit retry`, async ({
    page,
    request,
  }) => {
    const { endpoint, target } = await setup(page, request)
    await post(request, endpoint, 'media/scenario', {
      target,
      scenario: { upload: behavior, delay: 800 },
    })
    await attach(page)
    if (behavior === 'fail') {
      await expect(page.getByText(/Upload outcome unconfirmed/)).toBeVisible()
      await page.reload()
      await expect(page.getByText(/Upload outcome unconfirmed/)).toBeVisible()
      expect(
        (await inspect(request, endpoint, target)).deliveries,
      ).toHaveLength(1)
      await post(request, endpoint, 'media/scenario', {
        target,
        scenario: { upload: 'normal' },
      })
      await page.getByRole('button', { name: 'Retry upload' }).click()
    } else if (behavior === 'slow') {
      await expect(page.getByText(/Uploading/)).toBeVisible()
      await page.reload()
    }
    await expect(page.getByText(/Uploaded/)).toBeVisible({ timeout: 10000 })
    await send(page)
    expect((await inspect(request, endpoint, target)).uploads).toHaveLength(1)
  })

test('remove during slow finalization never reattaches and preserves receipt evidence', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { upload: 'slow', delay: 500 },
  })
  await attach(page)
  await expect(page.getByText(/Uploading/)).toBeVisible()
  await page.getByRole('button', { name: 'Remove sample.txt' }).click()
  await expect(page.locator('.attachment-list')).toHaveCount(0)
  await expect
    .poll(async () => (await inspect(request, endpoint, target)).uploads.length)
    .toBe(1)
  await page.reload()
  await expect(page.locator('.attachment-list')).toHaveCount(0)
  expect(
    (await post(request, endpoint, 'inspect', scope)).submissions,
  ).toHaveLength(0)
})

test('late upload stays with original organization and newer typed draft', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { upload: 'slow', delay: 500 },
  })
  await attach(page)
  await page
    .getByRole('textbox', { name: 'Message Ari…' })
    .fill('Newer caption')
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await expect(page.locator('.attachment-list')).toHaveCount(0)
  await page.getByRole('button', { name: 'Ari', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Message Ari…' })).toHaveValue(
    'Newer caption',
  )
  await expect(page.getByText(/Uploaded/)).toBeVisible({ timeout: 10000 })
})

test('two tabs settle a shared attachment and only one outbox reservation consumes it', async ({
  page,
  context,
  request,
}) => {
  const { endpoint } = await setup(page, request)
  await attach(page)
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  const other = await context.newPage()
  await other.goto(page.url())
  await expect(other.getByText(/Uploaded/)).toBeVisible()
  await Promise.all([
    page
      .getByRole('button', { name: 'Send message', exact: true })
      .dispatchEvent('click'),
    other
      .getByRole('button', { name: 'Send message', exact: true })
      .dispatchEvent('click'),
  ])
  await expect
    .poll(
      async () =>
        (await post(request, endpoint, 'inspect', scope)).submissions.length,
    )
    .toBe(1)
  await other.close()
})

for (const outcome of ['success', 'no-speech', 'failed', 'unavailable'])
  test(`voice preparation ${outcome} keeps original identity and FIFO`, async ({
    page,
    request,
  }) => {
    const { endpoint, target } = await setup(page, request)
    const root = await post(request, endpoint, 'submit', {
      submissionId: crypto.randomUUID(),
      target,
      parts: [{ type: 'text', text: 'Independent active work' }],
    })
    const replyTarget = { ...target, threadId: root.threadId }
    await post(request, endpoint, 'work/scenario', {
      ...scope,
      threadId: root.threadId,
      scenario: 'running',
    })
    await post(request, endpoint, 'media/scenario', {
      target,
      scenario: { preparation: 'manual' },
    })
    const audio = await upload(
      request,
      endpoint,
      replyTarget,
      Buffer.from('audio original'),
      'voice_note',
      'voice.webm',
      'audio/webm',
    )
    const a = await post(request, endpoint, 'submit', {
      submissionId: crypto.randomUUID(),
      target: replyTarget,
      parts: [
        { type: 'text', text: 'Caption A' },
        {
          type: 'file',
          artifactId: audio.receipt.artifact.id,
          purpose: 'voice_note',
        },
      ],
    })
    const b = await post(request, endpoint, 'submit', {
      submissionId: crypto.randomUUID(),
      target: replyTarget,
      parts: [{ type: 'text', text: 'Text B' }],
    })
    const before = await post(request, endpoint, 'work/inspect', scope)
    const qa = before.work.queue.find(
      (q: { messageId: string }) => q.messageId === a.messageId,
    )
    await post(request, endpoint, 'work/scenario', {
      ...scope,
      threadId: root.threadId,
      scenario: 'success',
    })
    let work = (await post(request, endpoint, 'work/inspect', scope)).work
    expect(
      work.queue.find((q: { messageId: string }) => q.messageId === b.messageId)
        .state,
    ).toBe('queued')
    expect(
      work.queue.find((q: { messageId: string }) => q.messageId === a.messageId)
        .state,
    ).toBe('queued')
    await post(request, endpoint, 'media/scenario', {
      target,
      messageId: a.messageId,
      outcome,
    })
    work = (await post(request, endpoint, 'work/inspect', scope)).work
    const after = work.queue.find(
      (q: { messageId: string }) => q.messageId === a.messageId,
    )
    expect(after.id).toBe(qa.id)
    expect(after.acceptanceOrder).toBe(qa.acceptanceOrder)
    expect(after.state).toBe('consumed')
    expect(
      work.queue.find((q: { messageId: string }) => q.messageId === b.messageId)
        .state,
    ).toBe('queued')
    const runs = work.runs.length
    await post(request, endpoint, 'media/scenario', {
      target,
      messageId: a.messageId,
      outcome: 'success',
    })
    expect(
      (await post(request, endpoint, 'work/inspect', scope)).work.runs,
    ).toHaveLength(runs)
    const snapshot = await post(request, endpoint, 'snapshot', {
      ...scope,
      threadId: root.threadId,
    })
    expect(
      snapshot.messages.find((m: { id: string }) => m.id === a.messageId).parts,
    ).toEqual(
      a.records.messages.find((m: { id: string }) => m.id === a.messageId)
        .parts,
    )
  })

test('root voice preparation blocks replies and Stop wins over late transcript', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { preparation: 'manual' },
  })
  const audio = await upload(
    request,
    endpoint,
    target,
    Buffer.from('voice'),
    'voice_note',
  )
  const root = await post(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target,
    parts: [
      {
        type: 'file',
        artifactId: audio.receipt.artifact.id,
        purpose: 'voice_note',
      },
    ],
  })
  const t = { ...target, threadId: root.threadId }
  await post(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: t,
    parts: [{ type: 'text', text: 'Wait behind root' }],
  })
  const work = (
    await post(request, endpoint, 'work/inspect', scope)
  ).work.workflows.find(
    (w: { target: { threadId: string } }) =>
      w.target.threadId === root.threadId,
  )
  expect(work.state).toBe('preparing')
  await post(request, endpoint, 'work/command', {
    operationId: crypto.randomUUID(),
    target: t,
    action: 'stop',
    runId: work.runId,
    attemptId: work.attemptId,
  })
  await post(request, endpoint, 'work/scenario', {
    ...scope,
    threadId: root.threadId,
    scenario: 'confirm-stop',
  })
  await post(request, endpoint, 'media/scenario', {
    target,
    messageId: root.messageId,
    outcome: 'success',
  })
  const after = (await post(request, endpoint, 'work/inspect', scope)).work
  expect(
    after.workflows.find((w: { id: string }) => w.id === work.id).state,
  ).toBe('cancelled')
  expect(after.queue[0].state).toBe('held')
})

test('ordinary audio never requests voice preparation; active HTML and SVG never execute', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  const a = await upload(
    request,
    endpoint,
    target,
    Buffer.from('audio'),
    'attachment',
    'ordinary.mp3',
    'audio/mpeg',
  )
  const receipt = await post(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target,
    parts: [
      {
        type: 'file',
        artifactId: a.receipt.artifact.id,
        purpose: 'attachment',
      },
    ],
  })
  expect(receipt.records.messages[0].preparation).toBeUndefined()
  await attach(
    page,
    '<svg xmlns="http://www.w3.org/2000/svg" onload="window.mediaExecuted=true"/>',
    'active.svg',
    'image/svg+xml',
  )
  await send(page)
  await expect(
    page.getByRole('region', { name: 'File: active.svg' }),
  ).toContainText('Preview unavailable')
  expect(await page.evaluate(() => 'mediaExecuted' in window)).toBe(false)
  await expect(page.locator('iframe, object, embed')).toHaveCount(0)
})

test('missing content and integrity errors leave message readable with retry', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await attach(page)
  await send(page, 'Keep this caption')
  await expect(
    page.getByRole('region', { name: 'File: sample.txt' }),
  ).toBeVisible()
  const artifact = (await inspect(request, endpoint, target)).uploads[0]
    .artifact
  await post(request, endpoint, 'media/scenario', {
    target,
    artifactId: artifact.id,
    availability: 'registered',
    removeContent: true,
  })
  await page
    .getByRole('button', { name: 'Prepare download sample.txt' })
    .click()
  await expect(
    page.getByText('File content is missing or unavailable.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry file' })).toBeVisible()
  await expect(
    page.getByText('Keep this caption', { exact: true }),
  ).toBeVisible()
})

async function syntheticMicrophone(page: Page, mode = 'normal') {
  await page.addInitScript((mode) => {
    const state = { requested: 0, stopped: 0, created: 0 }
    Object.assign(window, { syntheticMicrophone: state })
    if (mode === 'unsupported')
      Object.defineProperty(window, 'MediaRecorder', { value: undefined })
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: async () => {
          state.requested++
          if (mode === 'denied')
            throw new DOMException('Permission denied', 'NotAllowedError')
          if (mode === 'unavailable')
            throw new DOMException('No microphone', 'NotFoundError')
          if (mode === 'late')
            await new Promise((resolve) => setTimeout(resolve, 600))
          const audio = new AudioContext()
          const oscillator = audio.createOscillator()
          const destination = audio.createMediaStreamDestination()
          oscillator.connect(destination)
          oscillator.start()
          void audio.resume()
          state.created++
          for (const track of destination.stream.getTracks()) {
            const stop = track.stop.bind(track)
            let stopped = false
            track.stop = () => {
              if (!stopped) {
                stopped = true
                state.stopped++
                oscillator.stop()
                void audio.close()
              }
              stop()
            }
          }
          return destination.stream
        },
      },
    })
  }, mode)
}
async function microphoneState(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          syntheticMicrophone: {
            requested: number
            stopped: number
            created: number
          }
        }
      ).syntheticMicrophone,
  )
}

test('synthetic recording requests permission on action, stops tracks, reviews original and sends voice intent plus caption', async ({
  page,
  request,
}) => {
  await syntheticMicrophone(page)
  const { endpoint } = await setup(page, request)
  expect((await microphoneState(page)).requested).toBe(0)
  await page
    .getByRole('button', { name: 'Record voice note', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Stop recording' }),
  ).toBeFocused()
  await expect(page.getByText('Recording 0:01')).toBeVisible()
  await page.getByRole('button', { name: 'Stop recording' }).click()
  await expect(
    page.getByText(/Voice note · review before sending/),
  ).toBeVisible()
  await expect(page.locator('.pending-media audio')).toBeVisible()
  expect((await microphoneState(page)).stopped).toBe(1)
  await send(page, 'Typed caption stays typed')
  await expect(
    page.getByRole('region', { name: 'Voice preparation' }),
  ).toBeVisible()
  const saved = await post(request, endpoint, 'inspect', scope)
  expect(saved.submissions[0].parts[0]).toEqual({
    type: 'text',
    text: 'Typed caption stays typed',
  })
  expect(saved.submissions[0].parts[1].purpose).toBe('voice_note')
  await expect(
    page.getByText('Synthetic voice-note transcript for the fixture.'),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByText('Typed caption stays typed', { exact: true }),
  ).toBeVisible()
  expect(
    (await post(request, endpoint, 'inspect', scope)).submissions,
  ).toHaveLength(1)
})

for (const mode of ['denied', 'unavailable', 'unsupported'])
  test(`recording ${mode} is explicit without creating an attachment`, async ({
    page,
    request,
  }) => {
    await syntheticMicrophone(page, mode)
    await setup(page, request)
    await page
      .getByRole('button', { name: 'Record voice note', exact: true })
      .click()
    await expect(page.locator('.voice-control [role=alert]')).toBeVisible()
    await expect(page.locator('.attachment-list')).toHaveCount(0)
    expect((await microphoneState(page)).created).toBe(0)
  })

for (const action of ['cancel', 'navigate', 'late-cancel', 'late-navigate'])
  test(`recording ${action} releases synthetic tracks and cannot attach late bytes`, async ({
    page,
    request,
  }) => {
    await syntheticMicrophone(
      page,
      action.startsWith('late') ? 'late' : 'normal',
    )
    await setup(page, request)
    await page
      .getByRole('button', { name: 'Record voice note', exact: true })
      .click()
    if (!action.startsWith('late'))
      await expect(
        page.getByRole('button', { name: 'Stop recording' }),
      ).toBeVisible()
    if (action.includes('navigate'))
      await page.getByRole('button', { name: 'Mira', exact: true }).click()
    else await page.getByRole('button', { name: 'Cancel recording' }).click()
    await expect.poll(async () => (await microphoneState(page)).stopped).toBe(1)
    await expect(page.locator('.attachment-list')).toHaveCount(0)
  })

test('recording can be removed and recorded again without retaining old streams', async ({
  page,
  request,
}) => {
  await syntheticMicrophone(page)
  await setup(page, request)
  for (let count = 1; count <= 2; count++) {
    await page
      .getByRole('button', { name: 'Record voice note', exact: true })
      .click()
    await expect(page.getByText('Recording 0:01')).toBeVisible()
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByText(/Uploaded/)).toBeVisible()
    await page.getByRole('button', { name: /Remove Voice note/ }).click()
    expect((await microphoneState(page)).stopped).toBe(count)
  }
  await expect(page.locator('.attachment-list')).toHaveCount(0)
})

test('quota failure blocks upload and dispatch until original bytes are saved', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request, '&media-storage=fail')
  await attach(page, 'quota original')
  await expect(page.getByText(/File bytes are not saved/)).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }),
  ).toBeDisabled()
  expect((await inspect(request, endpoint, target)).deliveries).toHaveLength(0)
  await page.getByRole('button', { name: 'Allow media storage' }).click()
  await page.getByRole('button', { name: 'Retry attachment storage' }).click()
  await page.getByRole('button', { name: 'Retry upload' }).click()
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  await send(page)
  expect(
    (await inspect(request, endpoint, target)).uploads[0].intent.sha256,
  ).toBe(createHash('sha256').update('quota original').digest('hex'))
})

test('destination and organization switches cannot leak pending attachments', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { upload: 'slow', delay: 500 },
  })
  await attach(page)
  await expect
    .poll(
      async () => (await inspect(request, endpoint, target)).deliveries.length,
    )
    .toBe(1)
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption({ label: 'Field Notes' })
  await expect(page.locator('.attachment-list')).toHaveCount(0)
  await page
    .getByRole('combobox', { name: 'Organization' })
    .selectOption('studio')
  await expect(page.getByText(/Uploaded/)).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Connect B', exact: true }).click()
  await expect(page.locator('.attachment-list')).toHaveCount(0)
})

test('explicit upload retry waits behind receipt lookup and does not write after terminal receipt', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { upload: 'fail' },
  })
  let release: () => void = () => {}
  let entered = false
  await page.route('**/media/uploads/*', async (route) => {
    if (route.request().method() === 'GET' && !entered) {
      entered = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    await route.continue()
  })
  await attach(page)
  await expect(page.getByText(/Upload outcome unconfirmed/)).toBeVisible()
  await expect.poll(() => entered).toBe(true)
  await page.getByRole('button', { name: 'Retry upload' }).click()
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { upload: 'normal' },
  })
  release()
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  expect((await inspect(request, endpoint, target)).deliveries).toHaveLength(2)
})

test('generated agent file and organization publication use the same projection and independent bytes', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  const { artifacts } = await post(request, endpoint, 'media/scenario', {
    target,
    generated: true,
  })
  expect(artifacts[0].ownership.kind).toBe('agent')
  expect(artifacts[1].ownership.kind).toBe('organization')
  await post(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target,
    parts: artifacts.map((a: { id: string }) => ({
      type: 'file',
      artifactId: a.id,
      purpose: 'attachment',
    })),
  })
  await expect(
    page.getByRole('region', { name: 'File: published-checklist.txt' }),
  ).toContainText('Published copy')
  await post(request, endpoint, 'media/scenario', {
    target,
    artifactId: artifacts[0].id,
    availability: 'deleted',
    removeContent: true,
  })
  const content = await request.get(
    `${endpoint}/conversations/media/artifacts/${artifacts[1].id}/content?target=${encodeURIComponent(JSON.stringify(target))}`,
  )
  expect((await content.body()).toString()).toBe(
    'Synthetic generated checklist\n',
  )
  expect(
    (
      await post(request, endpoint, 'snapshot', { ...scope, threadId: null })
    ).artifacts.find((a: { id: string }) => a.id === artifacts[0].id).ownership
      .kind,
  ).toBe('agent')
})

test('corrupt binary upload is rejected and corrupt download is never exposed as ready', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  const a = await upload(request, endpoint, target)
  const badIntent = { ...a.intent, uploadId: crypto.randomUUID() }
  const bad = await request.put(
    `${endpoint}/conversations/media/uploads/${badIntent.uploadId}?intent=${encodeURIComponent(JSON.stringify(badIntent))}`,
    { data: Buffer.from('other') },
  )
  expect(bad.status()).toBe(400)
  await attach(page)
  await send(page)
  await expect(
    page.getByRole('region', { name: 'File: sample.txt' }),
  ).toBeVisible()
  await page.route('**/media/artifacts/*/content?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: 'corrupt',
    }),
  )
  await page
    .getByRole('button', { name: 'Prepare download sample.txt' })
    .click()
  await expect(
    page.getByText('File integrity verification failed.'),
  ).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Download sample.txt' }),
  ).toHaveCount(0)
})

test('caller switch cannot read old artifact bytes or consume old draft', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await attach(page)
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  const artifact = (await inspect(request, endpoint, target)).uploads[0]
    .artifact
  await post(request, endpoint, 'set-caller', {
    ...scope,
    nextCaller: 'different-human',
  })
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(page.locator('.attachment-list')).toHaveCount(0)
  const result = await request.get(
    `${endpoint}/conversations/media/artifacts/${artifact.id}/content?target=${encodeURIComponent(JSON.stringify(target))}`,
  )
  expect(result.status()).toBe(403)
  await post(request, endpoint, 'set-caller', {
    ...scope,
    callerId: 'different-human',
    nextCaller: scope.callerId,
  })
  await page.getByRole('button', { name: 'Refresh workspace' }).click()
  await expect(page.getByText(/Uploaded/)).toBeVisible()
})

test('cancelled preparing follow-up cannot revive after late transcription', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  const t = { ...target, threadId: 'thread-launch' }
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { preparation: 'manual' },
  })
  const a = await upload(
    request,
    endpoint,
    t,
    Buffer.from('voice'),
    'voice_note',
  )
  const voice = await post(request, endpoint, 'submit', {
    submissionId: crypto.randomUUID(),
    target: t,
    parts: [
      {
        type: 'file',
        artifactId: a.receipt.artifact.id,
        purpose: 'voice_note',
      },
    ],
  })
  const before = (await post(request, endpoint, 'work/inspect', scope)).work
  const work = before.workflows.find(
    (w: { target: { threadId: string } }) => w.target.threadId === t.threadId,
  )
  const q = before.queue.find(
    (q: { messageId: string }) => q.messageId === voice.messageId,
  )
  await post(request, endpoint, 'work/command', {
    operationId: crypto.randomUUID(),
    target: t,
    runId: work.runId,
    attemptId: work.attemptId,
    queueId: q.id,
    action: 'cancel-queued',
  })
  await post(request, endpoint, 'media/scenario', {
    target,
    messageId: voice.messageId,
    outcome: 'success',
  })
  const after = (await post(request, endpoint, 'work/inspect', scope)).work
  expect(
    after.queue.find((item: { id: string }) => item.id === q.id).state,
  ).toBe('cancelled')
  expect(after.runs.length).toBe(before.runs.length)
})

test('object URLs are released when their draft owner leaves the UI', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    const urls = new Set<string>()
    Object.assign(window, { mediaURLs: urls })
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (value) => {
      const url = create(value)
      urls.add(url)
      return url
    }
    URL.revokeObjectURL = (value) => {
      urls.delete(value)
      revoke(value)
    }
  })
  await setup(page, request)
  await attach(page, 'synthetic bytes', 'not-decodable.png', 'image/png')
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  expect(
    await page.evaluate(
      () => (window as unknown as { mediaURLs: Set<string> }).mediaURLs.size,
    ),
  ).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Mira', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { mediaURLs: Set<string> }).mediaURLs.size,
      ),
    )
    .toBe(0)
})

test('another tab terminal upload receipt supersedes an explicit retry waiting on a read', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { upload: 'fail' },
  })
  let release: () => void = () => {},
    entered = false
  await page.route('**/media/uploads/*', async (route) => {
    if (route.request().method() === 'GET' && !entered) {
      entered = true
      await new Promise<void>((resolve) => {
        release = resolve
      })
    }
    await route.continue()
  })
  await attach(page)
  await expect(page.getByText(/Upload outcome unconfirmed/)).toBeVisible()
  await expect.poll(() => entered).toBe(true)
  await page.getByRole('button', { name: 'Retry upload' }).click()
  const intent = (await inspect(request, endpoint, target)).deliveries[0]
  await post(request, endpoint, 'media/scenario', {
    target,
    scenario: { upload: 'normal' },
  })
  const finalized = await request.put(
    `${endpoint}/conversations/media/uploads/${intent.uploadId}?intent=${encodeURIComponent(JSON.stringify(intent))}`,
    { data: Buffer.from('actual bytes') },
  )
  expect(finalized.ok()).toBe(true)
  release()
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  expect((await inspect(request, endpoint, target)).deliveries).toHaveLength(2)
})

test('media message lost acknowledgement recovers read-only across reload and reordered target keys', async ({
  page,
  request,
}) => {
  const { endpoint } = await setup(page, request)
  await attach(page)
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  await page.route('**/conversations/submit', async (route) => {
    await route.fetch()
    await route.abort()
  })
  await send(page)
  await expect
    .poll(
      async () =>
        (await post(request, endpoint, 'inspect', scope)).submissions.length,
    )
    .toBe(1)
  await page.reload()
  await expect(
    page.getByRole('region', { name: 'File: sample.txt' }),
  ).toBeVisible()
  const before = await post(request, endpoint, 'inspect', scope)
  expect(before.submissions).toHaveLength(1)
  expect(before.deliveries).toHaveLength(1)
  await page.unroute('**/conversations/submit')
  await page.route('**/conversations/receipt', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    if (body.status === 'accepted')
      body.target = Object.fromEntries(Object.entries(body.target).reverse())
    await route.fulfill({ response, json: body })
  })
  await page.reload()
  await expect(
    page.getByText('Acceptance not yet confirmed', { exact: false }),
  ).toHaveCount(0)
  expect(
    (await post(request, endpoint, 'inspect', scope)).deliveries,
  ).toHaveLength(1)
})

test('offline capability read still saves original bytes and reload never starts a write', async ({
  page,
  request,
}) => {
  const { endpoint, target } = await setup(page, request)
  await page.route('**/media/capabilities', (route) => route.abort())
  await attach(page, 'offline original')
  await expect(page.getByText(/Upload outcome unconfirmed/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Upload outcome unconfirmed/)).toBeVisible()
  expect((await inspect(request, endpoint, target)).deliveries).toHaveLength(0)
  await page.unroute('**/media/capabilities')
  await page.getByRole('button', { name: 'Retry upload' }).click()
  await expect(page.getByText(/Uploaded/)).toBeVisible()
  expect(
    (await inspect(request, endpoint, target)).uploads[0].intent.sha256,
  ).toBe(createHash('sha256').update('offline original').digest('hex'))
})
