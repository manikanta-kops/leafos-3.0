import { WorkSummary } from '../work/WorkSummary'
import type { WorkRecords } from '../../data/work'
import { Fragment, type RefObject } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { quickFade } from '../../app/motion'
import { Icon } from '../../components/Icon'
import { Message, Avatar } from './Message'
import {
  formatTime,
  type Thread,
  type PreviewData,
  type Chat,
  type Agent,
} from './model'
export function RootFeed({
  work,
  chat,
  agent,
  data,
  visible,
  threadId,
  triggers,
  onOpen,
}: {
  work: WorkRecords
  chat: Chat
  agent: Agent
  data: PreviewData
  visible: Thread[]
  threadId: string | null
  triggers: RefObject<Map<string, HTMLButtonElement>>
  onOpen: (id: string) => void
}) {
  const reduceMotion = useReducedMotion()
  return (
    <motion.div
      className="feed"
      key={chat.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={quickFade}
    >
      {visible.length ? (
        <AnimatePresence initial={false}>
          {visible.map((item, index) => (
            <Fragment key={item.id}>
              {(index === 0 ||
                new Date(
                  data.messagesById[visible[index - 1].rootMessageId].createdAt,
                ).toDateString() !==
                  new Date(
                    data.messagesById[item.rootMessageId].createdAt,
                  ).toDateString()) && (
                <div className="date-divider">
                  <time
                    dateTime={data.messagesById[item.rootMessageId].createdAt}
                  >
                    {new Date(
                      data.messagesById[item.rootMessageId].createdAt,
                    ).toLocaleDateString(undefined, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </time>
                </div>
              )}
              <motion.article
                initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={quickFade}
                key={item.id}
                className={`feed-message ${threadId === item.id ? 'active-message' : ''}`}
              >
                <Message
                  message={data.messagesById[item.rootMessageId]}
                  data={data}
                />
                <div className="root-work-summary">
                  <WorkSummary
                    work={work.workflows.find(
                      (w) => w.target.threadId === item.id,
                    )}
                  />
                </div>
                <button
                  ref={(element) => {
                    if (element) triggers.current.set(item.id, element)
                    else triggers.current.delete(item.id)
                  }}
                  className="reply-link"
                  aria-label={`Open thread: ${item.title}`}
                  aria-expanded={threadId === item.id}
                  onClick={() => {
                    onOpen(item.id)
                  }}
                >
                  <span className="reply-participants" aria-hidden="true">
                    {(item.participantIds ?? []).slice(0, 3).map((id) => (
                      <Avatar
                        key={id}
                        name={data.actorsById[id]?.name ?? '?'}
                        isSelf={id === data.currentHumanId}
                        color={
                          data.actorsById[id]?.kind === 'agent'
                            ? data.actorsById[id].color
                            : undefined
                        }
                      />
                    ))}
                  </span>
                  <span>
                    {(item.replyCount ?? item.messageIds.length - 1)
                      ? `${item.replyCount ?? item.messageIds.length - 1} ${(item.replyCount ?? item.messageIds.length - 1) === 1 ? 'reply' : 'replies'}`
                      : 'Start a thread'}
                  </span>
                  <span className="reply-description">
                    {(item.replyCount ?? item.messageIds.length - 1)
                      ? `Last reply ${formatTime(item.lastMessageAt ?? data.messagesById[item.rootMessageId].createdAt)}`
                      : 'Keep the conversation together'}
                  </span>
                </button>
              </motion.article>
            </Fragment>
          ))}
        </AnimatePresence>
      ) : (
        <div className="empty-state">
          <span className="empty-mark">
            <Icon name="leaf" />
          </span>
          <h2>A little space to think.</h2>
          <p>
            Start a conversation with {agent.name}.<br />
            Your ideas can grow from here.
          </p>
        </div>
      )}
    </motion.div>
  )
}
