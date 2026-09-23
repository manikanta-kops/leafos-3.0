import { WorkPanel, WorkRecovery } from '../work/WorkPanel'
import { useWorkCommands } from '../work/use-work-commands'
import { ConversationRecovery } from '../chat/ConversationRecovery'
import { RootFeed } from '../chat/RootFeed'
import { ThreadPane } from '../chat/ThreadPane'
import { useHistory } from '../chat/use-history'
import { useScrollHistory } from '../chat/use-scroll-history'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { DurableComposer } from '../chat/DurableComposer'
import { useOutbox } from '../chat/use-outbox'
import { useConversations } from '../../data/use-conversations'
import { rootDraftKey, replyDraftKey } from '../chat/model'
import { Sidebar } from './Sidebar'
import { useNavigation } from '../../data/workspace-hooks'
import type { WorkspaceSnapshot } from '../../data/workspace-client'
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react'
import { quickFade } from '../../app/motion'
import type { Agent } from '../chat/model'
import type { Platform } from '../../platform/platform'
import { SettingsPanel } from '../settings/SettingsPanel'
import { Inbox } from '../settings/Inbox'
import { useAttention } from '../settings/use-attention'
import { useControlCommands } from '../../data/use-control-commands'
import type { InboxNotification } from '../../data/settings'

