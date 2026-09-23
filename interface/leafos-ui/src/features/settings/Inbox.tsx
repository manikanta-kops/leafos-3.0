import { useRef, useState } from 'react'
import { Panel, type Controls } from './SettingsPanel'
import type { InboxNotification } from '../../data/settings'
import type { CallerScope } from '../../data/conversations'
export function Inbox({
  notifications,
  scope,
  commands,
  open,
  close,
  routeStatus,
  availability,
}: {
  notifications: InboxNotification[]
  scope: CallerScope
  commands: Controls
  open: (n: InboxNotification) => void
  close: () => void
  availability: string
  routeStatus: string
}) {
  const [failures, setFailures] = useState<Record<string, string>>({})
  const sending = useRef(new Set<string>())
  async function markRead(n: InboxNotification) {
    if (sending.current.has(n.id)) return
    sending.current.add(n.id)
    try {
      await commands.send({
        operationId: crypto.randomUUID(),
        target: { ...scope },
        action: 'read',
        notificationId: n.id,
      })
      setFailures((previous) => ({ ...previous, [n.id]: '' }))
    } catch {
      setFailures((previous) => ({
        ...previous,
        [n.id]:
          'Read update could not be saved locally. Nothing was sent. Retry Mark read after local storage is available.',
      }))
    } finally {
      sending.current.delete(n.id)
    }
  }
  return (
    <Panel title="Notifications" close={close}>
      <p>
        Saved updates for you. Opening an update does not mark it read or
        respond to a request.
      </p>
      {routeStatus && <output>{routeStatus}</output>}
      {availability && <output>{availability}</output>}
      {!notifications.length && !availability && (
        <div className="inbox-empty">
          <h3>You’re all caught up</h3>
          <p>
            Completions, questions, approvals and work that needs attention
            appear here.
          </p>
        </div>
      )}
      <ol className="inbox-list">
        {[...notifications]
          .sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) ||
              a.id.localeCompare(b.id),
          )
          .map((n) => {
            const entry = commands.entries.find(
              (e) =>
                e.operation.action === 'read' &&
                e.operation.notificationId === n.id &&
                !['accepted', 'rejected'].includes(e.state),
            )
            const rejected = commands.entries.find(
              (e) =>
                e.operation.action === 'read' &&
                e.operation.notificationId === n.id &&
                e.state === 'rejected',
            )
            return (
              <li key={n.id} className={n.read ? 'read' : 'unread'}>
                <div>
                  <span className="inbox-kind">
                    {n.kind.replaceAll('-', ' ')}
                  </span>
                  <h3>{n.title}</h3>
                  <time dateTime={n.createdAt}>
                    {new Date(n.createdAt).toLocaleString()}
                  </time>
                  <p>
                    {n.target.context.kind === 'organization'
                      ? n.target.context.organizationId
                      : 'Installation'}{' '}
                    · {n.read ? 'Read' : 'Unread'}
                  </p>
                </div>
                <div className="settings-actions">
                  <button onClick={() => open(n)}>Open original context</button>
                  {!n.read && (
                    <button disabled={!!entry} onClick={() => void markRead(n)}>
                      {failures[n.id] ? 'Retry Mark read' : 'Mark read'}
                    </button>
                  )}
                </div>
                {!n.read && failures[n.id] && (
                  <p role="alert">{failures[n.id]}</p>
                )}
                {rejected?.receipt && rejected.receipt.status !== 'unknown' && (
                  <p role="alert">{rejected.receipt.message}</p>
                )}
                {entry && (
                  <output>
                    Read update {entry.state}.{' '}
                    <button onClick={() => void commands.retry(entry)}>
                      Retry original read update
                    </button>
                  </output>
                )}
              </li>
            )
          })}
      </ol>
      {commands.error && (
        <p role="alert">
          {commands.error}
          <button onClick={commands.reload}>Retry recovery storage</button>
        </p>
      )}
      <p className="settings-footnote">
        Inbox history is separate from desktop alerts. Reading never answers a
        question or approves work.
      </p>
    </Panel>
  )
}
