import { controlJournal } from '../src/data/control-journal'
import {
  requestNotification,
  sendExistingNotification,
} from '../src/platform/notification-service'
import { workJournal } from '../src/data/work-journal'
import {
  mediaStorage,
  conversationStorage,
} from '../src/data/conversation-storage'
// Included only in the explicitly enabled browser-test build.
import { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../src/app/App'
import { createWorkspaceClient } from '../src/data/workspace-client'
import { resolvePlatform } from '../src/platform/resolve'
import { PreferencesContext } from '../src/data/workspace-hooks'
import {
  navigationPreferences,
  type NavigationPreferences,
} from '../src/data/preferences'

const platform = await resolvePlatform()
const parameters = new URLSearchParams(location.search)
const notificationTest = {
  prompts: 0,
  attentionChecks: 0,
  sends: [] as string[],
  permission: 'granted',
  failure: false,
}
if (parameters.has('notification')) {
  Object.assign(window, { notificationTest })
  const driver = {
    async isPermissionGranted() {
      return notificationTest.permission === 'granted'
    },
    async requestPermission() {
      notificationTest.prompts++
      return notificationTest.permission
    },
    sendNotification(message: { title: string }) {
      if (notificationTest.failure) throw new Error('Synthetic failure')
      notificationTest.sends.push(message.title)
    },
  }
  platform.attention = {
    isForeground: () => {
      notificationTest.attentionChecks++
      return parameters.get('notification') !== 'background'
    },
  }
  platform.notifications = {
    supported: true,
    send: (message) => requestNotification(driver, message),
    sendExisting: (message) => sendExistingNotification(driver, message),
  }
}
let rejectControlRead = parameters.get('control-storage') === 'fail-read'
const listControl = controlJournal.list
controlJournal.list = async (...args) => {
  if (rejectControlRead) throw new Error('Control storage read failure')
  return listControl(...args)
}
let rejectControlReserve = parameters.get('control-storage') === 'fail-reserve'
const reserveControl = controlJournal.reserve
controlJournal.reserve = async (...args) => {
  if (rejectControlReserve)
    throw new Error('Control storage reservation failure')
  return reserveControl(...args)
}

// Exercise the same pre-mount construction as main.tsx, including invalid configuration.
let holdDraftRead = parameters.get('draft') === 'slow-read'
let holdDraftWrite = parameters.get('draft') === 'slow-write'
let rejectDraftRead = parameters.get('draft') === 'fail-read'
let rejectDraftWrite = parameters.get('draft') === 'fail-write'
let rejectReservation = parameters.get('draft') === 'fail-reserve'
const releaseDraftReads: Array<() => void> = []
const releaseDraftWrites: Array<() => void> = []
const originalList = conversationStorage.list
conversationStorage.list = async (scope) => {
  if (parameters.get('outbox') === 'fail-read')
    throw new Error('Test outbox read failure')
  return originalList(scope)
}
const originalRead = conversationStorage.readDraft
const originalWrite = conversationStorage.writeDraft
const originalReserve = conversationStorage.reserve
conversationStorage.readDraft = async (key) => {
  if (rejectDraftRead) throw new Error('Test draft read failure')
  const result = await originalRead(key)
  if (holdDraftRead)
    await new Promise<void>((resolve) => releaseDraftReads.push(resolve))
  return result
}
conversationStorage.writeDraft = async (...args) => {
  if (holdDraftWrite)
    await new Promise<void>((resolve) => releaseDraftWrites.push(resolve))
  if (rejectDraftWrite) throw new Error('Test draft storage failure')
  return originalWrite(...args)
}
conversationStorage.reserve = async (...args) => {
  if (rejectReservation)
    throw new Error('Message could not be saved. Your input is retained.')
  return originalReserve(...args)
}
let rejectWorkRead = parameters.get('work-storage') === 'fail-read'
const listWork = workJournal.list
workJournal.list = async (...args) => {
  if (rejectWorkRead) throw new Error('Work journal read failed')
  return listWork(...args)
}
const reserveWork = workJournal.reserve
workJournal.reserve = async (...args) => {
  if (parameters.get('work-storage') === 'fail-reserve')
    throw new Error('Work storage unavailable')
  return reserveWork(...args)
}
let holdMediaStorage = parameters.get('media-storage') === 'slow'
const releaseMediaWrites: Array<() => void> = []
let rejectMediaStorage = parameters.get('media-storage') === 'fail'
const addMedia = mediaStorage.add
mediaStorage.add = async (...args) => {
  if (holdMediaStorage)
    await new Promise<void>((resolve) => releaseMediaWrites.push(resolve))
  if (rejectMediaStorage)
    throw new DOMException('Quota exceeded', 'QuotaExceededError')
  return addMedia(...args)
}
const initialClient = createWorkspaceClient(
  parameters.get('endpoint') ?? '/__fixtures/a',
  !parameters.has('endpoint') || parameters.get('fixture') === '1',
)
export function Harness() {
  const [client, setClient] = useState(initialClient)
  const holding = useRef(false)
  const rejecting = useRef(false)
  const releaseWrites = useRef<Array<() => void>>([])
  const releaseRead = useRef<() => void>(() => {})
  const [waiting, setWaiting] = useState(false)
  const preferences = useMemo<NavigationPreferences>(
    () => ({
      async read(scope) {
        const saved = await navigationPreferences.read(scope)
        if (parameters.get('storage') === 'slow-read')
          await new Promise<void>((resolve) => {
            releaseRead.current = resolve
          })
        return saved
      },
      async write(scope, value) {
        if (holding.current) {
          setWaiting(true)
          await new Promise<void>((resolve) => {
            releaseWrites.current.push(resolve)
          })
          setWaiting(false)
        }
        if (rejecting.current) throw new Error('Test write rejection')
        await navigationPreferences.write(scope, value)
      },
    }),
    [],
  )
  return (
    <>
      <div aria-label="Test connection controls">
        <button
          onClick={() => {
            rejectMediaStorage = false
            holdMediaStorage = false
            releaseMediaWrites.splice(0).forEach((release) => release())
          }}
        >
          Allow media storage
        </button>
        <button
          onClick={() => {
            rejectControlRead = false
            rejectControlReserve = false
            rejectWorkRead = false
          }}
        >
          Allow work storage
        </button>
        <button
          onClick={() => {
            holdDraftRead = false
            releaseDraftReads.splice(0).forEach((resolve) => resolve())
          }}
        >
          Release draft reads
        </button>
        <button
          onClick={() => {
            holdDraftWrite = true
          }}
        >
          Hold draft writes
        </button>
        <button
          onClick={() => {
            holdDraftWrite = false
            releaseDraftWrites.splice(0).forEach((resolve) => resolve())
          }}
        >
          Release draft writes
        </button>
        <button
          onClick={() => {
            rejectDraftRead = false
            rejectDraftWrite = false
            rejectReservation = false
          }}
        >
          Allow draft storage
        </button>
        <button
          onClick={() =>
            setClient(createWorkspaceClient('/__fixtures/a', true))
          }
        >
          Connect A
        </button>
        <button
          onClick={() =>
            setClient(createWorkspaceClient('/__fixtures/b', true))
          }
        >
          Connect B
        </button>
        <button
          onClick={() => {
            holding.current = true
          }}
        >
          Hold writes
        </button>
        <button
          onClick={() => {
            holding.current = false
            releaseWrites.current.splice(0).forEach((release) => release())
          }}
        >
          Release writes
        </button>
        <button
          onClick={() => {
            rejecting.current = true
          }}
        >
          Reject writes
        </button>
        <button
          onClick={() => {
            rejecting.current = false
          }}
        >
          Allow writes
        </button>
        <button onClick={() => releaseRead.current()}>Release reads</button>
        <span>{waiting ? 'Write held' : 'No held write'}</span>
      </div>
      <PreferencesContext.Provider value={preferences}>
        <App platform={platform} client={client} />
      </PreferencesContext.Provider>
    </>
  )
}
createRoot(document.getElementById('root')!).render(<Harness />)
