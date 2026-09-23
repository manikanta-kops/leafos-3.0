import { useId, useRef, useState } from 'react'
import type { Answer, Interaction, WorkOperation } from '../../data/work'
import type { PreviewData } from '../chat/model'
import { answerText } from './answer-text'
import { Icon } from '../../components/Icon'
export function InteractionCard({
  interaction: item,
  data,
  blocked,
  send,
}: {
  interaction: Interaction
  data: PreviewData
  blocked: boolean
  send: (op: WorkOperation) => Promise<void>
}) {
  const [choice, setChoice] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const heading = useId()
  const result = useRef<HTMLOutputElement>(null)
  const disabled = item.state !== 'pending' || blocked || pending
  async function respond(answer: Answer) {
    setError('')
    setPending(true)
    try {
      await send({
        operationId: crypto.randomUUID(),
        target: item.target,
        action: 'respond',
        runId: item.runId,
        attemptId: item.attemptId,
        interactionId: item.id,
        interactionVersion: item.version,
        proposalId: item.proposalId,
        answer,
      })
      requestAnimationFrame(() => result.current?.focus())
    } catch {
      setError(
        'Your response could not be saved. Your input is still here; try again.',
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <section
      id={`resource-${item.id}`}
      tabIndex={-1}
      className="interaction-card"
      aria-labelledby={heading}
    >
      <p className="interaction-eyebrow">
        <Icon name={item.kind === 'approval' ? 'check' : 'chat'} size={16} />
        {data.actorsById[item.sourceAgentId]?.name ?? 'Agent'} ·{' '}
        {item.kind === 'approval' ? 'Approval requested' : 'Question'}
        {item.delegationId ? ' · Consulting agent' : ''}
      </p>
      <h3 id={heading}>{item.prompt}</h3>
      {item.state === 'pending' ? (
        <>
          {item.kind === 'question' && item.options.length > 0 && (
            <fieldset disabled={disabled}>
              <legend>Choose an option</legend>
              {item.options.map((o) => (
                <label className="interaction-option" key={o.id}>
                  <input
                    type="radio"
                    name={heading}
                    value={o.id}
                    checked={choice === o.id}
                    onChange={() => setChoice(o.id)}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          )}
          {(item.freeText || item.kind === 'approval') && (
            <label className="interaction-text">
              {item.kind === 'approval'
                ? 'Optional comment (not approval)'
                : 'Your answer or additional detail'}
              <textarea
                value={text}
                disabled={disabled}
                onChange={(e) => setText(e.target.value)}
                rows={2}
              />
            </label>
          )}
          <div className="work-actions">
            {item.kind === 'approval' ? (
              <>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void respond({ kind: 'approve', comment: text })
                  }
                >
                  Approve
                </button>
                <button
                  disabled={disabled}
                  onClick={() =>
                    void respond({ kind: 'decline', comment: text })
                  }
                >
                  Decline
                </button>
              </>
            ) : (
              <>
                <button
                  disabled={disabled || (!choice && !text.trim())}
                  onClick={() =>
                    void respond(
                      choice
                        ? {
                            kind: 'choice',
                            optionId: choice,
                            ...(item.freeText && text.trim() ? { text } : {}),
                          }
                        : { kind: 'text', text },
                    )
                  }
                >
                  Send answer
                </button>
                <button
                  disabled={disabled}
                  onClick={() => void respond({ kind: 'dismiss' })}
                >
                  Dismiss question
                </button>
              </>
            )}
          </div>
          {blocked && (
            <output ref={result} tabIndex={-1}>
              Response outcome is being reconciled. See work command recovery.
            </output>
          )}
        </>
      ) : (
        <div>
          <output ref={result} tabIndex={-1}>
            {item.state === 'settled'
              ? 'Recorded response'
              : item.state === 'cancelled'
                ? 'Question or approval cancelled'
                : 'Superseded by a newer request'}
          </output>
          {item.response && (
            <blockquote>
              <strong>
                {data.actorsById[item.response.actorId]?.name ?? 'Respondent'}
              </strong>
              <p>{answerText(item.response.answer, item)}</p>
            </blockquote>
          )}
        </div>
      )}
      {item.continuation === 'recovery-needed' && (
        <output>
          Response saved. Continuation needs recovery; no new work is authorized
          by this card.
        </output>
      )}
      {item.reason && <p className="work-explanation">{item.reason}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