type Theme = 'light' | 'dark'
export function Workspace({
  platform,
  snapshot,
  fixture,
  connectionStatus,
  reconnect,
}: {
  platform: Platform
  snapshot: WorkspaceSnapshot
  fixture: boolean
  connectionStatus: 'ready' | 'reconnecting' | 'unavailable' | 'offline'
  reconnect: () => void
}) {
  const { navigation, update } = useNavigation(snapshot)
  const { organizationId, agentId, collapsed } = navigation
  const reduceMotion = useReducedMotion()
  const [threadId, setThreadId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const context =
    navigation.target === 'installation'
      ? {
          kind: 'installation' as const,
          installationId: snapshot.installationId,
        }
      : { kind: 'organization' as const, organizationId: organizationId ?? '' }
  const conversations = useConversations(snapshot, agentId, context, threadId)
  const { data, chat, scope, scopeKey } = conversations
  const controls = useControlCommands(
    scopeKey,
    conversations.controls,
    conversations.apply,
  )
  const [panel, setPanel] = useState<'settings' | 'inbox' | null>(null)
  const [routeStatus, setRouteStatus] = useState('')
  const settingsTrigger = useRef<HTMLButtonElement>(null)
  const inboxTrigger = useRef<HTMLButtonElement>(null)
  const [resourceId, setResourceId] = useState<string | null>(null)
  const routeAbort = useRef<AbortController | null>(null)
  const focusedResource = useRef<string | null>(null)
  const routeGeneration = useRef(0)
  const notifications = conversations.records.notifications ?? []
  const attention = useAttention(
    platform,
    scopeKey,
    notifications,
    conversations.records.attention ?? [],
    threadId,
  )
  useEffect(
    () => () => {
      routeGeneration.current++
      routeAbort.current?.abort()
    },
    [scopeKey, organizationId, agentId],
  )
  async function openNotification(n: InboxNotification) {
    routeAbort.current?.abort()
    const abort = new AbortController()
    routeAbort.current = abort
    const generation = ++routeGeneration.current
    const target = n.target
    if (
      !conversations.client ||
      target.installationId !== scope.installationId ||
      target.callerId !== scope.callerId
    ) {
      setRouteStatus('The original notification context is unavailable.')
      return
    }
    try {
      const original = await conversations.client.history(
        target,
        null,
        abort.signal,
      )
      if (generation !== routeGeneration.current) return
      const originalChat = original.chats.find((c) => c.id === target.chatId)
      const originalThread = original.threads.find(
        (t) => t.id === target.threadId,
      )
      const originalAgent = originalChat?.participantIds.find(
        (id) => data.actorsById[id]?.kind === 'agent',
      )
      if (
        !originalChat ||
        !originalThread ||
        !originalAgent ||
        (target.context.kind === 'organization' &&
          !snapshot.memberships.some(
            (m) =>
              m.organizationId ===
                (target.context.kind === 'organization'
                  ? target.context.organizationId
                  : '') && m.actorId === originalAgent,
          ))
      ) {
        setRouteStatus(
          'The original thread or its organization membership is no longer available.',
        )
        return
      }
      conversations.apply(original)
      const interaction = original.work?.interactions.find(
        (i) => i.id === n.resourceId,
      )
      setRouteStatus(
        interaction && interaction.state !== 'pending'
          ? `The original request is ${interaction.state}. It cannot authorize new work.`
          : 'Opened the original context. Read state is unchanged.',
      )
      update({
        agentId: originalAgent,
        target: target.context.kind,
        ...(target.context.kind === 'organization'
          ? { organizationId: target.context.organizationId }
          : {}),
      })
      focusedResource.current = null
      setResourceId(n.resourceId)
      setThreadId(target.threadId)
      setExpanded(false)
      setPanel(null)
      attention.dismiss()
    } catch {
      if (generation === routeGeneration.current)
        setRouteStatus(
          'The original target is unavailable. Refresh the connection and try again; no interaction was changed.',
        )
    }
  }
  useEffect(() => {
    if (!resourceId || panel || focusedResource.current === resourceId) return
    const element = document.getElementById(`resource-${resourceId}`)
    if (element) {
      focusedResource.current = resourceId
      element.scrollIntoView({ block: 'center' })
      element.focus({ preventScroll: true })
    }
  }, [resourceId, panel, conversations.work])
  const workCommands = useWorkCommands(
    scopeKey,
    conversations.workClient,
    conversations.apply,
  )
  const outbox = useOutbox(scopeKey, conversations.client, conversations.apply)
  const agent = agentId ? (data.actorsById[agentId] as Agent) : undefined
  const notice = outbox.entries.some((e) => e.state === 'accepted')
    ? 'Message accepted by the process-memory fixture. No agent is connected.'
    : ''
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = platform.preferences.get('theme')
    return saved === 'dark' || saved === 'light'
      ? saved
      : matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
  })
  const closeThreadButton = useRef<HTMLButtonElement>(null)
  const threadTriggers = useRef(new Map<string, HTMLButtonElement>())
  const feedScroll = useRef<HTMLDivElement>(null)
  const threadScroll = useRef<HTMLDivElement>(null)
  const visible = Object.values(data.threadsById)
    .filter(
      (item) =>
        item.chatId === chat?.id && data.messagesById[item.rootMessageId],
    )
    .sort(
      (a, b) =>
        data.messagesById[a.rootMessageId].createdAt.localeCompare(
          data.messagesById[b.rootMessageId].createdAt,
        ) || a.id.localeCompare(b.id),
    )
  const selectedThread = threadId ? data.threadsById[threadId] : undefined
  const thread =
    chat && selectedThread?.chatId === chat.id ? selectedThread : undefined

  const rootHistory = useHistory(
    conversations.client,
    scopeKey,
    chat ? { ...scope, context, chatId: chat.id } : null,
    conversations.apply,
  )
  const replyHistory = useHistory(
    conversations.client,
    scopeKey,
    chat && thread
      ? { ...scope, context, chatId: chat.id, threadId: thread.id }
      : null,
    conversations.apply,
  )
  const feedFollowing = useScrollHistory(
    feedScroll,
    chat?.id ?? '',
    visible.map((t) => `${t.id}:${t.revision}`).join('|'),
    rootHistory.isSuccess,
  )
  const threadFollowing = useScrollHistory(
    threadScroll,
    thread?.id ?? '',
    thread?.messageIds
      .map((id) => `${id}:${data.messagesById[id]?.revision}`)
      .join('|') ?? '',
    replyHistory.isSuccess,
  )
  const historyControl = (kind: 'root' | 'reply') => {
    const history = kind === 'root' ? rootHistory : replyHistory
    const scroll = kind === 'root' ? feedFollowing : threadFollowing
    return (
      <div className="history-controls">
        {history.isPending && <span>Loading conversation history…</span>}
        {history.isError && (
          <>
            <span>History unavailable.</span>
            <button onClick={() => void history.refetch()}>
              Retry history
            </button>
          </>
        )}
        {history.hasNextPage && (
          <button
            disabled={history.isFetchingNextPage}
            onClick={() => {
              scroll.older()
              void history.fetchNextPage().then((result) => {
                if (result.isError) scroll.cancelAnchor()
              })
            }}
          >
            {history.isFetchingNextPage
              ? 'Loading earlier messages…'
              : 'Show earlier messages'}
          </button>
        )}
      </div>
    )
  }

  // Synchronize the app's theme with the browser environment, not derived UI state.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    platform.preferences.set('theme', theme)
  }, [theme, platform])
  useEffect(() => {
    if (threadId && !resourceId) closeThreadButton.current?.focus()
  }, [threadId, resourceId])

  const closeThread = useCallback(() => {
    const previous = threadId
    setResourceId(null)
    focusedResource.current = null
    setThreadId(null)
    setExpanded(false)
    if (previous)
      requestAnimationFrame(() => threadTriggers.current.get(previous)?.focus())
  }, [threadId])
  useEffect(() => {
    if (!threadId) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.isComposing &&
        !document.querySelector('dialog[open]')
      )
        closeThread()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [threadId, closeThread])
  function switchAgent(id: string, target: 'organization' | 'installation') {
    update({
      agentId: id,
      target,
    })
    setThreadId(null)
    setExpanded(false)
  }
  function switchOrganization(id: string) {
    update({ organizationId: id })
    if (navigation.target !== 'installation') {
      setThreadId(null)
      setExpanded(false)
    }
  }
  const composer = (key: string, label: string, parent?: string) => (
    <DurableComposer
      key={JSON.stringify([scopeKey, chat?.id, key])}
      scope={scopeKey}
      recordingContext={JSON.stringify([
        threadId,
        expanded,
        navigation.organizationId,
      ])}
      target={{
        ...scope,
        context,
        chatId: chat!.id,
        ...(parent ? { threadId: parent } : {}),
      }}
      label={label}
      disabled={!conversations.client || connectionStatus !== 'ready'}
      send={async (submission, draft) => {
        const reserved = await outbox.send(submission, draft)
        if (parent) threadFollowing.latest()
        else feedFollowing.latest()
        return reserved
      }}
    />
  )

  const notices = (
    <>
      {outbox.error && (
        <p className="connection-notice" role="alert">
          {outbox.error}
        </p>
      )}
      {conversations.connection && (
        <p className="connection-notice">
          {conversations.connection}{' '}
          <button onClick={conversations.reconnect}>Reconnect</button>
        </p>
      )}
    </>
  )
  const recovery = (parent?: string) => (
    <ConversationRecovery
      entries={outbox.entries.filter(
        (entry) =>
          entry.submission.target.chatId === chat?.id &&
          (parent
            ? entry.submission.target.threadId === parent
            : !entry.submission.target.threadId ||
              entry.submission.target.threadId !== thread?.id),
      )}
      data={data}
      retry={outbox.retry}
      discard={outbox.discard}
      openThread={
        parent
          ? undefined
          : (id) => {
              setThreadId(id)
              setExpanded(false)
            }
      }
    />
  )

  return (
    <LayoutGroup>
      <div
        className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''} ${thread ? 'has-thread' : ''} ${thread && expanded ? 'thread-expanded' : ''}`}
      >
        <a className="skip-link" href="#conversation">
          Skip to conversation
        </a>
        <Sidebar
          utilities={
            <div className="sidebar-utilities">
              <button
                className="management-trigger"
                ref={settingsTrigger}
                aria-label="Settings"
                title="Settings"
                onClick={() => setPanel('settings')}
              >
                <Icon name="settings" />
                <span className="sidebar-label">Settings</span>
              </button>
              <button
                className="management-trigger notification-bell"
                ref={inboxTrigger}
                aria-label={`Notifications, ${notifications.filter((n) => !n.read).length} unread`}
                title="Notifications"
                onClick={() => setPanel('inbox')}
              >
                <Icon name="bell" />
                <span className="sidebar-label">Notifications</span>
                {notifications.some((n) => !n.read) && (
                  <span className="unread-count">
                    {notifications.filter((n) => !n.read).length}
                  </span>
                )}
              </button>
            </div>
          }
          data={data}
          organizationId={organizationId}
          selectedAgentId={agentId}
          selectedTarget={navigation.target}
          collapsed={collapsed}
          onToggle={() =>
            update((current) => ({ collapsed: !current.collapsed }))
          }
          onOrganization={switchOrganization}
          onAgent={switchAgent}
          closedGroups={navigation.closedGroups}
          onGroup={(id) =>
            update((current) => ({
              closedGroups: current.closedGroups.includes(id)
                ? current.closedGroups.filter((item) => item !== id)
                : [...current.closedGroups, id],
            }))
          }
          connectionStatus={connectionStatus}
          fixture={fixture}
          reconnect={reconnect}
        />
        {chat && agent ? (
          <>
            <motion.main
              layout={reduceMotion ? false : 'position'}
              id="conversation"
              className="conversation"
              tabIndex={-1}
            >
              <header className="pane-header">
                <div>
                  <h1>{agent.name}</h1>
                  <p>{agent.description}</p>
                </div>
                <div className="header-actions">
                  <span className="preview-badge">Demo</span>
                  <motion.button
                    whileTap={reduceMotion ? undefined : { scale: 0.9 }}
                    className="icon-button"
                    aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
                    onClick={() =>
                      setTheme((value) =>
                        value === 'light' ? 'dark' : 'light',
                      )
                    }
                  >
                    <motion.span
                      key={theme}
                      initial={{ opacity: 0, rotate: reduceMotion ? 0 : -35 }}
                      animate={{ opacity: 1, rotate: 0 }}
                      transition={quickFade}
                    >
                      <Icon name={theme === 'light' ? 'moon' : 'sun'} />
                    </motion.span>
                  </motion.button>
                </div>
              </header>
              <div ref={feedScroll} className="conversation-scroll">
                {historyControl('root')}
                <RootFeed
                  work={conversations.work}
                  chat={chat}
                  agent={agent}
                  data={data}
                  visible={visible}
                  threadId={threadId}
                  triggers={threadTriggers}
                  onOpen={(id) => {
                    setThreadId(id)
                    setExpanded(false)
                  }}
                />
              </div>
              {feedFollowing.unread && (
                <button className="jump-latest" onClick={feedFollowing.latest}>
                  Back to latest messages
                </button>
              )}
              {workCommands.entries
                .filter(
                  (e) =>
                    e.operation.target.chatId === chat.id &&
                    e.operation.target.threadId !== thread?.id &&
                    !['accepted', 'rejected'].includes(e.state),
                )
                .map((e) => (
                  <div className="connection-notice" key={e.id}>
                    Unresolved work command in{' '}
                    {data.threadsById[e.operation.target.threadId]?.title ??
                      'original thread'}
                    .{' '}
                    <button
                      onClick={() => setThreadId(e.operation.target.threadId)}
                    >
                      Open work recovery
                    </button>
                  </div>
                ))}
              {recovery()}
              {!thread && notices}
              {composer(rootDraftKey(chat.id), `Message ${agent.name}…`)}
            </motion.main>
            <AnimatePresence initial={false} mode="popLayout">
              {thread && (
                <ThreadPane
                  key={thread.id}
                  thread={thread}
                  data={data}
                  expanded={expanded}
                  onExpand={() => setExpanded((value) => !value)}
                  onClose={closeThread}
                  closeButton={closeThreadButton}
                  scroll={threadScroll}
                  queue={conversations.work.queue}
                  work={
                    <WorkPanel
                      work={conversations.work}
                      threadId={thread.id}
                      data={data}
                      commands={workCommands}
                    />
                  }
                  history={historyControl('reply')}
                  recovery={
                    <>
                      <WorkRecovery
                        work={conversations.work}
                        commands={workCommands}
                        threadId={thread.id}
                      />
                      {recovery(thread.id)}
                      {notices}
                    </>
                  }
                  composer={composer(
                    replyDraftKey(thread.id),
                    'Reply in this thread…',
                    thread.id,
                  )}
                  unread={threadFollowing.unread}
                  latest={threadFollowing.latest}
                />
              )}
            </AnimatePresence>
          </>
        ) : (
          <main id="conversation" className="workspace-state" tabIndex={-1}>
            <Icon name="leaf" size={38} />
            <h1>
              {agent
                ? conversations.resolve.isPending && conversations.client
                  ? `Opening ${agent.name}’s conversation…`
                  : `${agent.name}’s conversation is unavailable`
                : organizationId
                  ? 'No agents in this organization'
                  : 'No organizations yet'}
            </h1>
            <p>
              {agent
                ? conversations.resolve.isPending && conversations.client
                  ? 'Opening conversation…'
                  : (conversations.resolve.error?.message ??
                    'Conversation service is not configured.')
                : 'Choose another organization or open Admin for installation-level conversations.'}
            </p>
            {agent && (
              <button onClick={() => void conversations.resolve.refetch()}>
                Retry conversation
              </button>
            )}
          </main>
        )}
        {panel === 'settings' && (
          <SettingsPanel
            scope={scope}
            scopeKey={scopeKey}
            client={conversations.controls}
            records={conversations.records}
            apply={conversations.apply}
            commands={controls}
            snapshot={snapshot}
            organizationId={organizationId}
            agentId={agentId}
            installation={navigation.target === 'installation'}
            platform={platform}
            close={() => {
              setPanel(null)
              requestAnimationFrame(() => settingsTrigger.current?.focus())
            }}
          />
        )}
        {panel === 'inbox' && (
          <Inbox
            availability={
              !conversations.controls
                ? 'Notification service is not configured.'
                : conversations.connection
                  ? 'Inbox updates are reconnecting. Showing the last received records.'
                  : ''
            }
            notifications={notifications}
            scope={scope}
            commands={controls}
            open={(n) => void openNotification(n)}
            routeStatus={routeStatus}
            close={() => {
              setPanel(null)
              requestAnimationFrame(() => inboxTrigger.current?.focus())
            }}
          />
        )}
        {attention.notice && (
          <output className="attention-toast">
            <span>{attention.notice.title}</span>
            <button onClick={() => void openNotification(attention.notice!)}>
              Open
            </button>
            <button aria-label="Dismiss attention" onClick={attention.dismiss}>
              <Icon name="close" />
            </button>
          </output>
        )}
        <output className="sr-only">
          {notice} {attention.delivery} {panel ? '' : routeStatus}
        </output>
      </div>
    </LayoutGroup>
  )
}
