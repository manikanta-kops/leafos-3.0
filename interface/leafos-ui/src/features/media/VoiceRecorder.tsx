import {
  useContext,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
} from 'react'
import { PlatformContext } from '../../platform/context'
import { Icon } from '../../components/Icon'
import type { RecordingSession } from '../../platform/recording'
export function VoiceRecorder({
  disabled,
  ref,
  onRecorded,
  onBusyChange,
}: {
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  ref?: Ref<{ start(): void }>
  onRecorded: (blob: Blob) => Promise<void>
}) {
  const platform = useContext(PlatformContext)
  const [state, setState] = useState<
    'idle' | 'requesting' | 'recording' | 'stopped' | 'error'
  >('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const session = useRef<RecordingSession | null>(null)
  const stopButton = useRef<HTMLButtonElement>(null)
  const mic = useRef<HTMLButtonElement>(null)
  const cleanup = () => {
    generation.current++
    controller.current?.abort()
    session.current?.cancel()
    session.current = null
  }
  useEffect(
    () => () => {
      cleanup()
      onBusyChange(false)
    },
    [onBusyChange],
  )
  useEffect(() => {
    if (state !== 'recording') return
    stopButton.current?.focus()
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [state])
  useImperativeHandle(ref, () => ({
    start() {
      void start()
    },
  }))
  async function start() {
    cleanup()
    const current = generation.current
    const abort = new AbortController()
    controller.current = abort
    onBusyChange(true)
    setState('requesting')
    setError('')
    setSeconds(0)
    try {
      if (!platform?.recording)
        throw new Error('Recording is unavailable on this platform.')
      const captured = await platform.recording.start(abort.signal)
      if (current !== generation.current) {
        captured.cancel()
        return
      }
      session.current = captured
      void captured.finished?.catch((e) => {
        if (current === generation.current) {
          cleanup()
          onBusyChange(false)
          setState('error')
          setError(e instanceof Error ? e.message : 'Recording failed.')
        }
      })
      setState('recording')
    } catch (e) {
      if (current === generation.current) {
        cleanup()
        onBusyChange(false)
        setState('error')
        setError(
          e instanceof Error && e.name === 'NotAllowedError'
            ? 'Microphone permission denied. You can attach an audio file instead.'
            : e instanceof Error
              ? e.message
              : 'Microphone unavailable.',
        )
      }
    }
  }
  async function stop() {
    const current = generation.current
    setState('stopped')
    try {
      const blob = await session.current!.stop()
      if (current !== generation.current) return
      session.current = null
      await onRecorded(blob)
      if (current === generation.current) {
        onBusyChange(false)
        setState('idle')
        mic.current?.focus()
      }
    } catch (e) {
      if (current === generation.current) {
        cleanup()
        onBusyChange(false)
        setState('error')
        setError(e instanceof Error ? e.message : 'Recording failed.')
      }
    }
  }
  return (
    <div className="voice-control">
      {['idle', 'error'].includes(state) && (
        <button
          ref={mic}
          type="button"
          className="icon-button"
          disabled={disabled}
          aria-label="Record voice note"
          onClick={() => void start()}
        >
          <Icon name="microphone" />
        </button>
      )}
      {state === 'requesting' && <output>Requesting microphone…</output>}
      {state === 'recording' && (
        <>
          <output>
            Recording {Math.floor(seconds / 60)}:
            {String(seconds % 60).padStart(2, '0')}
          </output>
          <button ref={stopButton} type="button" onClick={() => void stop()}>
            Stop recording
          </button>
        </>
      )}
      {state === 'stopped' && <output>Saving recording for review…</output>}
      {['requesting', 'recording'].includes(state) && (
        <button
          type="button"
          onClick={() => {
            cleanup()
            onBusyChange(false)
            setState('idle')
            mic.current?.focus()
          }}
        >
          Cancel recording
        </button>
      )}
      {error && (
        <span role="alert" className="media-error">
          {error}
        </span>
      )}
    </div>
  )
}
