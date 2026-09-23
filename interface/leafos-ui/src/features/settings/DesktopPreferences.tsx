import { useState } from 'react'
import type { Platform } from '../../platform/platform'
const preferenceKey = (scope: string) => `desktop-notifications:${scope}`
export function DesktopPreferences({
  platform,
  scopeKey,
}: {
  platform: Platform
  scopeKey: string
}) {
  const [enabled, setEnabled] = useState(
    () => platform.preferences.get(preferenceKey(scopeKey)) === 'enabled',
  )
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  async function enable() {
    setBusy(true)
    try {
      const result = await platform.notifications.send({
        title: 'LeafOS notifications',
        body: 'Desktop notification test. Your inbox is unchanged.',
      })
      if (result.status === 'requested') {
        platform.preferences.set(preferenceKey(scopeKey), 'enabled')
        if (platform.preferences.get(preferenceKey(scopeKey)) !== 'enabled')
          throw new Error('Preference was not saved')
        setEnabled(true)
        setStatus(
          'Desktop notification requested. The OS may suppress it; delivery is not confirmed.',
        )
      } else
        setStatus(
          `Desktop notifications ${result.status}. Your persistent inbox remains available.`,
        )
    } catch {
      setStatus('Notification preferences could not be saved. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="desktop-preferences">
      <h3>Desktop attention</h3>
      <p>
        {platform.notifications.supported
          ? 'Enable alerts when LeafOS is in the background. This action may request operating system permission.'
          : 'Open the LeafOS desktop app to try native notifications.'}
      </p>
      <button
        disabled={!platform.notifications.supported || busy}
        onClick={() => void enable()}
      >
        {enabled ? 'Send test notification' : 'Enable and test notifications'}
      </button>
      {enabled && (
        <button
          disabled={busy}
          onClick={() => {
            try {
              platform.preferences.set(preferenceKey(scopeKey), 'disabled')
              if (
                platform.preferences.get(preferenceKey(scopeKey)) !== 'disabled'
              )
                throw new Error('Preference was not saved')
              setEnabled(false)
              setStatus('Background desktop alerts disabled.')
            } catch {
              setStatus(
                'Preference could not be saved. Background alerts may still be enabled. Retry Disable desktop alerts.',
              )
            }
          }}
        >
          Disable desktop alerts
        </button>
      )}
      <output>{status}</output>
      <p>
        Alerts are best effort while the app can receive updates. Fully closed
        or suspended delivery is not guaranteed. Reconnect restores the inbox
        without replaying old alerts. This browser profile suppresses repeated
        alerts across tabs; other devices may still alert.
      </p>
      <p>
        Notification clicks are not supported by this host integration. Open
        LeafOS and use the inbox to visit the exact original context.
      </p>
    </section>
  )
}
