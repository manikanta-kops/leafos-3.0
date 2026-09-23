import { useState } from 'react'
import { Composer } from './Composer'
import { useDraft } from './use-draft'
import type { PendingMedia } from '../../data/conversation-storage'
import { useMediaDraft } from '../media/use-media-draft'
import type { ConversationTarget, Submission } from '../../data/conversations'
import type { Draft, PendingSubmission } from '../../data/conversation-storage'
export function DurableComposer({
  scope,
  recordingContext,
  target,
  label,
  send,
  disabled = false,
}: {
  scope: string
  recordingContext?: string
  target: ConversationTarget
  label: string
  disabled?: boolean
  send: (
    submission: Submission,
    draft: Draft | undefined,
  ) => Promise<{ value: PendingSubmission; cleared: Draft | undefined }>
}) {
  const key = JSON.stringify([
    scope,
    target.context.kind === 'organization'
      ? { kind: 'organization', organizationId: target.context.organizationId }
      : { kind: 'installation', installationId: target.context.installationId },
    target.chatId,
    target.threadId ?? null,
  ])
  const draft = useDraft(key)
  const media = useMediaDraft(key, target)
  const [error, setError] = useState('')
  const [reserving, setReserving] = useState(false)
  async function submit(text: string, files: PendingMedia[]) {
    if (reserving) return false
    setReserving(true)
    setError('')
    try {
      const prepared = await draft.prepare()
      const submission: Submission = {
        submissionId: crypto.randomUUID(),
        target: structuredClone(target),
        parts: [
          ...(text.trim() ? [{ type: 'text' as const, text }] : []),
          ...files.map((file) => {
            if (!file.receipt)
              throw new Error('Upload receipt is required before sending.')
            return {
              type: 'file' as const,
              artifactId: file.receipt.artifact.id,
              purpose: file.intent.purpose,
            }
          }),
        ],
      }
      const { cleared } = await send(submission, {
        ...(prepared.draft ?? { key, revision: '', text }),
        uploadIds: files.map((f) => f.id),
      })
      draft.reserved(prepared.generation, cleared)
      return true
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Message could not be saved. Your input is retained.',
      )
      return false
    } finally {
      setReserving(false)
    }
  }
  return (
    <div className="durable-composer">
      <Composer
        label={label}
        recordingContext={recordingContext}
        media={media}
        value={draft.text}
        onChange={draft.change}
        onSend={submit}
        disabled={disabled}
        sending={reserving}
      />
      <div className="draft-status" aria-live="polite">
        {error ||
          (draft.status === 'error'
            ? 'Draft is not saved on this device.'
            : draft.status === 'saving'
              ? 'Saving draft…'
              : draft.status === 'loading'
                ? 'Loading saved draft…'
                : draft.status === 'saved' && draft.text
                  ? 'Draft saved on this device'
                  : '')}
        {draft.status === 'error' && (
          <button onClick={draft.retry}>Retry saving</button>
        )}
        {draft.status === 'conflict' && (
          <>
            <span>
              This draft changed in another tab. Your text is preserved.
            </span>
            <button onClick={() => draft.resolve(true)}>Keep my text</button>
            <button onClick={() => draft.resolve(false)}>
              Load saved text
            </button>
          </>
        )}
      </div>
    </div>
  )
}
