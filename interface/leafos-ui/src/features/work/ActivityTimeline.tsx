import type { WorkRecords } from '../../data/work'
import { workLabels } from '../../data/work'
import { formatTime, type PreviewData } from '../chat/model'
export function ActivityTimeline({
  work,
  threadId,
  data,
}: {
  work: WorkRecords
  threadId: string
  data: PreviewData
}) {
  const entries = work.activity
    .filter((a) => a.target.threadId === threadId)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const delegations = work.delegations.filter(
    (a) => a.target.threadId === threadId,
  )
  if (!entries.length && !delegations.length) return null
  const name = (id: string) => data.actorsById[id]?.name ?? 'Agent'
  return (
    <details className="work-activity" open>
      <summary>
        Activity · {entries.length + delegations.length} updates
      </summary>
      <ol>
        {entries.map((a) => (
          <li key={a.id} className={`work-${a.state}`}>
            <span className="work-dot" aria-hidden="true" />
            <div>
              <span>{a.text}</span>
              <small>
                {name(a.actorId)} ·{' '}
                <time dateTime={a.createdAt}>{formatTime(a.createdAt)}</time> ·{' '}
                {workLabels[a.state]}
              </small>
            </div>
          </li>
        ))}
      </ol>
      {delegations.map((d) => (
        <p className="delegation-summary" key={d.id}>
          {name(d.fromAgentId)} is consulting {name(d.toAgentId)}{' '}
          <small>
            {workLabels[d.state]} · {formatTime(d.createdAt)}
          </small>
        </p>
      ))}
    </details>
  )
}
