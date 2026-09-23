import { NavigationProvider } from '../../data/WorkspaceProvider'
import { useWorkspace } from '../../data/workspace-hooks'
import type { Platform } from '../../platform/platform'
import { Workspace } from './Workspace'
import { Icon } from '../../components/Icon'

export function WorkspaceGate({ platform }: { platform: Platform }) {
  const query = useWorkspace()
  const error = query.client.configurationError ?? query.error
  if (!query.data)
    return (
      <main className="workspace-state">
        <Icon name="leaf" size={38} />
        <h1>
          {error
            ? 'Workspace unavailable'
            : query.fetchStatus === 'paused'
              ? 'Waiting for a connection'
              : 'Opening your workspace…'}
        </h1>
        <p>{error ? error.message : 'Loading organizations and agents.'}</p>
        {error && (
          <button
            className="primary-button"
            onClick={() =>
              query.client.configurationError
                ? window.location.reload()
                : void query.refetch()
            }
          >
            {query.client.configurationError ? 'Reload client' : 'Try again'}
          </button>
        )}
        <small>
          {query.client.fixture
            ? 'Development HTTP fixture · No Core connected'
            : 'LeafOS client'}
        </small>
      </main>
    )
  return (
    <NavigationProvider
      data={query.data}
      connectionKey={query.client.connectionKey}
    >
      <Workspace
        platform={platform}
        snapshot={query.data}
        fixture={query.client.fixture}
        connectionStatus={
          query.fetchStatus === 'paused'
            ? 'offline'
            : query.isFetching
              ? 'reconnecting'
              : query.isError
                ? 'unavailable'
                : 'ready'
        }
        reconnect={() => void query.refetch()}
      />
    </NavigationProvider>
  )
}
