import { useCallback, useRef, useState } from 'react'
import type { PendingMedia } from '../../data/conversation-storage'
import type { useMediaDraft } from '../media/use-media-draft'
import { BlobPreview } from '../media/BlobPreview'
import { VoiceRecorder } from '../media/VoiceRecorder'
import { formatSize } from './model'
import { Icon } from '../../components/Icon'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { quickFade } from '../../app/motion'

interface Props {
  disabled?: boolean
  sending?: boolean
  label: string
  recordingContext?: string
  value: string
  onChange: (value: string) => void
  media: ReturnType<typeof useMediaDraft>
  onSend: (text: string, attachments: PendingMedia[]) => void | Promise<boolean>
}
export function Composer({
  label,
  recordingContext,
  value,
  onChange,
  onSend,
  media,
  disabled = false,
  sending = false,
}: Props) {
  const recordingBusy = useRef(false)
  const [recording, setRecording] = useState(false)
  const onRecordingBusy = useCallback((busy: boolean) => {
    recordingBusy.current = busy
    setRecording(busy)
  }, [])
  const recorder = useRef<{ start(): void }>(null)
  const input = useRef<HTMLInputElement>(null)
  const reduceMotion = useReducedMotion()
  const attachments = media.entries
  async function send() {
    if (
      disabled ||
      sending ||
      recordingBusy.current ||
      media.blocked ||
      (!value.trim() && !attachments.length)
    )
      return
    await onSend(value, attachments)
  }
  return (
    <motion.form
      layout={reduceMotion ? false : 'position'}
      className="composer-wrap"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <AnimatePresence initial={false}>
        {attachments.length > 0 && (
          <motion.ul
            className="attachment-list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={reduceMotion ? { duration: 0 } : quickFade}
          >
            {attachments.map((file) => (
              <li key={file.id} className="pending-media">
                <Icon name="file" />
                <span>
                  {file.intent.name}{' '}
                  <small>
                    {formatSize(file.intent.size)} ·{' '}
                    {file.intent.purpose === 'voice_note'
                      ? 'Voice note · review before sending'
                      : 'Attachment'}{' '}
                    ·{' '}
                    {file.state === 'ready'
                      ? 'Uploaded'
                      : file.state === 'uploading'
                        ? `Uploading ${Math.round((media.progress[file.id] ?? 0) * 100)}% · awaiting receipt`
                        : file.state === 'uncertain'
                          ? 'Upload outcome unconfirmed'
                          : 'Saved locally'}
                  </small>
                  {file.error && (
                    <small className="media-error">{file.error}</small>
                  )}
                  <BlobPreview
                    blob={file.bytes}
                    name={file.intent.name}
                    fallback="Preview unavailable for this format. Original bytes retained."
                  />
                </span>
                {file.intent.purpose === 'voice_note' && (
                  <button
                    type="button"
                    disabled={disabled || sending || recording}
                    onClick={async () => {
                      await media.remove(file)
                      recorder.current?.start()
                    }}
                  >
                    Re-record voice note
                  </button>
                )}
                {file.state === 'uploading' && (
                  <button type="button" onClick={() => media.cancel(file)}>
                    Cancel upload
                  </button>
                )}
                {['saved', 'uncertain', 'uploading'].includes(file.state) && (
                  <button type="button" onClick={() => void media.retry(file)}>
                    Retry upload
                  </button>
                )}
                <button
                  type="button"
                  className="icon-button"
                  disabled={disabled}
                  aria-label={`Remove ${file.intent.name}`}
                  onClick={() => void media.remove(file)}
                >
                  <Icon name="close" />
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <div className="composer">
        <motion.button
          whileTap={{ scale: 0.9 }}
          type="button"
          className="icon-button attach-button"
          disabled={disabled}
          aria-label="Attach files"
          onClick={() => input.current?.click()}
        >
          <Icon name="plus" />
        </motion.button>
        <input
          ref={input}
          type="file"
          disabled={disabled}
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []).map((file) => ({
              blob: file,
              name: file.name,
              purpose: 'attachment' as const,
            }))
            void media.add(files)
            event.target.value = ''
          }}
        />
        <textarea
          disabled={disabled}
          aria-label={label}
          placeholder={label}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              send()
            }
          }}
        />
        <VoiceRecorder
          ref={recorder}
          onBusyChange={onRecordingBusy}
          key={recordingContext}
          disabled={disabled || sending}
          onRecorded={(blob) =>
            media.add([
              {
                blob,
                name: `Voice note.${blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm'}`,
                purpose: 'voice_note',
              },
            ])
          }
        />
        <motion.button
          whileTap={{ scale: 0.9 }}
          whileHover={
            !disabled && (value.trim() || attachments.length)
              ? { scale: 1.04 }
              : undefined
          }
          className="send-button"
          aria-label="Send message"
          disabled={
            disabled ||
            sending ||
            recording ||
            media.blocked ||
            (!value.trim() && !attachments.length)
          }
        >
          <Icon name="arrow" />
        </motion.button>
      </div>
      {media.error && (
        <div role="alert" className="media-error">
          {media.error}{' '}
          <button type="button" onClick={() => void media.retryStorage()}>
            Retry attachment storage
          </button>
        </div>
      )}
      <p className="composer-hint">
        Files are saved on this device before upload. Voice notes request
        automatic transcription.
      </p>
    </motion.form>
  )
}
