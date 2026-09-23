import type { Records } from './conversations.js'
export function mergeRecords(previous: Records, incoming: Records): Records {
  function merge<T extends { id: string; revision?: number }>(
    old: T[],
    next: T[],
  ) {
    const map = new Map(old.map((v) => [v.id, v]))
    for (const item of next) {
      const current = map.get(item.id)
      if (!current || (item.revision ?? 0) > (current.revision ?? 0))
        map.set(item.id, item)
    }
    return [...map.values()]
  }
  return {
    settings: merge(previous.settings ?? [], incoming.settings ?? []),
    effective: merge(previous.effective ?? [], incoming.effective ?? []),
    notifications: merge(
      previous.notifications ?? [],
      incoming.notifications ?? [],
    ),
    attention: [
      ...new Set([
        ...(previous.attention ?? []),
        ...(incoming.attention ?? []),
      ]),
    ],
    work: {
      workflows: merge(
        previous.work?.workflows ?? [],
        incoming.work?.workflows ?? [],
      ),
      runs: merge(previous.work?.runs ?? [], incoming.work?.runs ?? []),
      attempts: merge(
        previous.work?.attempts ?? [],
        incoming.work?.attempts ?? [],
      ),
      queue: merge(previous.work?.queue ?? [], incoming.work?.queue ?? []),
      activity: merge(
        previous.work?.activity ?? [],
        incoming.work?.activity ?? [],
      ),
      delegations: merge(
        previous.work?.delegations ?? [],
        incoming.work?.delegations ?? [],
      ),
      interactions: merge(
        previous.work?.interactions ?? [],
        incoming.work?.interactions ?? [],
      ),
    },
    chats: merge(previous.chats, incoming.chats),
    threads: merge(previous.threads, incoming.threads),
    messages: merge(
      previous.messages,
      incoming.messages.filter(
        (m) =>
          m.status !== 'draft' ||
          previous.messages.find((old) => old.id === m.id)?.status !== 'final',
      ),
    ),
    artifacts: merge(previous.artifacts, incoming.artifacts),
  }
}
