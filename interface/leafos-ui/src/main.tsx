import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import { resolvePlatform } from './platform/resolve'
import { MotionConfig } from 'motion/react'
import { paneSpring } from './app/motion'
import { createWorkspaceClient } from './data/workspace-client'

const platform = await resolvePlatform()
const fixture =
  import.meta.env.DEV || import.meta.env.VITE_WORKSPACE_FIXTURE === 'true'
const client = createWorkspaceClient(
  fixture ? '/__fixtures/workspace' : import.meta.env.VITE_WORKSPACE_URL,
  fixture,
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user" transition={paneSpring}>
      <App platform={platform} client={client} />
    </MotionConfig>
  </StrictMode>,
)
