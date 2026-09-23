import { PlatformContext } from '../platform/context'
import type { Platform } from '../platform/platform'
import type { WorkspaceClient } from '../data/workspace-client'
import { WorkspaceProvider } from '../data/WorkspaceProvider'
import { WorkspaceGate } from '../features/workspace/WorkspaceGate'
import '../styles/app.css'

export default function App({
  platform,
  client,
}: {
  platform: Platform
  client: WorkspaceClient
}) {
  return (
    <PlatformContext.Provider value={platform}>
      <WorkspaceProvider client={client}>
        <WorkspaceGate platform={platform} />
      </WorkspaceProvider>
    </PlatformContext.Provider>
  )
}
