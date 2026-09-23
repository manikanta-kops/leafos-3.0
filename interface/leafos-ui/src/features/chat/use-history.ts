import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import type {
  ConversationClient,
  ConversationTarget,
  Records,
} from '../../data/conversations'
export function useHistory(
  client: ConversationClient | undefined,
  scope: string,
  target: ConversationTarget | null,
  apply: (records: Records) => void,
) {
  const query = useInfiniteQuery({
    queryKey: ['history', scope, target],
    initialPageParam: null as string | null,
    queryFn: ({ signal, pageParam }) =>
      client!.history(target!, pageParam, signal),
    getNextPageParam: (page) => page.next ?? undefined,
    enabled: !!client && !!target,
    retry: 1,
  })
  useEffect(() => {
    for (const page of query.data?.pages ?? []) apply(page)
  }, [query.data, apply])
  return query
}
