import { useEffect, useState } from 'react'
import {
  ConversationError,
  type CallerScope,
  type ConversationClient,
  type Records,
} from './conversations'
function backoff(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
  })
}
/** Each invocation owns one cursor domain and abandons all previous request generations. */
export function useConversationStream(
  client: ConversationClient | undefined,
  scope: CallerScope,
  threadId: string | null,
  enabled: boolean,
  apply: (records: Records) => void,
  restart: number,
) {
  const [status, setStatus] = useState('Connecting conversations…')
  useEffect(() => {
    if (!client || !enabled) return
    const abort = new AbortController()
    const domain = threadId ? `thread:${threadId}` : 'application'
    let cursor: string | null = null
    let appliedSequence = -1
    let failures = 0
    async function connect() {
      while (!abort.signal.aborted) {
        try {
          if (cursor === null) {
            const initial = await client!.snapshot(
              scope,
              threadId,
              abort.signal,
            )
            if (abort.signal.aborted) return
            if (initial.domain !== domain)
              throw new ConversationError(
                'Conversation snapshot has the wrong scope.',
                'malformed',
              )
            apply(initial)
            cursor = initial.cursor
            appliedSequence = initial.sequence
          }
          setStatus('')
          await client!.events(
            scope,
            threadId,
            cursor,
            abort.signal,
            (event) => {
              if (abort.signal.aborted) return
              if (event.domain !== domain)
                throw new ConversationError(
                  'Conversation update has the wrong scope.',
                  'malformed',
                )
              if (event.sequence <= appliedSequence) return
              apply(event)
              appliedSequence = event.sequence
              cursor = event.cursor
              failures = 0
            },
          )
        } catch (error) {
          if (abort.signal.aborted) return
          setStatus(
            error instanceof ConversationError && error.code === 'malformed'
              ? error.message
              : 'Live updates disconnected. Reconnecting…',
          )
          if (
            error instanceof ConversationError &&
            ['cursor-expired', 'malformed'].includes(error.code)
          )
            cursor = null
          await backoff(abort.signal, Math.min(10000, 500 * 2 ** failures++))
        }
      }
    }
    void connect()
    return () => abort.abort()
  }, [client, scope, threadId, enabled, apply, restart])
  return enabled ? status : ''
}
