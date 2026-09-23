import { parseRecords } from '../src/data/conversation-http.js'
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

for (const resume of [false, true])
  test(`cancelling preparing queue head advances later reply${resume ? ' only after explicit Resume' : ''}`, async ({
    page,
    request,
  }) => {
    const { endpoint, target } = await setup(page, request)
    const root = await post(request, endpoint, 'submit', {
      submissionId: crypto.randomUUID(),
      target,
      parts: [{ type: 'text', text: 'Root' }],
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
      Buffer.from('synthetic voice'),
      'voice_note',
      'voice.webm',
      'audio/webm',
    )
    const a = await post(request, endpoint, 'submit', {
      submissionId: crypto.randomUUID(),
      target: replyTarget,
      parts: [
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
      parts: [{ type: 'text', text: 'Later ready reply B' }],
    })
    if (!resume)
      await post(request, endpoint, 'work/scenario', {
        ...scope,
        threadId: root.threadId,
        scenario: 'success',
      })
    const before = (await post(request, endpoint, 'work/inspect', scope)).work
    const workflow = before.workflows.find(
      (w: { target: { threadId: string } }) =>
        w.target.threadId === root.threadId,
    )
    const qa = before.queue.find(
      (q: { messageId: string }) => q.messageId === a.messageId,
    )
    expect(workflow.state).toBe(resume ? 'running' : 'completed')
    expect(qa.readiness).toBe('preparing')
    if (resume) {
      await post(request, endpoint, 'work/command', {
        operationId: crypto.randomUUID(),
        target: replyTarget,
        runId: workflow.runId,
        attemptId: workflow.attemptId,
        action: 'stop',
      })
      await post(request, endpoint, 'work/scenario', {
        ...scope,
        threadId: root.threadId,
        scenario: 'confirm-stop',
      })
    }
    const cancelled = await post(request, endpoint, 'work/command', {
      operationId: crypto.randomUUID(),
      target: replyTarget,
      runId: workflow.runId,
      attemptId: workflow.attemptId,
      queueId: qa.id,
      action: 'cancel-queued',
    })
    expect(cancelled.status).toBe('accepted')
    if (resume) {
      const held = (await post(request, endpoint, 'work/inspect', scope)).work
      expect(
        held.queue.find(
          (q: { messageId: string }) => q.messageId === b.messageId,
        ).state,
      ).toBe('held')
      const result = await post(request, endpoint, 'work/command', {
        operationId: crypto.randomUUID(),
        target: replyTarget,
        runId: workflow.runId,
        attemptId: workflow.attemptId,
        action: 'resume',
      })
      expect(result.status).toBe('accepted')
    }
    const after = (await post(request, endpoint, 'work/inspect', scope)).work
    expect(
      after.queue.find(
        (q: { messageId: string }) => q.messageId === a.messageId,
      ).state,
    ).toBe('cancelled')
    expect(
      after.queue.find(
        (q: { messageId: string }) => q.messageId === b.messageId,
      ).state,
    ).toBe('consumed')
    expect(
      after.runs.some(
        (r: { originMessageId: string; state: string }) =>
          r.originMessageId === b.messageId && r.state === 'running',
      ),
    ).toBeTruthy()
    await post(request, endpoint, 'media/scenario', {
      target,
      messageId: a.messageId,
      outcome: 'success',
    })
    const late = (await post(request, endpoint, 'work/inspect', scope)).work
    expect(late.runs).toHaveLength(after.runs.length)
    expect(
      late.queue.find((q: { messageId: string }) => q.messageId === a.messageId)
        .state,
    ).toBe('cancelled')
  })

test('caption Enter cannot submit while voice recording is still active', async ({
  page,
  request,
}) => {
  await syntheticMicrophone(page)
  const { endpoint } = await setup(page, request)
  const input = page.getByRole('textbox', { name: 'Message Ari…' })
  await input.fill('Caption belongs with voice')
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }).first(),
  ).toBeEnabled()
  await page
    .getByRole('button', { name: 'Record voice note', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Stop recording' }),
  ).toBeVisible()
  await expect(page.getByText('Recording 0:01')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }).first(),
  ).toBeDisabled()
  await input.press('Enter')
  // Complete a fixture read after the action and check no independent caption was submitted.
  const state = await post(request, endpoint, 'inspect', scope)
  expect(state.submissions).toHaveLength(0)
  await expect(input).toHaveValue('Caption belongs with voice')
  await expect(
    page.getByRole('button', { name: 'Send message', exact: true }).first(),
  ).toBeDisabled()
})

