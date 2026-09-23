import { sameWorkTarget } from '../data/work-target.js'
import {
  emptyWork,
  type WorkRecords,
  type WorkTarget,
  type WorkOperation,
  type WorkReceipt,
  type Workflow,
  type WorkState,
  type Answer,
} from '../data/work.js'
import type { Records } from '../data/conversations.js'
import type { PreviewData, Message } from '../features/chat/model.js'
/** Explicit process-memory demo. It does not execute agents or external effects. */
export function workFixture(
  data: PreviewData,
  publish: (records: Records) => void,
  currentCaller: () => string,
  execution: (
    threadId: string,
  ) => NonNullable<WorkRecords['attempts'][number]['suppliedSettings']>,
) {
  const state = emptyWork()
  const receipts = new Map<string, WorkReceipt>()
  const deliveries: WorkOperation[] = []
  let order = 0
  const targets = (threadId: string): WorkTarget => {
    const thread = data.threadsById[threadId],
      chat = data.chatsById[thread.chatId]
    return {
      installationId: data.installationId,
      callerId: currentCaller(),
      chatId: chat.id,
      context: chat.context,
      threadId,
    }
  }
  function projection(threadIds: string[], detail = true): WorkRecords {
    const result = emptyWork()
    for (const key of Object.keys(result) as (keyof WorkRecords)[]) {
      if (!detail && key !== 'workflows') continue
      // Arrays retain their discriminated resource shapes at this transport boundary.
      Object.assign(result, {
        [key]: state[key].filter((x) => threadIds.includes(x.target.threadId)),
      })
    }
    return structuredClone(result)
  }
  function records(threadId: string): Records {
    return {
      chats: [],
      threads: [],
      messages: [],
      artifacts: [],
      work: projection([threadId]),
    }
  }
  function actions(work: Workflow) {
    const active = ['running', 'waiting', 'preparing', 'queued'].includes(
      work.state,
    )
    work.actions = [
      {
        action: 'stop',
        allowed: active,
        reason: active ? '' : 'No active workflow to stop.',
      },
      {
        action: 'resume',
        allowed:
          work.held &&
          ['cancelled', 'failed', 'completed'].includes(work.state),
        reason:
          work.state === 'cancellation-requested'
            ? 'Wait for cancellation to settle safely.'
            : work.held
              ? 'Release held follow-ups only after safe settlement.'
              : 'No held follow-ups.',
      },
      {
        action: 'retry',
        allowed: work.state === 'failed',
        reason:
          work.state === 'recovery-needed'
            ? 'Uncertain effects must be reconciled before retry.'
            : work.state === 'failed'
              ? 'Retry this work, then continue queued follow-ups after safe success.'
              : 'Retry requires a safely reconciled failed execution.',
      },
    ]
    for (const q of state.queue.filter(
      (q) => q.target.threadId === work.target.threadId,
    )) {
      const pending = ['queued', 'held'].includes(q.state)
      q.actions = [
        {
          action: 'cancel-queued',
          allowed: pending,
          reason: pending ? '' : 'Queue item is already settled.',
        },
        {
          action: 'steer',
          allowed:
            pending && q.readiness !== 'preparing' && work.state === 'running',
          reason:
            work.state === 'running'
              ? ''
              : 'Steering requires a supported active attempt.',
        },
      ]
      q.revision++
    }
  }
  function activity(work: Workflow, text: string, status = work.state) {
    state.activity.push({
      id: crypto.randomUUID(),
      revision: 1,
      target: work.target,
      runId: work.runId,
      attemptId: work.attemptId,
      order: ++order,
      createdAt: new Date().toISOString(),
      actorId: data.chatsById[work.target.chatId].participantIds.find(
        (id) => id !== currentCaller(),
      )!,
      text,
      state: status,
    })
  }
  function seed(threadId: string, scenario = 'waiting') {
    const target = targets(threadId)
    const existing = state.workflows.find((w) => w.target.threadId === threadId)
    if (existing) return existing
    const runId = crypto.randomUUID(),
      attemptId = crypto.randomUUID()
    const status: WorkState =
      scenario === 'failed'
        ? 'failed'
        : scenario === 'stopped'
          ? 'cancelled'
          : scenario === 'running' || scenario === 'delegated'
            ? 'running'
            : scenario === 'recovery'
              ? 'recovery-needed'
              : 'waiting'
    const work: Workflow = {
      id: `work:${threadId}`,
      revision: 1,
      target,
      runId,
      attemptId,
      state: status,
      held: ['stopped', 'failed', 'recovery'].includes(scenario),
      holdGeneration: 1,
      reason:
        scenario === 'failed'
          ? 'The provider failed after publishing output. Earlier messages are retained.'
          : scenario === 'recovery'
            ? 'Execution outcome is uncertain. Reconcile before retrying.'
            : 'Demonstration work state; no agent is executing.',
      actions: [],
    }
    state.workflows.push(work)
    state.runs.push({
      id: runId,
      revision: 1,
      target,
      originMessageId: data.threadsById[threadId].rootMessageId,
      currentAttemptId: attemptId,
      state: status,
    })
    state.attempts.push({
      id: attemptId,
      revision: 1,
      target,
      runId,
      state: status,
      number: 1,
      startedAt: new Date().toISOString(),
      suppliedSettings: execution(threadId),
    })
    activity(work, 'Reviewed the launch scope.', 'completed')
    activity(
      work,
      status === 'waiting'
        ? 'Waiting for your direction.'
        : 'Preparing the release checklist.',
      status,
    )
    if (scenario === 'delegated' || scenario === 'child')
      state.delegations.push({
        id: `delegation:${threadId}`,
        revision: 1,
        target,
        runId,
        attemptId,
        fromAgentId: 'ari',
        toAgentId: 'niko',
        childRunId: `child:${runId}`,
        request: {
          originMessageId: data.threadsById[threadId].rootMessageId,
          summary: 'Review the desktop release scope.',
        },
        state: 'waiting',
        createdAt: new Date().toISOString(),
      })
    if (
      ['waiting', 'approval', 'child', 'recovery-answer'].includes(scenario)
    ) {
      state.interactions.push({
        id: `interaction:${threadId}`,
        revision: 1,
        target,
        version: 1,
        kind: scenario === 'approval' ? 'approval' : 'question',
        runId: scenario === 'child' ? `child:${runId}` : runId,
        attemptId: scenario === 'child' ? `child:${attemptId}` : attemptId,
        sourceAgentId: scenario === 'child' ? 'niko' : 'ari',
        ...(scenario === 'child'
          ? { delegationId: `delegation:${threadId}` }
          : {}),
        ...(scenario === 'approval'
          ? { proposalId: `proposal:${threadId}` }
          : {}),
        prompt:
          scenario === 'approval'
            ? 'Approve publishing the recorded launch checklist to the team?'
            : 'Which release should the launch checklist focus on?',
        options:
          scenario === 'approval'
            ? []
            : [
                { id: 'desktop', label: 'Desktop first' },
                { id: 'all', label: 'All platforms' },
              ],
        freeText: true,
        state: 'pending',
        continuation: 'waiting',
        reason:
          scenario === 'recovery-answer'
            ? 'Continuation requires reconciliation after your answer is saved.'
            : '',
      })
    }
    actions(work)
    return work
  }
  function acceptedMessage(
    threadId: string,
    message: Message,
    isRoot: boolean,
  ) {
    const preparing =
      message.preparation?.some((p) => p.status === 'preparing') ?? false
    if (isRoot) {
      if (preparing) {
        const work = seed(threadId, 'running')
        update(work, 'preparing')
      }
      return
    }
    const work =
      state.workflows.find((w) => w.target.threadId === threadId) ??
      (preparing ? seed(threadId, 'running') : undefined)
    if (!work) return
    state.queue.push({
      id: `queue:${message.id}`,
      revision: 1,
      target: work.target,
      messageId: message.id,
      text: message.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('\n'),
      acceptanceOrder: ++order,
      readiness: preparing ? 'preparing' : 'ready',
      state: work.held ? 'held' : 'queued',
      actions: [],
    })
    advance(work)
    actions(work)
  }
  function update(work: Workflow, status: WorkState) {
    work.state = status
    work.revision++
    const attempt = state.attempts.find((a) => a.id === work.attemptId)
    const run = state.runs.find((r) => r.id === work.runId)
    if (attempt) {
      attempt.state = status
      attempt.revision++
    }
    if (run) {
      run.state = status
      run.revision++
    }
    actions(work)
  }
  function advance(work: Workflow) {
    if (work.held || !['completed', 'cancelled'].includes(work.state)) return
    const next = state.queue
      .filter(
        (q) =>
          q.target.threadId === work.target.threadId && q.state === 'queued',
      )
      .sort((a, b) => a.acceptanceOrder - b.acceptanceOrder)[0]
    if (next && next.readiness !== 'preparing') {
      next.state = 'consumed'
      next.revision++
      work.runId = crypto.randomUUID()
      work.attemptId = crypto.randomUUID()
      state.runs.push({
        id: work.runId,
        revision: 1,
        target: work.target,
        originMessageId: next.messageId,
        currentAttemptId: work.attemptId,
        state: 'running',
      })
      state.attempts.push({
        id: work.attemptId,
        revision: 1,
        target: work.target,
        runId: work.runId,
        number: 1,
        state: 'running',
        startedAt: new Date().toISOString(),
        suppliedSettings: execution(work.target.threadId),
      })
      update(work, 'running')
    }
  }
  function preparedMessage(message: Message) {
    const work = state.workflows.find(
      (w) => w.target.threadId === message.threadId,
    )
    if (!work) return
    const queue = state.queue.find((q) => q.messageId === message.id)
    if (queue) {
      if (queue.readiness !== 'preparing') return
      queue.readiness = 'ready'
      queue.revision++
      if (queue.state === 'queued') advance(work)
    } else {
      const run = state.runs.find((r) => r.id === work.runId)
      if (
        run?.originMessageId === message.id &&
        work.state === 'preparing' &&
        !work.held
      )
        update(work, 'running')
    }
    actions(work)
    publish(records(message.threadId))
  }
  function validAnswer(
    answer: Answer | undefined,
    item: WorkRecords['interactions'][number],
  ) {
    if (!answer) return false
    if (item.kind === 'approval')
      return ['approve', 'decline'].includes(answer.kind)
    return (
      answer.kind === 'dismiss' ||
      (answer.kind === 'choice' &&
        item.options.some((o) => o.id === answer.optionId) &&
        (!answer.text || item.freeText)) ||
      (answer.kind === 'text' && item.freeText && !!answer.text.trim())
    )
  }
  function command(op: WorkOperation): WorkReceipt {
    deliveries.push(structuredClone(op))
    const key = JSON.stringify([op.target.callerId, op.operationId])
    const prior = receipts.get(key)
    if (prior) return prior
    const work = state.workflows.find(
      (w) => w.target.threadId === op.target.threadId,
    )
    const result = (
      status: 'accepted' | 'rejected',
      message: string,
      response?: WorkRecords['interactions'][number]['response'],
    ) => {
      const receipt: WorkReceipt = {
        operationId: op.operationId,
        target: op.target,
        status,
        message,
        records: records(op.target.threadId),
        ...(response ? { response } : {}),
      }
      receipts.set(key, structuredClone(receipt))
      publish(receipt.records)
      return receipt
    }
    if (!work || !sameWorkTarget(op.target, work.target))
      return result('rejected', 'The original work context is unavailable.')
    if (op.action === 'respond') {
      const item = state.interactions.find(
        (i) =>
          i.id === op.interactionId && i.target.threadId === op.target.threadId,
      )
      if (
        !item ||
        item.version !== op.interactionVersion ||
        item.runId !== op.runId ||
        item.attemptId !== op.attemptId ||
        item.proposalId !== op.proposalId
      )
        return result(
          'rejected',
          'The recorded interaction target is unavailable.',
        )
      if (item.response)
        return result(
          'accepted',
          'This interaction already has a recorded response.',
          item.response,
        )
      if (item.state !== 'pending')
        return result(
          'rejected',
          'This interaction can no longer authorize work.',
        )
      if (!validAnswer(op.answer, item))
        return result('rejected', 'Choose an explicit valid response.')
      item.response = {
        operationId: op.operationId,
        actorId: currentCaller(),
        answer: structuredClone(op.answer!),
        acceptedAt: new Date().toISOString(),
      }
      item.state = 'settled'
      item.revision++
      item.continuation = item.reason.includes('requires reconciliation')
        ? 'recovery-needed'
        : 'ready'
      if (item.continuation === 'ready') {
        const old = state.attempts.find((a) => a.id === work.attemptId)!
        const id = crypto.randomUUID()
        state.attempts.push({
          ...old,
          id,
          revision: 1,
          number: old.number + 1,
          state: 'running',
          startedAt: new Date().toISOString(),
          suppliedSettings: execution(work.target.threadId),
        })
        work.attemptId = id
        const run = state.runs.find((r) => r.id === work.runId)!
        run.currentAttemptId = id
      }
      update(
        work,
        item.continuation === 'recovery-needed' ? 'recovery-needed' : 'running',
      )
      activity(
        work,
        op.answer!.kind === 'dismiss'
          ? 'Question dismissed; no answer provided.'
          : op.answer!.kind === 'decline'
            ? 'Proposal declined; it will not be performed.'
            : 'Response recorded.',
      )
      return result('accepted', 'Response saved.', item.response)
    }
    if (op.runId !== work.runId || op.attemptId !== work.attemptId)
      return result(
        'rejected',
        'The targeted attempt is no longer current; the queue is unchanged.',
      )
    const q = state.queue.find(
      (q) => q.id === op.queueId && q.target.threadId === op.target.threadId,
    )
    const action = (op.queueId ? q?.actions : work.actions)?.find(
      (a) => a.action === op.action,
    )
    if (!action?.allowed)
      return result('rejected', action?.reason || 'This action is unavailable.')
    if (op.action === 'stop') {
      work.held = true
      work.holdGeneration = (work.holdGeneration ?? 0) + 1
      delete work.retryContinuation
      for (const item of state.interactions.filter(
        (i) =>
          i.target.threadId === op.target.threadId && i.state === 'pending',
      )) {
        item.state = 'cancelled'
        item.continuation = 'cancelled'
        item.revision++
      }
      for (const child of state.delegations.filter(
        (d) =>
          d.target.threadId === op.target.threadId &&
          !['completed', 'failed', 'cancelled'].includes(d.state),
      )) {
        child.state = 'cancellation-requested'
        child.revision++
      }
      for (const item of state.queue.filter(
        (q) => q.target.threadId === op.target.threadId && q.state === 'queued',
      )) {
        item.state = 'held'
        item.revision++
      }
      update(work, 'cancellation-requested')
      activity(work, 'Cancellation requested; waiting for settlement.')
      return result(
        'accepted',
        'Cancellation requested. Provider stop is not yet confirmed.',
      )
    }
    if (op.action === 'retry') {
      for (const interaction of state.interactions.filter(
        (i) =>
          i.target.threadId === op.target.threadId && i.state === 'pending',
      )) {
        interaction.state = 'superseded'
        interaction.revision++
      }
      const old = state.attempts.find((a) => a.id === work.attemptId)!
      const attemptId = crypto.randomUUID()
      state.attempts.push({
        ...old,
        id: attemptId,
        revision: 1,
        number: old.number + 1,
        state: 'running',
        startedAt: new Date().toISOString(),
        suppliedSettings: execution(work.target.threadId),
      })
      work.attemptId = attemptId
      const run = state.runs.find((r) => r.id === work.runId)!
      run.currentAttemptId = attemptId
      work.retryContinuation = {
        operationId: op.operationId,
        attemptId,
        holdGeneration: work.holdGeneration ?? 0,
      }
      work.reason =
        'Retrying with current settings and instructions. Queued follow-ups continue after safe success.'
      update(work, 'running')
      activity(
        work,
        'Retry accepted; queued follow-ups continue after safe success.',
      )
      return result(
        'accepted',
        'Retry accepted with queue continuation after safe success.',
      )
    }
    if (op.action === 'resume') {
      work.held = false
      delete work.retryContinuation
      work.revision++
      for (const item of state.queue.filter(
        (q) => q.target.threadId === op.target.threadId && q.state === 'held',
      )) {
        item.state = 'queued'
        item.revision++
      }
      advance(work)
      actions(work)
      activity(
        work,
        'Held follow-ups released. Cancelled work remains stopped.',
      )
      return result(
        'accepted',
        'Follow-ups released; cancelled work is not revived.',
      )
    }
    if (q && ['cancel-queued', 'steer'].includes(op.action)) {
      q.state = op.action === 'steer' ? 'consumed' : 'cancelled'
      q.revision++
      advance(work)
      actions(work)
      return result(
        'accepted',
        op.action === 'steer'
          ? 'Selected message accepted as steering for the recorded attempt.'
          : 'Selected queue item cancelled; its authored message remains.',
      )
    }
    return result('rejected', 'Transition is not configured.')
  }
  function scenario(threadId: string, name: string, attemptId?: string) {
    const work = seed(threadId, name)
    if (name === 'confirm-stop' && work.state === 'cancellation-requested') {
      update(work, 'cancelled')
      for (const child of state.delegations.filter(
        (d) =>
          d.target.threadId === threadId &&
          d.state === 'cancellation-requested',
      )) {
        child.state = 'cancelled'
        child.revision++
      }
      activity(work, 'Cancellation confirmed by the fixture.')
    } else if (name === 'fail' || name === 'recovery') {
      if (
        (attemptId && attemptId !== work.attemptId) ||
        ['cancelled', 'cancellation-requested'].includes(work.state)
      ) {
        activity(
          work,
          'Late failure retained; current work and hold are unchanged.',
          'failed',
        )
        publish(records(threadId))
        return records(threadId)
      }
      work.held = true
      work.holdGeneration = (work.holdGeneration ?? 0) + 1
      delete work.retryContinuation
      for (const q of state.queue.filter(
        (q) => q.target.threadId === threadId && q.state === 'queued',
      )) {
        q.state = 'held'
        q.revision++
      }
      update(work, name === 'fail' ? 'failed' : 'recovery-needed')
      work.reason =
        'Provider failed after publishing output. Earlier content is retained.'
    } else if (name === 'success') {
      // Explicit fixture outcome injection, never a UI scheduler or provider proof.
      const ending = attemptId ?? work.attemptId
      const attempt = state.attempts.find((a) => a.id === ending)
      if (ending === work.attemptId && work.state === 'running') {
        const continuation = work.retryContinuation
        update(work, 'completed')
        if (
          (!work.held ||
            (continuation?.attemptId === ending &&
              continuation.holdGeneration === (work.holdGeneration ?? 0))) &&
          !state.interactions.some(
            (i) => i.target.threadId === threadId && i.state === 'pending',
          )
        ) {
          work.held = false
          delete work.retryContinuation
          for (const q of state.queue
            .filter((q) => q.target.threadId === threadId && q.state === 'held')
            .sort((a, b) => a.acceptanceOrder - b.acceptanceOrder)) {
            q.state = 'queued'
            q.revision++
          }
          advance(work)
          work.revision++
          actions(work)
          work.reason =
            'Retry safely completed; queued follow-ups continue in acceptance order.'
        }
      } else if (attempt && attempt.id !== work.attemptId) {
        activity(
          work,
          'Late attempt outcome retained; current work and hold are unchanged.',
          'completed',
        )
      }
    } else if (name === 'supersede') {
      for (const i of state.interactions.filter(
        (i) => i.target.threadId === threadId && i.state === 'pending',
      )) {
        i.state = 'superseded'
        i.revision++
      }
    } else if (name === 'late-child') {
      for (const child of state.delegations.filter(
        (d) => d.target.threadId === threadId,
      )) {
        child.state = 'completed'
        child.result = {
          id: crypto.randomUUID(),
          summary: 'Scope review retained for the originating workflow.',
          receivedAt: new Date().toISOString(),
          late: true,
        }
        child.revision++
      }
      activity(
        work,
        'Late child result retained as history; parent state is unchanged.',
        'completed',
      )
    } else if (name === 'unsupported-steer') {
      for (const q of state.queue.filter(
        (q) => q.target.threadId === threadId,
      )) {
        q.actions = q.actions.map((a) =>
          a.action === 'steer'
            ? {
                ...a,
                allowed: false,
                reason: 'The adapter does not support steering.',
              }
            : a,
        )
        q.revision++
      }
    }
    publish(records(threadId))
    return records(threadId)
  }
  return {
    projection,
    acceptedMessage,
    preparedMessage,
    command,
    scenario,
    receipt: (op: WorkOperation): WorkReceipt =>
      receipts.get(JSON.stringify([op.target.callerId, op.operationId])) ?? {
        operationId: op.operationId,
        status: 'unknown',
      },
    inspect: () => ({
      deliveries,
      receipts: [...receipts.values()],
      work: state,
    }),
    seed,
  }
}
