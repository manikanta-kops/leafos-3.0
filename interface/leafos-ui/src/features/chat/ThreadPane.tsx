import type { QueueEntry } from '../../data/work'
import { type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Icon } from '../../components/Icon'
import { quickFade } from '../../app/motion'
import { Message } from './Message'
import type { Thread, PreviewData } from './model'

export function ThreadPane({
  thread,
  data,
  expanded,
  onExpand,
  onClose,
  closeButton,
  scroll,
  history,
  work,
  queue,
  recovery,
  composer,
  unread,
  latest,
}: {
  thread: Thread
  data: PreviewData
  expanded: boolean
  onExpand: () => void
  onClose: () => void
  closeButton: RefObject<HTMLButtonElement | null>
  scroll: RefObject<HTMLDivElement | null>
  queue: QueueEntry[]
  work: ReactNode
  history: ReactNode
  recovery: ReactNode
  composer: ReactNode
  unread: boolean
  latest: () => void
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.section
      key={thread.id}
      layout={!reduceMotion}
      initial={{ opacity: 0, x: reduceMotion ? 0 : 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{
        opacity: 0,
        x: reduceMotion ? 0 : 12,
        transition: quickFade,
      }}
      className="thread-pane"
      aria-label={`Thread: ${thread.title}`}
    >
      <header className="pane-header">
        <div>
          <p className="thread-eyebrow">
            {expanded
              ? `${data.actorsById[data.chatsById[thread.chatId]?.participantIds.find((id) => id !== data.currentHumanId) ?? '']?.name ?? 'Conversation'} / Thread`
              : 'Thread'}
          </p>
          <h2>{thread.title}</h2>
        </div>
        <div className="header-actions">
          <button
            className="icon-button expand-thread"
            aria-label={expanded ? 'Restore split view' : 'Expand thread'}
            onClick={() => onExpand()}
          >
            <Icon name={expanded ? 'shrink' : 'expand'} />
          </button>
          <button
            ref={closeButton}
            className="icon-button"
            aria-label="Close thread"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      <motion.div
        layout={reduceMotion ? false : 'position'}
        layoutScroll
        ref={scroll}
        className="thread-scroll"
      >
        {history}
        <div className="date-divider">
          <time dateTime={data.messagesById[thread.rootMessageId].createdAt}>
            {new Date(
              data.messagesById[thread.rootMessageId].createdAt,
            ).toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </time>
        </div>
        <Message
          message={data.messagesById[thread.rootMessageId]}
          data={data}
        />
        <div className="date-divider">
          <span>{thread.messageIds.length - 1} replies</span>
        </div>
        <AnimatePresence initial={false}>
          {thread.messageIds
            .slice(1)
            .filter((id) => data.messagesById[id])
            .map((id) => (
              <motion.article
                className="thread-reply"
                key={id}
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={quickFade}
              >
                <Message message={data.messagesById[id]} data={data} />
                {queue
                  .filter(
                    (q) =>
                      q.messageId === id &&
                      ['cancelled', 'consumed'].includes(q.state),
                  )
                  .map((q) => (
                    <p className="queue-message-status" key={q.id}>
                      {q.state === 'cancelled'
                        ? 'Queued follow-up cancelled'
                        : 'Accepted for work'}
                    </p>
                  ))}
              </motion.article>
            ))}
        </AnimatePresence>
        {work}
      </motion.div>
      {unread && (
        <button className="jump-latest" onClick={latest}>
          Back to latest messages
        </button>
      )}
      {recovery}
      {composer}
    </motion.section>
  )
}