test('preparation projection accepts a real service identifier separately from fixture provenance', () => {
  const records = {
    chats: [],
    threads: [],
    artifacts: [],
    messages: [
      {
        id: 'message',
        threadId: 'thread',
        authorId: 'human',
        createdAt: '2026-09-22T16:00:00Z',
        revision: 1,
        status: 'final',
        parts: [
          { type: 'file', artifactId: 'artifact', purpose: 'voice_note' },
        ],
        preparation: [
          {
            id: 'preparation',
            artifactId: 'artifact',
            partIndex: 0,
            revision: 1,
            status: 'succeeded',
            provider: 'spokenly-cli',
            transcript: 'Transcribed words',
          },
        ],
      },
    ],
  }
  expect(() => parseRecords(records)).not.toThrow()
  for (const invalid of [
    { provider: '' },
    { provider: '   ' },
    { simulated: 'yes' },
    { revision: -1 },
    { partIndex: 1 },
    { artifactId: 'other' },
  ]) {
    const broken = structuredClone(records)
    Object.assign(broken.messages[0].preparation[0], invalid)
    expect(() => parseRecords(broken)).toThrow()
  }
})

for (const cancel of [false, true])
  test(`recording guards slow permission and ${cancel ? 'cancellation releases caption' : 'finalization waits for saved audio review'}`, async ({
    page,
    request,
  }) => {
    await syntheticMicrophone(page, 'late')
    const { endpoint } = await setup(page, request, '&media-storage=slow')
    const input = page.getByRole('textbox', { name: 'Message Ari…' })
    const send = page
      .getByRole('button', { name: 'Send message', exact: true })
      .first()
    await input.fill('Caption with recording')
    await expect(send).toBeEnabled()
    await page
      .getByRole('button', { name: 'Record voice note', exact: true })
      .click()
    await expect(page.getByText('Requesting microphone…')).toBeVisible()
    await expect(send).toBeDisabled()
    await input.press('Enter')
    await input.evaluate((element) => element.closest('form')!.requestSubmit())
    expect(
      (await post(request, endpoint, 'inspect', scope)).submissions,
    ).toHaveLength(0)
    if (cancel) {
      await page.getByRole('button', { name: 'Cancel recording' }).click()
      await expect(send).toBeEnabled()
      await send.click()
      await expect
        .poll(
          async () =>
            (await post(request, endpoint, 'inspect', scope)).submissions
              .length,
        )
        .toBe(1)
      expect(
        (await post(request, endpoint, 'inspect', scope)).submissions[0].parts,
      ).toEqual([{ type: 'text', text: 'Caption with recording' }])
      return
    }
    await expect(page.getByText('Recording 0:01')).toBeVisible()
    await page.getByRole('button', { name: 'Stop recording' }).click()
    await expect(page.getByText('Saving recording for review…')).toBeVisible()
    await expect(send).toBeDisabled()
    await input.press('Enter')
    await input.evaluate((element) => element.closest('form')!.requestSubmit())
    expect(
      (await post(request, endpoint, 'inspect', scope)).submissions,
    ).toHaveLength(0)
    await page.getByRole('button', { name: 'Allow media storage' }).click()
    await expect(page.locator('.pending-media audio')).toBeVisible()
    await expect(send).toBeEnabled()
    await send.click()
    await expect
      .poll(
        async () =>
          (await post(request, endpoint, 'inspect', scope)).submissions.length,
      )
      .toBe(1)
    const parts = (await post(request, endpoint, 'inspect', scope))
      .submissions[0].parts
    expect(parts[0]).toEqual({ type: 'text', text: 'Caption with recording' })
    expect(parts[1].purpose).toBe('voice_note')
  })

for (const simulated of [true, false])
  test(`preparation renders truthful ${simulated ? 'fixture' : 'service'} provenance`, async ({
    page,
    request,
  }) => {
    const { endpoint, target } = await setup(page, request)
    const audio = await upload(
      request,
      endpoint,
      target,
      Buffer.from('voice'),
      'voice_note',
      'voice.webm',
      'audio/webm',
    )
    await post(request, endpoint, 'submit', {
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
    if (!simulated)
      await page.route(`${endpoint}/conversations/snapshot`, async (route) => {
        const response = await route.fetch()
        if (response.headers()['content-type']?.includes('application/json')) {
          const body = (await response.text())
            .replaceAll(
              '"provider":"fixture:spokenly"',
              '"provider":"spokenly-cli"',
            )
            .replaceAll('"simulated":true', '"simulated":false')
          await route.fulfill({ response, body })
        } else await route.fulfill({ response })
      })
    await page.reload()
    await expect(
      page.getByText(
        simulated
          ? /Simulated preparation · fixture:spokenly/
          : /Preparation · spokenly-cli/,
      ),
    ).toBeVisible()
    if (!simulated)
      await expect(page.getByText(/Simulated preparation/)).toHaveCount(0)
    await expect(
      page.getByRole('region', { name: 'Voice preparation' }),
    ).toContainText('Derived from voice note 1')
  })
