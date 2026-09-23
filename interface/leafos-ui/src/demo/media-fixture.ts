import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  PreviewData,
  Artifact,
  Message,
  Preparation,
} from '../features/chat/model.js'
import type { UploadIntent, UploadReceipt } from '../data/media.js'
import { targetIdentity } from '../data/media.js'
import type { ConversationTarget } from '../data/conversations.js'
/** Binary transport simulation only. No filesystem, Core storage or speech provider. */
export function mediaFixture(
  data: PreviewData,
  caller: () => string,
  changed: (message: Message) => void,
  prepared: (message: Message) => void,
) {
  const uploads = new Map<
    string,
    Extract<UploadReceipt, { status: 'accepted' }>
  >()
  const contents = new Map<string, Buffer>()
  const access = new Map<string, { callerId: string; chatId: string }>()
  let scenario = { upload: 'normal', preparation: 'success', delay: 300 }
  const deliveries: UploadIntent[] = []
  const valid = (t: ConversationTarget) =>
    t &&
    t.installationId === data.installationId &&
    t.callerId === caller() &&
    data.chatsById[t.chatId]?.participantIds.includes(t.callerId) &&
    targetIdentity({ ...t, context: data.chatsById[t.chatId].context }) ===
      targetIdentity(t) &&
    (!t.threadId || data.threadsById[t.threadId]?.chatId === t.chatId)
  const key = (i: UploadIntent) =>
    JSON.stringify([i.target.callerId, i.uploadId])
  function prepare(message: Message) {
    const voices = message.parts.flatMap((part, partIndex) =>
      part.type === 'file' && part.purpose === 'voice_note'
        ? [
            {
              id: `preparation:${message.id}:${partIndex}`,
              artifactId: part.artifactId,
              partIndex,
              revision: 1,
              status: 'preparing' as const,
              provider: 'fixture:spokenly',
              simulated: true,
            },
          ]
        : [],
    )
    if (!voices.length) return
    message.preparation = voices
    const outcome = scenario.preparation
    if (outcome !== 'manual')
      setTimeout(() => finish(message, outcome), scenario.delay)
  }
  function finish(message: Message, outcome: string) {
    if (!message.preparation) return
    const wasPreparing = message.preparation.some(
      (p) => p.status === 'preparing',
    )
    message.preparation = message.preparation.map((p) => ({
      ...p,
      revision: p.revision + 1,
      status: (outcome === 'success'
        ? 'succeeded'
        : outcome === 'no-speech'
          ? 'no-speech'
          : outcome === 'unavailable'
            ? 'unavailable'
            : 'failed') as Preparation['status'],
      ...(outcome === 'success'
        ? { transcript: 'Synthetic voice-note transcript for the fixture.' }
        : outcome === 'no-speech'
          ? { transcript: '' }
          : {
              error:
                'This message includes a voice note; automatic transcription is unavailable after a bounded fixture attempt.',
            }),
    }))
    message.revision = (message.revision ?? 0) + 1
    if (wasPreparing) prepared(message)
    changed(message)
  }
  function register(
    name: string,
    mimeType: string,
    bytes: Buffer,
    target: ConversationTarget,
    ownership: Artifact['ownership'],
    kind: 'generated' | 'published',
  ) {
    const id = crypto.randomUUID()
    const artifact: Artifact = {
      id,
      name,
      mimeType,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      revision: 1,
      availability: 'registered',
      ownership,
      provenance: { kind, authorId: 'ari' },
    }
    data.artifactsById[id] = artifact
    contents.set(id, Buffer.from(bytes))
    access.set(id, { callerId: target.callerId, chatId: target.chatId })
    return artifact
  }
  async function serve(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    url: URL,
  ) {
    const send = (value: unknown, status = 200) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(value))
    }
    try {
      if (path === '/capabilities')
        return send({ maxUploadBytes: 16 * 1024 * 1024 })
      if (path === '/scenario' && req.method === 'POST') {
        let body = ''
        for await (const chunk of req) body += chunk
        const value = JSON.parse(body)
        if (!valid(value.target))
          return send({ error: 'Context unavailable' }, 403)
        scenario = { ...scenario, ...value.scenario }
        if (value.messageId) {
          const message = data.messagesById[value.messageId]
          if (
            message &&
            data.threadsById[message.threadId]?.chatId === value.target.chatId
          )
            finish(message, value.outcome)
        }
        if (value.artifactId && data.artifactsById[value.artifactId]) {
          const a = data.artifactsById[value.artifactId]
          a.availability = value.availability ?? 'missing'
          a.revision = (a.revision ?? 0) + 1
          if (value.removeContent) contents.delete(a.id)
        }
        if (value.generated) {
          const personal = register(
            'generated-checklist.txt',
            'text/plain',
            Buffer.from('Synthetic generated checklist\n'),
            value.target,
            { kind: 'agent', id: 'ari' },
            'generated',
          )
          const publication = register(
            'published-checklist.txt',
            'text/plain',
            contents.get(personal.id)!,
            value.target,
            { kind: 'organization', id: value.target.context.organizationId },
            'published',
          )
          return send({ artifacts: [personal, publication] })
        }
        return send({ scenario })
      }
      const intent = url.searchParams.has('intent')
        ? (JSON.parse(url.searchParams.get('intent')!) as UploadIntent)
        : undefined
      const target =
        intent?.target ?? JSON.parse(url.searchParams.get('target') ?? 'null')
      if (!valid(target)) return send({ error: 'Context unavailable' }, 403)
      if (path === '/inspect')
        return send({ uploads: [...uploads.values()], deliveries })
      const uploadMatch = path.match(/^\/uploads\/([^/]+)$/)
      if (uploadMatch) {
        const uploadId = decodeURIComponent(uploadMatch[1])
        const receiptKey = JSON.stringify([target.callerId, uploadId])
        if (req.method === 'GET')
          return send(
            uploads.get(receiptKey) ?? { status: 'unknown', uploadId },
          )
        if (
          req.method !== 'PUT' ||
          !intent ||
          intent.uploadId !== uploadId ||
          !intent.name ||
          !['attachment', 'voice_note'].includes(intent.purpose) ||
          !Number.isSafeInteger(intent.size) ||
          intent.size < 0 ||
          intent.size > 16 * 1024 * 1024
        )
          return send({ error: 'Invalid upload' }, 400)
        deliveries.push(structuredClone(intent))
        const chunks: Buffer[] = []
        let length = 0
        for await (const chunk of req) {
          length += chunk.length
          if (length > 16 * 1024 * 1024)
            return send({ error: 'Fixture upload limit' }, 413)
          chunks.push(Buffer.from(chunk))
        }
        const prior = uploads.get(receiptKey)
        if (prior) return send(prior)
        const bytes = Buffer.concat(chunks)
        if (
          bytes.length !== intent.size ||
          createHash('sha256').update(bytes).digest('hex') !== intent.sha256
        )
          return send({ error: 'Byte integrity mismatch' }, 400)
        const behavior = scenario.upload
        if (behavior === 'fail')
          return send({ error: 'Synthetic upload failure' }, 503)
        if (behavior === 'slow')
          await new Promise((resolve) => setTimeout(resolve, scenario.delay))
        // Re-check after asynchronous staging: simultaneous retries finalize only once.
        const raced = uploads.get(receiptKey)
        if (raced) return send(raced)
        const id = crypto.randomUUID()
        const artifact: Artifact = {
          id,
          name: intent.name,
          size: bytes.length,
          mimeType: intent.mimeType,
          sha256: intent.sha256,
          availability: 'registered',
          revision: 1,
          ownership: { kind: 'fixture-unassigned' },
          provenance: { kind: 'upload', authorId: target.callerId },
        }
        const receipt = {
          status: 'accepted' as const,
          intent: structuredClone(intent),
          artifact,
        }
        contents.set(id, bytes)
        access.set(id, { callerId: target.callerId, chatId: target.chatId })
        data.artifactsById[id] = artifact
        uploads.set(key(intent), receipt)
        if (behavior === 'lost-ack') {
          res.destroy()
          return
        }
        return send(receipt)
      }
      const artifactMatch = path.match(/^\/artifacts\/([^/]+)(\/content)?$/)
      if (artifactMatch) {
        const id = decodeURIComponent(artifactMatch[1])
        const a = data.artifactsById[id]
        const bound = access.get(id)
        if (
          !a ||
          bound?.callerId !== target.callerId ||
          bound?.chatId !== target.chatId
        )
          return send({ error: 'File unavailable' }, 404)
        if (!artifactMatch[2]) return send(a)
        const bytes = contents.get(id)
        if (!bytes || a.availability !== 'registered')
          return send({ error: 'File content unavailable' }, 404)
        res.setHeader('Content-Type', 'application/octet-stream')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Disposition', 'attachment')
        res.setHeader('Cache-Control', 'no-store')
        res.end(bytes)
        return
      }
      send({ error: 'Unsupported media operation' }, 404)
    } catch {
      send({ error: 'Invalid media request' }, 400)
    }
  }
  return {
    serve,
    prepare,
    available(id: string, target: ConversationTarget) {
      const a = data.artifactsById[id]
      const bound = access.get(id)
      return (
        a?.availability === 'registered' &&
        contents.has(id) &&
        bound?.callerId === target.callerId &&
        bound?.chatId === target.chatId
      )
    },
  }
}
