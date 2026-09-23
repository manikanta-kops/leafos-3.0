import { mergeRecords } from './merge-records'
import { emptyWork, type WorkResource } from './work'
import { useConversationStream } from './use-conversation-stream'
import { useCallback, useContext, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClientContext } from './workspace-hooks'
import { emptyRecords, type Records, type CallerScope } from './conversations'
import type { ChatContext, PreviewData } from '../features/chat/model'
import type { WorkspaceSnapshot } from './workspace-client'

export function useConversations(
  snapshot: WorkspaceSnapshot,
  agentId: string | null,
  context: ChatContext,
  threadId: string | null,
) {
  const workspace = useContext(ClientContext)!
  const client = workspace.conversations
  const queries = useQueryClient()
  const scope = useMemo<CallerScope>(
    () => ({
      installationId: snapshot.installationId,
      callerId: snapshot.currentHumanId,
    }),
    [snapshot.installationId, snapshot.currentHumanId],
  )
  const scopeKey = JSON.stringify([
    workspace.connectionKey,
    scope.installationId,
    scope.callerId,
  ])
  const cacheKey = useMemo(() => ['conversations', scopeKey], [scopeKey])
  const records = useQuery({
    queryKey: cacheKey,
    queryFn: async () => emptyRecords(),
    initialData: emptyRecords,
    staleTime: Infinity,
  }).data
  const apply = useCallback(
    (incoming: Records) => {
      if (
        incoming.notifications?.some(
          (n) =>
            n.recipientId !== scope.callerId ||
            n.target.installationId !== scope.installationId,
        )
      )
        return
      if (
        incoming.work &&
        Object.values(incoming.work).some((list) =>
          list.some(
            (item: WorkResource) =>
              item.target.installationId !== scope.installationId ||
              item.target.callerId !== scope.callerId,
          ),
        )
      )
        return
      queries.setQueryData<Records>(cacheKey, (old) =>
        mergeRecords(old ?? emptyRecords(), incoming),
      )
    },
    [queries, cacheKey, scope],
  )
  const [restart, setRestart] = useState(0)
  const connection = useConversationStream(
    client,
    scope,
    null,
    true,
    apply,
    restart,
  )
  const resolve = useQuery({
    queryKey: ['direct-chat', scopeKey, agentId, context],
    queryFn: ({ signal }) => client!.resolve(scope, agentId!, context, signal),
    enabled: !!client && !!agentId,
    retry: 1,
  })
  const chat = resolve.data
  const activeThreadId = records.threads.some(
    (t) => t.id === threadId && t.chatId === chat?.id,
  )
    ? threadId
    : null
  const threadConnection = useConversationStream(
    client,
    scope,
    activeThreadId,
    !!activeThreadId,
    apply,
    restart,
  )

  const data: PreviewData = {
    ...snapshot,
    chatsById: Object.fromEntries(
      [...records.chats, ...(chat ? [chat] : [])].map((v) => [v.id, v]),
    ),
    threadsById: Object.fromEntries(records.threads.map((v) => [v.id, v])),
    messagesById: Object.fromEntries(records.messages.map((v) => [v.id, v])),
    artifactsById: Object.fromEntries(records.artifacts.map((v) => [v.id, v])),
  }
  return {
    client,
    records,
    controls: workspace.controls,
    work: records.work ?? emptyWork(),
    workClient: workspace.work,
    scope,
    scopeKey,
    data,
    chat,
    apply,
    connection: !client
      ? 'Conversation service is not configured.'
      : connection || (activeThreadId ? threadConnection : ''),
    resolve,
    reconnect: () => setRestart((v) => v + 1),
  }
}
