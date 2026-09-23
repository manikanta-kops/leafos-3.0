import { parseSettingsRecords } from './settings-validation.js'
import { parseArtifact } from './media.js'
import { parseWork } from './work-validation.js'
import {
  ConversationError,
  type ConversationClient,
  type Records,
  type Receipt,
  type CallerScope,
} from './conversations.js'
import type { Chat, ContentPart } from '../features/chat/model.js'
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0
function invalid(): never {
  throw new ConversationError(
    'The conversation response is invalid or incompatible.',
    'malformed',
  )
}
export function parseChat(v: unknown): Chat {
  if (
    !object(v) ||
    !text(v.id) ||
    v.kind !== 'direct' ||
    !Array.isArray(v.participantIds) ||
    !v.participantIds.every(text) ||
    !object(v.context) ||
    !(v.context.kind === 'organization'
      ? text(v.context.organizationId)
      : v.context.kind === 'installation' && text(v.context.installationId))
  )
    return invalid()
  return v as unknown as Chat
}
export function parseRecords(v: unknown): Records {
  if (
    !object(v) ||
    !['chats', 'threads', 'messages', 'artifacts'].every((k) =>
      Array.isArray(v[k]),
    )
  )
    return invalid()
  const chats = (v.chats as unknown[]).map(parseChat)
  const threads = (v.threads as unknown[]).map((t) => {
    if (
      !object(t) ||
      ![t.id, t.chatId, t.rootMessageId, t.title].every(text) ||
      !Number.isSafeInteger(t.revision) ||
      !Array.isArray(t.messageIds) ||
      !t.messageIds.every(text) ||
      !Number.isSafeInteger(t.replyCount) ||
      !Array.isArray(t.participantIds) ||
      !t.participantIds.every(text) ||
      !text(t.lastMessageAt) ||
      !Number.isFinite(Date.parse(t.lastMessageAt))
    )
      return invalid()
    return t
  })
  const messages = (v.messages as unknown[]).map((m) => {
    if (
      !object(m) ||
      ![m.id, m.threadId, m.authorId, m.createdAt].every(text) ||
      !Number.isFinite(Date.parse(String(m.createdAt))) ||
      !Number.isSafeInteger(m.revision) ||
      !['draft', 'final'].includes(String(m.status)) ||
      !Array.isArray(m.parts)
    )
      return invalid()
    const parts: ContentPart[] = m.parts.map((p) => {
      if (!object(p) || !text(p.type)) return invalid()
      if (p.type === 'text') {
        if (typeof p.text !== 'string') return invalid()
        return { type: 'text', text: p.text }
      }
      if (p.type === 'file') {
        if (!text(p.artifactId)) return invalid()
        if (
          p.purpose !== undefined &&
          !['attachment', 'voice_note'].includes(String(p.purpose))
        )
          return invalid()
        return {
          type: 'file',
          artifactId: p.artifactId,
          purpose: p.purpose as 'attachment' | 'voice_note' | undefined,
        }
      }
      if (p.type === 'local-file') {
        if (
          !object(p.file) ||
          !text(p.file.id) ||
          !text(p.file.name) ||
          typeof p.file.size !== 'number' ||
          p.file.size < 0
        )
          return invalid()
        return {
          type: 'local-file',
          file: p.file as unknown as Extract<
            ContentPart,
            { type: 'local-file' }
          >['file'],
        }
      }
      return {
        type: 'unknown',
        originalKind:
          p.type === 'unknown' && text(p.originalKind)
            ? p.originalKind
            : p.type,
      }
    })
    if (
      m.preparation !== undefined &&
      (!Array.isArray(m.preparation) ||
        !m.preparation.every(
          (p) =>
            object(p) &&
            text(p.id) &&
            text(p.artifactId) &&
            Number.isSafeInteger(p.partIndex) &&
            Number.isSafeInteger(p.revision) &&
            [
              'preparing',
              'succeeded',
              'no-speech',
              'failed',
              'unavailable',
            ].includes(String(p.status)) &&
            text(p.provider) &&
            p.provider.trim().length > 0 &&
            (p.simulated === undefined || typeof p.simulated === 'boolean') &&
            Number(p.revision) >= 0 &&
            (p.transcript === undefined || typeof p.transcript === 'string') &&
            (p.error === undefined || typeof p.error === 'string') &&
            parts[Number(p.partIndex)]?.type === 'file' &&
            (parts[Number(p.partIndex)] as { artifactId: string })
              .artifactId === p.artifactId,
        ))
    )
      return invalid()
    return { ...m, parts }
  })
  if (
    !(v.artifacts as unknown[]).every(
      (a) =>
        object(a) &&
        text(a.id) &&
        text(a.name) &&
        typeof a.size === 'number' &&
        [
          'local-preview',
          'registered',
          'missing',
          'deleted',
          'failed',
        ].includes(String(a.availability)),
    )
  )
    return invalid()
  return {
    ...parseSettingsRecords(v),
    work: parseWork(v.work),
    chats,
    threads,
    messages,
    artifacts: (v.artifacts as unknown[]).map(parseArtifact),
  } as unknown as Records
}
function parseReceipt(v: unknown, id: string): Receipt {
  if (!object(v) || v.submissionId !== id) return invalid()
  if (v.status === 'unknown') return { status: 'unknown', submissionId: id }
  if (v.status === 'rejected' && text(v.code) && text(v.message))
    return v as unknown as Receipt
  if (
    v.status !== 'accepted' ||
    !text(v.threadId) ||
    !text(v.messageId) ||
    !object(v.target) ||
    !text(v.target.chatId) ||
    !text(v.target.installationId) ||
    !text(v.target.callerId)
  )
    return invalid()
  const records = parseRecords(v.records)
  if (
    !records.messages.some(
      (m) => m.id === v.messageId && m.threadId === v.threadId,
    ) ||
    !records.threads.some(
      (t) =>
        t.id === v.threadId &&
        t.chatId === (v.target as Record<string, unknown>).chatId,
    )
  )
    return invalid()
  return { ...v, records } as unknown as Receipt
}
export function createConversationClient(endpoint: string): ConversationClient {
  async function request(
    path: string,
    data: unknown,
    signal: AbortSignal,
    method = 'POST',
  ) {
    const response = await fetch(`${endpoint}/conversations${path}`, {
      method,
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
    })
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      throw new ConversationError(
        typeof error.message === 'string'
          ? error.message
          : `Conversation unavailable (HTTP ${response.status}).`,
        typeof error.code === 'string' ? error.code : 'unavailable',
      )
    }
    return response.json() as Promise<unknown>
  }
  const params = (scope: CallerScope, threadId: string | null) =>
    new URLSearchParams({ ...scope, ...(threadId ? { threadId } : {}) })
  return {
    async resolve(scope, agentId, context, signal) {
      const chat = parseChat(
        await request('/resolve', { ...scope, agentId, context }, signal),
      )
      if (
        chat.participantIds.length !== 2 ||
        !chat.participantIds.includes(scope.callerId) ||
        !chat.participantIds.includes(agentId) ||
        JSON.stringify(chat.context) !== JSON.stringify(context)
      )
        return invalid()
      return chat
    },
    async history(target, before, signal) {
      const v = await request('/history', { target, before, limit: 20 }, signal)
      if (!object(v) || !(v.next === null || text(v.next))) return invalid()
      const records = parseRecords(v)
      if (
        records.threads.some(
          (t) =>
            t.chatId !== target.chatId ||
            (target.threadId && t.id !== target.threadId),
        )
      )
        return invalid()
      return { ...records, next: v.next }
    },
    async submit(submission, signal) {
      return parseReceipt(
        await request('/submit', submission, signal),
        submission.submissionId,
      )
    },
    async receipt(scope, id, signal) {
      return parseReceipt(
        await request('/receipt', { ...scope, submissionId: id }, signal),
        id,
      )
    },
    async snapshot(scope, threadId, signal) {
      const v = await request('/snapshot', { ...scope, threadId }, signal)
      if (
        !object(v) ||
        !text(v.cursor) ||
        !text(v.domain) ||
        !Number.isSafeInteger(v.sequence)
      )
        return invalid()
      return {
        ...parseRecords(v),
        cursor: v.cursor,
        sequence: v.sequence as number,
        domain: v.domain,
      }
    },
    async events(scope, threadId, cursor, signal, apply) {
      const query = params(scope, threadId)
      query.set('cursor', cursor)
      const response = await fetch(
        `${endpoint}/conversations/events?${query}`,
        {
          signal,
          cache: 'no-store',
          headers: { Accept: 'text/event-stream' },
        },
      )
      if (response.status === 409)
        throw new ConversationError(
          'Conversation history needs refreshing.',
          'cursor-expired',
        )
      if (!response.ok || !response.body)
        throw new ConversationError('Live connection unavailable.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer = (buffer + decoder.decode(value, { stream: true })).replace(
            /\r\n/g,
            '\n',
          )
          if (buffer.length > 2_000_000) return invalid()
          let end: number
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            const line = frame
              .split('\n')
              .filter((part) => part.startsWith('data:'))
              .map((part) => part.slice(5).trimStart())
              .join('\n')
            if (!line.trim()) continue
            let v: unknown
            try {
              v = JSON.parse(line)
            } catch {
              return invalid()
            }
            if (
              !object(v) ||
              !text(v.cursor) ||
              !text(v.domain) ||
              !Number.isSafeInteger(v.sequence) ||
              !text(v.eventId)
            )
              return invalid()
            apply({
              ...parseRecords(v),
              cursor: v.cursor,
              sequence: v.sequence as number,
              domain: v.domain,
              eventId: v.eventId,
            })
          }
        }
      } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      if (!signal.aborted)
        throw new ConversationError('Live connection interrupted.')
    },
  }
}
