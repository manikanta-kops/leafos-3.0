import {
  useEffect,
  useState,
  useMemo,
  useRef,
  useContext,
  type ReactNode,
} from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { WorkspaceClient, WorkspaceSnapshot } from './workspace-client'
import { readPreferences, persistPreferences } from './preferences'
import {
  createNavigationStore,
  defaultNavigation,
  type Navigation,
} from '../features/workspace/navigation'

import {
  ClientContext,
  NavigationContext,
  PreferencesContext,
} from './workspace-hooks'

export function WorkspaceProvider({
  client,
  children,
}: {
  client: WorkspaceClient
  children: ReactNode
}) {
  // Remount the connection boundary whenever destination changes; old requests are cancelled on unmount.
  return (
    <ConnectionProvider key={client.connectionKey} client={client}>
      {children}
    </ConnectionProvider>
  )
}
function ConnectionProvider({
  client,
  children,
}: {
  client: WorkspaceClient
  children: ReactNode
}) {
  const [queries] = useState(() => new QueryClient())
  useEffect(
    () => () => {
      void queries.cancelQueries()
      queries.clear()
    },
    [queries],
  )
  return (
    <ClientContext.Provider value={client}>
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    </ClientContext.Provider>
  )
}
export function NavigationProvider({
  data,
  connectionKey,
  children,
}: {
  data: WorkspaceSnapshot
  connectionKey: string
  children: ReactNode
}) {
  const scope = JSON.stringify([
    connectionKey,
    data.installationId,
    data.currentHumanId,
  ])
  return (
    <ScopedNavigation key={scope} scope={scope}>
      {children}
    </ScopedNavigation>
  )
}
function ScopedNavigation({
  scope,
  children,
}: {
  scope: string
  children: ReactNode
}) {
  const preferences = useContext(PreferencesContext)
  const [store] = useState(() => createNavigationStore(defaultNavigation))
  const mounted = useRef(false)
  const [ready, setReady] = useState(false)
  const [storageError, setStorageError] = useState(false)
  useEffect(() => {
    mounted.current = true
    let accepting = true
    const finish = (saved?: Navigation) => {
      if (!accepting) return
      accepting = false
      clearTimeout(timeout)
      if (saved) store.setState(saved, true)
      else setStorageError(true)
      setReady(true)
    }
    // A blocked IndexedDB open cannot hold the workspace indefinitely. Late restoration
    // is ignored after this deadline, including after the user has begun navigating.
    const timeout = setTimeout(() => finish(), 1000)
    void readPreferences(preferences, scope).then(
      (saved) => finish(saved),
      () => finish(),
    )
    return () => {
      accepting = false
      mounted.current = false
      clearTimeout(timeout)
    }
  }, [scope, store, preferences])
  const navigationContext = useMemo(
    () => ({
      store,
      save(change: (current: Navigation) => Navigation) {
        const next = change(store.getState())
        store.setState(next, true)
        // Capture each revision now, then serialize storage independently of live navigation.
        void persistPreferences(preferences, scope, next).catch(() => {
          if (mounted.current) setStorageError(true)
        })
      },
    }),
    [scope, store, preferences],
  )
  if (!ready)
    return <output className="workspace-state">Restoring workspace…</output>
  return (
    <NavigationContext.Provider value={navigationContext}>
      {storageError && (
        <output className="storage-warning">
          Local preferences are unavailable or still loading. Navigation works
          for this session; recent choices may not survive reload.
        </output>
      )}
      {children}
    </NavigationContext.Provider>
  )
}
