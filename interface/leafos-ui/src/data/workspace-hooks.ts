import { createContext, useContext, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from 'zustand'
import {
  navigationPreferences,
  type NavigationPreferences,
} from './preferences'
import type { WorkspaceClient, WorkspaceSnapshot } from './workspace-client'
import {
  createNavigationStore,
  resolveNavigation,
  type Navigation,
} from '../features/workspace/navigation'
export const PreferencesContext = createContext<NavigationPreferences>(
  navigationPreferences,
)
export const ClientContext = createContext<WorkspaceClient | null>(null)
export const NavigationContext = createContext<{
  store: ReturnType<typeof createNavigationStore>
  save: (change: (current: Navigation) => Navigation) => void
} | null>(null)
export function useWorkspace() {
  const client = useContext(ClientContext)!
  const query = useQuery({
    queryKey: ['workspace', client.connectionKey],
    queryFn: ({ signal }) => client.readWorkspace(signal),
    enabled: !client.configurationError,
    retry: 1,
    retryDelay: 500,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })
  return { ...query, client }
}
export function useNavigation(data: WorkspaceSnapshot) {
  const { store, save } = useContext(NavigationContext)!
  const saved = useStore(store)
  const navigation = resolveNavigation(data, saved)
  useEffect(() => {
    const resolved = resolveNavigation(data, store.getState())
    if (JSON.stringify(resolved) !== JSON.stringify(store.getState()))
      save((current) => resolveNavigation(data, current))
  }, [data, store, save])
  const update = (
    patch: Partial<Navigation> | ((current: Navigation) => Partial<Navigation>),
  ) =>
    save((current) =>
      resolveNavigation(data, {
        ...current,
        ...(typeof patch === 'function' ? patch(current) : patch),
      }),
    )
  return { navigation, update }
}
