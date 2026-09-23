import { settingsFixture } from './settings-fixture.js'
import { mediaFixture } from './media-fixture.js'
import { workFixture } from './work-fixture.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkspaceSnapshot } from '../data/workspace-client.js'
import type {
  PreviewData,
  Chat,
  Message,
  Thread,
} from '../features/chat/model.js'
import { findDirectChat } from '../features/chat/model.js'
import {
  emptyRecords,
  type Records,
  type Receipt,
  type Submission,
  type ConversationEvent,
} from '../data/conversations.js'

/** Process-memory transport fixture; receipts do not survive a fixture restart. */
export function conversationFixture(
  state: WorkspaceSnapshot,
  initial: PreviewData,
) {
  const data = initial
  let sequence = 0
  const epoch = crypto.randomUUID()
  const events: ConversationEvent[] = []
  const listeners = new Set<() => void>()
  const receipts = new Map<string, Receipt>()
  const submissions: Submission[] = []
  const deliveries: Submission[] = []
  for (const thread of Object.values(data.threadsById)) enrich(thread)
  for (const message of Object.values(data.messagesById)) {
    message.revision = 1
    message.status = 'final'
  }
  function enrich(thread: Thread) {
    thread.revision = (thread.revision ?? 0) + 1
    thread.replyCount = thread.messageIds.length - 1
    thread.participantIds = [
      ...new Set(thread.messageIds.map((id) => data.messagesById[id].authorId)),
    ]
    thread.lastMessageAt =
      data.messagesById[thread.messageIds.at(-1)!].createdAt
  }
  function records(threads: Thread[], messages?: Message[]): Records {
    return {
      chats: Object.values(data.chatsById).filter((c) =>
        threads.some((t) => t.chatId === c.id),
      ),
      threads,
      messages:
        messages ??
        threads.flatMap((t) => t.messageIds.map((id) => data.messagesById[id])),
      artifacts: Object.values(data.artifactsById),
      work: work.projection(threads.map((t) => t.id)),
    }
  }
  const domain = (threadId: string | null) =>
    threadId ? `thread:${threadId}` : 'application'
  const cursor = (n: number) => `${epoch}:${n}`
  function publish(value: Records) {
    const added = settings.observe(value)
    value = {
      ...value,
      notifications: [...(value.notifications ?? []), ...added],
      attention: added.map((n) => n.id),
    }
    events.push({
      ...structuredClone(value),
      domain: 'application',
      cursor: cursor(++sequence),
      sequence,
      eventId: crypto.randomUUID(),
    })
    if (events.length > 200) events.shift()
    for (const listener of listeners) listener()
  }
  const settings = settingsFixture(state, data, publish)
  const work = workFixture(
    data,
    publish,
    () => state.currentHumanId,
    settings.execution,
  )
  const media = mediaFixture(
    data,
    () => state.currentHumanId,
    (message) =>
      publish(records([data.threadsById[message.threadId]], [message])),
    (message) => work.preparedMessage(message),
  )
  const launch = Object.values(data.threadsById).find(
    (t) => t.title === 'Launch plan',
  )
  if (launch) {
    work.seed(launch.id, 'waiting')
    settings.observe({ ...emptyRecords(), work: work.projection([launch.id]) })
  }
  return async function serve(
    req: IncomingMessage,
    res: ServerResponse,
    path: string,
    url: URL,
  ) {
    if (path.startsWith('/media/'))
      return media.serve(req, res, path.slice(6), url)
    const send = (value: unknown, status = 200) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      res.end(JSON.stringify(value))
    }
    const fail = (message: string, code = 'invalid-request') =>
      send({ message, code }, 400)
    const scope = (v: { installationId?: unknown; callerId?: unknown }) =>
      v.installationId === state.installationId &&
      v.callerId === state.currentHumanId
    if (path === '/events' && req.method === 'GET') {
      if (!scope(Object.fromEntries(url.searchParams)))
        return fail('Caller changed.')
      const boundCaller = url.searchParams.get('callerId')
      const threadId = url.searchParams.get('threadId')
      const after = url.searchParams.get('cursor') ?? ''
      let last = Number(after.split(':').at(-1))
      if (
        !after.startsWith(`${epoch}:`) ||
        !Number.isSafeInteger(last) ||
        last > sequence ||
        (events.length && last < Number(events[0].cursor.split(':').at(-1)) - 1)
      )
        return send({ code: 'cursor-expired' }, 409)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      })
      let replay = true
      const flush = () => {
        if (boundCaller !== state.currentHumanId) {
          res.end()
          return
        }
        for (const event of events) {
          const n = Number(event.cursor.split(':').at(-1))
          if (n <= last) continue
          last = n
          const selected = threadId
            ? event.threads.filter((t) => t.id === threadId)
            : event.threads
          res.write(
            'data: ' +
              JSON.stringify({
                ...event,
                ...(threadId
                  ? {
                      ...event,
                      threads: selected,
                      messages: event.messages.filter(
                        (m) => m.threadId === threadId,
                      ),
                    }
                  : {}),
                messages: event.messages.filter((m) =>
                  threadId
                    ? m.threadId === threadId
                    : event.threads.some((t) => t.rootMessageId === m.id),
                ),
                work: event.work
                  ? Object.fromEntries(
                      Object.entries(event.work).map(([key, list]) => [
                        key,
                        list.filter((item: { target: { threadId: string } }) =>
                          threadId
                            ? item.target.threadId === threadId
                            : key === 'workflows',
                        ),
                      ]),
                    )
                  : undefined,
                notifications: threadId
                  ? []
                  : event.notifications?.filter(
                      (n) => n.recipientId === boundCaller,
                    ),
                attention: replay || threadId ? [] : event.attention,
                domain: domain(threadId),
              }) +
              '\n\n',
          )
        }
      }
      listeners.add(flush)
      flush()
      replay = false
      res.write(': heartbeat\n\n')
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 10000)
      req.on('close', () => {
        clearInterval(heartbeat)
        listeners.delete(flush)
      })
      return
    }
    try {
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (body.length > 200000) return fail('Request too large.')
      }
      const v = JSON.parse(body)
      if (!scope(v.target ?? v))
        return fail('The installation or caller changed.', 'context-changed')
      if (path.startsWith('/settings/'))
        return send(settings.serve(path.slice(10), v))
      if (path === '/work/command') return send(work.command(v))
      if (path === '/work/receipt') return send(work.receipt(v))
      if (path === '/work/scenario')
        return send(work.scenario(v.threadId, v.scenario, v.attemptId))
      if (path === '/work/inspect') return send(work.inspect())
      if (path === '/set-caller') {
        if (typeof v.nextCaller !== 'string' || !v.nextCaller)
          return fail('Caller required.')
        state.currentHumanId = v.nextCaller
        state.actorsById[v.nextCaller] = {
          id: v.nextCaller,
          kind: 'human',
          name: 'Fixture caller',
        }
        for (const org of state.organizations)
          if (
            !state.memberships.some(
              (m) => m.actorId === v.nextCaller && m.organizationId === org.id,
            )
          )
            state.memberships.push({
              id: crypto.randomUUID(),
              actorId: v.nextCaller,
              organizationId: org.id,
            })
        for (const listener of listeners) listener()
        return send({ callerId: v.nextCaller })
      }
      if (path === '/resolve') {
        if (state.actorsById[v.agentId]?.kind !== 'agent')
          return fail('Agent unavailable.')
        const context = v.context
        if (context?.kind === 'organization') {
          if (
            !state.memberships.some(
              (m) =>
                m.organizationId === context.organizationId &&
                m.actorId === v.agentId,
            )
          )
            return fail('Agent membership unavailable.')
        } else if (
          context?.kind !== 'installation' ||
          context.installationId !== state.installationId
        )
          return fail('Context unavailable.')
        let chat = findDirectChat(data, v.callerId, v.agentId, context)
        if (!chat) {
          chat = {
            id: crypto.randomUUID(),
            kind: 'direct',
            participantIds: [v.callerId, v.agentId],
            context,
          }
          data.chatsById[chat.id] = chat
          publish({ ...emptyRecords(), chats: [chat] })
        }
        return send(chat)
      }
      if (path === '/receipt')
        return send(
          receipts.get(JSON.stringify([v.callerId, v.submissionId])) ?? {
            status: 'unknown',
            submissionId: v.submissionId,
          },
        )
      if (path === '/snapshot') {
        const threads = Object.values(data.threadsById).filter(
          (t) =>
            data.chatsById[t.chatId]?.participantIds.includes(v.callerId) &&
            (!v.threadId || t.id === v.threadId),
        )
        // Application snapshots contain summaries and root bodies only; detailed history is paged.
        const selected = v.threadId ? threads : threads
        const messages = v.threadId
          ? selected.flatMap((t) =>
              [t.rootMessageId, ...t.messageIds.slice(1).slice(-20)].map(
                (id) => data.messagesById[id],
              ),
            )
          : Object.values(data.chatsById).flatMap((c) =>
              selected
                .filter((t) => t.chatId === c.id)
                .slice(-20)
                .map((t) => data.messagesById[t.rootMessageId]),
            )
        return send({
          ...records(selected, messages),
          ...(v.threadId
            ? {}
            : {
                settings: settings.projection(v.callerId).settings,
                effective: settings.projection(v.callerId).effective,
                notifications: settings.projection(v.callerId).notifications,
              }),
          chats: Object.values(data.chatsById).filter((c) =>
            c.participantIds.includes(v.callerId),
          ),
          work: work.projection(
            selected.map((t) => t.id),
            !!v.threadId,
          ),
          domain: domain(v.threadId),
          cursor: cursor(sequence),
          sequence,
        })
      }
      if (path === '/history') {
        const chat = data.chatsById[v.target.chatId]
        if (
          !chat ||
          !chat.participantIds.includes(v.target.callerId) ||
          JSON.stringify(chat.context) !== JSON.stringify(v.target.context)
        )
          return fail('Chat unavailable.')
        const limit = Math.min(20, Math.max(1, Number(v.limit) || 20))
        if (v.target.threadId) {
          const thread = data.threadsById[v.target.threadId]
          if (!thread || thread.chatId !== chat.id)
            return fail('Thread unavailable.')
          const all = thread.messageIds.slice(1)
          const end = v.before ? all.indexOf(v.before) : all.length
          if (end < 0) return fail('History cursor unavailable.')
          const ids = all.slice(Math.max(0, end - limit), end)
          return send({
            ...records(
              [thread],
              [
                data.messagesById[thread.rootMessageId],
                ...ids.map((id) => data.messagesById[id]),
              ],
            ),
            next: end > limit ? ids[0] : null,
          })
        }
        const all = Object.values(data.threadsById)
          .filter((t) => t.chatId === chat.id)
          .sort(
            (a, b) =>
              data.messagesById[a.rootMessageId].createdAt.localeCompare(
                data.messagesById[b.rootMessageId].createdAt,
              ) || a.id.localeCompare(b.id),
          )
        const end = v.before
          ? all.findIndex((t) => t.id === v.before)
          : all.length
        if (end < 0) return fail('History cursor unavailable.')
        const selected = all.slice(Math.max(0, end - limit), end)
        return send({
          ...records(
            selected,
            selected.map((t) => data.messagesById[t.rootMessageId]),
          ),
          chats: [chat],
          next: end > limit ? selected[0].id : null,
        })
      }
      if (path === '/submit') {
        const submission = v as Submission
        if (!submission.submissionId || !Array.isArray(submission.parts))
          return fail('Invalid submission.')
        deliveries.push(structuredClone(submission))
        const prior = receipts.get(
          JSON.stringify([v.target.callerId, submission.submissionId]),
        )
        if (prior)
          return send({
            ...prior,
            ...(prior.status === 'accepted' ? { alreadyAccepted: true } : {}),
          })
        const chat: Chat | undefined = data.chatsById[submission.target.chatId]
        const reject = (message: string) => {
          const receipt: Receipt = {
            status: 'rejected',
            submissionId: submission.submissionId,
            code: 'target-unavailable',
            message,
          }
          receipts.set(
            JSON.stringify([v.target.callerId, submission.submissionId]),
            receipt,
          )
          return send(receipt)
        }
        if (
          !chat ||
          !chat.participantIds.includes(v.target.callerId) ||
          JSON.stringify(chat.context) !== JSON.stringify(v.target.context)
        )
          return reject('The captured conversation is unavailable.')
        if (chat.context.kind === 'organization') {
          const org = chat.context.organizationId
          if (
            !chat.participantIds.every((id) =>
              state.memberships.some(
                (m) => m.organizationId === org && m.actorId === id,
              ),
            )
          )
            return reject(
              'A participant no longer belongs to this organization.',
            )
        }
        let thread = submission.target.threadId
          ? data.threadsById[submission.target.threadId]
          : undefined
        if (
          submission.target.threadId &&
          (!thread || thread.chatId !== chat.id)
        )
          return reject('The captured thread is unavailable.')
        if (!submission.parts.length) return reject('Message content is empty.')
        if (
          submission.parts.some(
            (p) =>
              p.type === 'local-file' ||
              (p.type === 'file' &&
                !media.available(p.artifactId, submission.target)),
          )
        )
          return reject(
            'File bytes are unavailable. Upload originals before sending.',
          )
        const messageId = crypto.randomUUID()
        const threadId = thread?.id ?? crypto.randomUUID()
        const message: Message = {
          id: messageId,
          threadId,
          authorId: v.target.callerId,
          createdAt: new Date().toISOString(),
          parts: submission.parts,
          revision: 1,
          status: 'final',
          submissionId: submission.submissionId,
        }
        data.messagesById[messageId] = message
        if (!thread) {
          thread = {
            id: threadId,
            chatId: chat.id,
            rootMessageId: messageId,
            title:
              submission.parts
                .find((p) => p.type === 'text')
                ?.text.slice(0, 70) || 'Attachment',
            messageIds: [],
          }
          data.threadsById[threadId] = thread
        }
        thread.messageIds.push(messageId)
        enrich(thread)
        media.prepare(message)
        work.acceptedMessage(threadId, message, !submission.target.threadId)
        submissions.push(structuredClone(submission))
        const result = records(
          [thread],
          [
            data.messagesById[thread.rootMessageId],
            ...(messageId === thread.rootMessageId ? [] : [message]),
          ],
        )
        const receipt: Receipt = {
          status: 'accepted',
          submissionId: submission.submissionId,
          target: submission.target,
          threadId,
          messageId,
          records: structuredClone(result),
        }
        receipts.set(
          JSON.stringify([v.target.callerId, submission.submissionId]),
          receipt,
        )
        publish(result)
        return send(receipt)
      }
      if (path === '/inspect')
        return send({
          submissions,
          deliveries,
          receipts: [...receipts.values()],
          sequence,
        })
      if (path === '/emit') {
        // Explicit test-only controls, never surfaced as agent execution.
        for (const message of v.messages ?? [])
          data.messagesById[message.id] = message
        for (const thread of v.threads ?? [])
          data.threadsById[thread.id] = thread
        publish({
          ...emptyRecords(),
          ...v.records,
          messages: v.messages ?? [],
          threads: v.threads ?? [],
        })
        return send({ sequence })
      }
      return fail('Unsupported conversation fixture operation.')
    } catch {
      return fail('Malformed fixture request.')
    }
  }
}
