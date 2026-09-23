import { emptyWork, type WorkRecords } from './work.js'
import { ConversationError } from './conversations.js'
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const states = [
  'preparing',
  'queued',
  'running',
  'waiting',
  'held',
  'cancellation-requested',
  'cancelled',
  'completed',
  'failed',
  'recovery-needed',
]
export function parseWork(value: unknown): WorkRecords {
  const invalid = (): never => {
    throw new ConversationError(
      'Work response is invalid or incompatible.',
      'malformed',
    )
  }
  if (value === undefined) return emptyWork()
  if (!object(value)) return invalid()
  for (const key of Object.keys(emptyWork())) {
    const list = value[key]
    if (!Array.isArray(list)) return invalid()
    for (const item of list) {
      if (
        !object(item) ||
        !text(item.id) ||
        !Number.isSafeInteger(item.revision) ||
        !object(item.target)
      )
        return invalid()
      const t = item.target
      if (
        ![t.installationId, t.callerId, t.chatId, t.threadId].every(text) ||
        !object(t.context) ||
        !(t.context.kind === 'organization'
          ? text(t.context.organizationId)
          : t.context.kind === 'installation' && text(t.context.installationId))
      )
        return invalid()
      if (
        ['workflows', 'runs', 'attempts', 'activity', 'delegations'].includes(
          key,
        ) &&
        !states.includes(String(item.state))
      )
        return invalid()
      if (
        ['workflows', 'queue'].includes(key) &&
        (!Array.isArray(item.actions) ||
          !item.actions.every(
            (a) =>
              object(a) &&
              [
                'stop',
                'resume',
                'retry',
                'cancel-queued',
                'steer',
                'respond',
              ].includes(String(a.action)) &&
              typeof a.allowed === 'boolean' &&
              typeof a.reason === 'string',
          ))
      )
        return invalid()
      if (
        key === 'workflows' &&
        (![item.runId, item.attemptId].every(text) ||
          typeof item.held !== 'boolean' ||
          typeof item.reason !== 'string')
      )
        return invalid()
      if (
        key === 'queue' &&
        (!text(item.messageId) ||
          typeof item.text !== 'string' ||
          !Number.isSafeInteger(item.acceptanceOrder) ||
          !['queued', 'held', 'consumed', 'cancelled'].includes(
            String(item.state),
          ))
      )
        return invalid()
      if (
        key === 'activity' &&
        (![
          item.runId,
          item.attemptId,
          item.actorId,
          item.createdAt,
          item.text,
        ].every(text) ||
          !Number.isSafeInteger(item.order) ||
          !Number.isFinite(Date.parse(String(item.createdAt))))
      )
        return invalid()
      if (
        key === 'delegations' &&
        ![
          item.runId,
          item.attemptId,
          item.fromAgentId,
          item.toAgentId,
          item.childRunId,
          item.createdAt,
        ].every(text)
      )
        return invalid()
      if (
        key === 'runs' &&
        ![item.originMessageId, item.currentAttemptId].every(text)
      )
        return invalid()
      if (
        key === 'attempts' &&
        (!text(item.runId) ||
          !Number.isSafeInteger(item.number) ||
          !text(item.startedAt) ||
          !Number.isFinite(Date.parse(item.startedAt)))
      )
        return invalid()
      if (key === 'interactions') {
        if (
          item.version !== 1 ||
          !['question', 'approval'].includes(String(item.kind)) ||
          ![item.runId, item.attemptId, item.sourceAgentId, item.prompt].every(
            text,
          ) ||
          typeof item.freeText !== 'boolean' ||
          !['pending', 'settled', 'cancelled', 'superseded'].includes(
            String(item.state),
          ) ||
          !['waiting', 'ready', 'recovery-needed', 'cancelled'].includes(
            String(item.continuation),
          ) ||
          typeof item.reason !== 'string' ||
          !Array.isArray(item.options) ||
          item.options.length > 5 ||
          !item.options.every(
            (o) => object(o) && text(o.id) && text(o.label),
          ) ||
          new Set(item.options.map((o) => o.id)).size !== item.options.length
        )
          return invalid()
        if (item.kind === 'approval' && !text(item.proposalId)) return invalid()
        if (
          item.response !== undefined &&
          (!object(item.response) ||
            ![
              item.response.operationId,
              item.response.actorId,
              item.response.acceptedAt,
            ].every(text) ||
            !object(item.response.answer) ||
            !['choice', 'text', 'dismiss', 'approve', 'decline'].includes(
              String(item.response.answer.kind),
            ))
        )
          return invalid()
      }
      if (key === 'interactions' && object(item.response)) {
        const answer = item.response.answer as Record<string, unknown>
        if (
          (answer.kind === 'text' && typeof answer.text !== 'string') ||
          (answer.kind === 'choice' && !text(answer.optionId)) ||
          (answer.text !== undefined && typeof answer.text !== 'string') ||
          (answer.comment !== undefined && typeof answer.comment !== 'string')
        )
          return invalid()
      }
      if (key === 'interactions' && item.state === 'settled' && !item.response)
        return invalid()
    }
  }
  return value as unknown as WorkRecords
}
