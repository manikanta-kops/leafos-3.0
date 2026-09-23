import { useState } from 'react'
import type { WorkRecords, WorkAction, WorkOperation } from '../../data/work'
import { formatTime, type PreviewData } from '../chat/model'
import { WorkSummary } from './WorkSummary'
import { ActivityTimeline } from './ActivityTimeline'
import { InteractionCard } from './InteractionCard'
import { answerText } from './answer-text'
import type { useWorkCommands } from './use-work-commands'
export type WorkCommands = ReturnType<typeof useWorkCommands>
const labels: Record<WorkAction, string> = {
  stop: 'Stop work',
  resume: 'Resume follow-ups',
  retry: 'Retry work',
  'cancel-queued': 'Cancel queued item',
  steer: 'Steer current attempt',
  respond: 'Respond',
}
export function WorkRecovery({
  commands,
  threadId,
  work,
}: {
  commands: WorkCommands
  threadId: string
  work: WorkRecords
}) {
  const entries = commands.entries.filter(
    (e) => e.operation.target.threadId === threadId && e.state !== 'accepted',
  )
  if (!entries.length && !commands.error) return null
  return (
    <section className="work-recovery" aria-label="Work command recovery">
      {commands.error && (
        <p role="alert">
          {commands.error}{' '}
          <button onClick={commands.reload}>Retry loading work recovery</button>
        </p>
      )}
      {entries.map((e) => (
        <div key={e.id}>
          <strong>
            {labels[e.operation.action]} ·{' '}
            {e.state === 'rejected' ? 'Not accepted' : 'Outcome unconfirmed'}
          </strong>
          {e.operation.answer && (
            <blockquote>
              {answerText(
                e.operation.answer,
                work.interactions.find(
                  (i) => i.id === e.operation.interactionId,
                ),
              )}
            </blockquote>
          )}
          <p>
            {e.receipt && e.receipt.status !== 'unknown'
              ? e.receipt.message
              : 'The original target and request are retained. A missing receipt is not a rejection.'}
          </p>
          {e.state !== 'rejected' && (
            <div className="work-actions">
              <button onClick={() => void commands.check(e)}>
                Check command outcome
              </button>
              <button
                disabled={e.state === 'sending'}
                onClick={() => void commands.retry(e)}
              >
                Retry same command
              </button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}
export function WorkPanel({
  work,
  threadId,
  data,
  commands,
}: {
  work: WorkRecords
  threadId: string
  data: PreviewData
  commands: WorkCommands
}) {
  const current = work.workflows.find((w) => w.target.threadId === threadId)
  const [error, setError] = useState('')
  const unresolved = commands.entries.filter(
    (e) =>
      e.operation.target.threadId === threadId &&
      !['accepted', 'rejected'].includes(e.state),
  )
  const queue = work.queue
    .filter(
      (q) =>
        q.target.threadId === threadId && ['held', 'queued'].includes(q.state),
    )
    .sort(
      (a, b) =>
        a.acceptanceOrder - b.acceptanceOrder || a.id.localeCompare(b.id),
    )
  async function send(op: WorkOperation) {
    setError('')
    try {
      await commands.send(op)
    } catch {
      setError('Command could not be saved. Nothing was dispatched; try again.')
    }
  }
  return (
    <div className="work-panel">
      {current && (
        <section aria-label="Thread work">
          <div className="work-heading">
            <WorkSummary work={current} />
            <div className="work-actions">
              {current.actions
                .filter((a) => ['stop', 'resume', 'retry'].includes(a.action))
                .map((a) => (
                  <button
                    key={a.action}
                    disabled={!a.allowed || unresolved.length > 0}
                    title={a.reason}
                    onClick={() =>
                      void send({
                        operationId: crypto.randomUUID(),
                        target: current.target,
                        action: a.action,
                        runId: current.runId,
                        attemptId: current.attemptId,
                      })
                    }
                  >
                    {labels[a.action]}
                  </button>
                ))}
            </div>
          </div>
          {current.actions.some((a) => a.action === 'retry' && a.allowed) && (
            <p className="work-explanation">
              Retry this work, then continue queued follow-ups after safe
              success.
            </p>
          )}
          {work.attempts
            .filter((a) => a.target.threadId === threadId)
            .map((a) => (
              <p
                id={`resource-${a.id}`}
                tabIndex={-1}
                className="work-explanation"
                key={a.id}
              >
                Attempt {a.number} · Started {formatTime(a.startedAt)}
                {a.suppliedSettings && (
                  <span className="supplied-settings">
                    Simulated inputs:{' '}
                    {a.suppliedSettings.values.adapter ?? 'No adapter'} /{' '}
                    {a.suppliedSettings.values.model ?? 'No model'} /{' '}
                    {a.suppliedSettings.values.effort ?? 'No effort'} ·
                    Instructions: {a.suppliedSettings.instructions || 'None'}
                  </span>
                )}
              </p>
            ))}
          {current.reason && (
            <p className="work-explanation">{current.reason}</p>
          )}
          {current.actions
            .filter((a) => !a.allowed && a.reason)
            .map((a) => (
              <p className="work-explanation" key={a.action}>
                {labels[a.action]}: {a.reason}
              </p>
            ))}
        </section>
      )}
      <ActivityTimeline work={work} threadId={threadId} data={data} />
      {work.interactions
        .filter((i) => i.target.threadId === threadId)
        .map((i) => (
          <InteractionCard
            key={i.id}
            interaction={i}
            data={data}
            blocked={unresolved.some((e) => e.operation.interactionId === i.id)}
            send={commands.send}
          />
        ))}
      {queue.length > 0 && (
        <section className="work-queue" aria-label="Accepted follow-ups">
          <h3>
            Accepted follow-ups <span>{queue.length}</span>
          </h3>
          <p className="work-explanation">
            Saved by the backend, in acceptance order.
          </p>
          <ol>
            {queue.map((q) => (
              <li key={q.id}>
                <p>{q.text}</p>
                <small>
                  {q.state === 'held'
                    ? 'Held until released'
                    : q.readiness === 'preparing'
                      ? 'Preparing voice note · keeping queue position'
                      : 'Queued'}
                </small>
                <div className="work-actions">
                  {q.actions.map((a) => (
                    <button
                      key={a.action}
                      title={a.reason}
                      disabled={!a.allowed || unresolved.length > 0 || !current}
                      onClick={() =>
                        current &&
                        void send({
                          operationId: crypto.randomUUID(),
                          target: q.target,
                          action: a.action,
                          runId: current.runId,
                          attemptId: current.attemptId,
                          queueId: q.id,
                        })
                      }
                    >
                      {labels[a.action]}
                    </button>
                  ))}
                </div>
                {q.actions
                  .filter((a) => !a.allowed)
                  .map((a) => (
                    <small key={a.action}>{a.reason}</small>
                  ))}
              </li>
            ))}
          </ol>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
